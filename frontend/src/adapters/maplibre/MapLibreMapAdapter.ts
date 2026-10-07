import { Map as MapLibreGLMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { MapOutlet } from '../../core/interfaces/MapOutlet';
import type { BoundingBox, Coordinates } from '../../core/types';

// Small visual margin so a fitBounds target isn't flush against the
// viewport edges (e.g. the controls panel in the top-left corner).
const FIT_BOUNDS_PADDING_PX = 40;

// index.html preloads this exact URL - keep the two in sync.
const STYLE_URL = 'https://tiles.openfreemap.org/styles/bright';

// MapLibre's world is TILE_SIZE_PX * 2^zoom pixels tall (Web Mercator).
const TILE_SIZE_PX = 512;

/**
 * What: The zoom at which the whole world (pole to pole, as far as Web
 * Mercator goes) exactly fills the given height - the container's height
 * minus the strip covered by the controls panel.
 * Why: The start screen shows the entire world top to bottom; with zoom
 * locked, MapLibre then has no room to pan vertically, so the only possible
 * gesture is dragging the (wrapping) world left/right.
 * Without it: A fixed zoom shows a different slice of the world on every
 * screen size - cropped poles on a phone, or empty space above/below.
 * Inputs: heightPx - the visible map height in CSS pixels.
 * Output: The fractional zoom level.
 */
function worldFitZoom(heightPx: number): number {
  return Math.log2(Math.max(heightPx, 1) / TILE_SIZE_PX);
}

/**
 * What: MapOutlet connector backed by MapLibre GL JS rendering OpenFreeMap's
 * "bright" vector tile style.
 * Why: This is today's concrete map "connector" - the thing that actually
 * talks to a map vendor's SDK so the rest of the app can depend only on the
 * MapOutlet interface.
 * Without it: There would be no working map at all; MapOutlet is just a
 * contract, this class is what fulfills it for MapLibre/OpenFreeMap.
 * Inputs: n/a (class declaration - see each method below).
 * Output: n/a (class declaration - see each method below).
 */
export class MapLibreMapAdapter implements MapOutlet {
  private map: MapLibreGLMap | null = null;
  private marker: Marker | null = null;
  private zoomEnabled = true;
  private interactionLocked = false;
  // True until the app first moves the camera; while true, the world view is
  // re-fitted whenever the container resizes (phone rotation, Safari's
  // toolbar collapsing).
  private showingWorld = true;
  // Top strip of the container covered by overlay UI (see setTopInset).
  private topInsetPx = 0;

  /**
   * What: Creates the MapLibre map inside the given container and resolves
   * once its style has finished loading.
   * Why: MainPage and EntityProviderOutlet.activate() both need a guarantee that
   * the map's style/layers exist before they touch it.
   * Without it: flyTo/setMarker calls or EntityProviderOutlet layer filters made
   * before the style loads would throw or silently no-op, since MapLibre
   * hasn't built its internal layer state yet.
   * Inputs: container - the HTMLElement to render the map into.
   * Output: A Promise that resolves (no value) once the map's 'load' event fires.
   */
  mount(container: HTMLElement): Promise<void> {
    const map = new MapLibreGLMap({
      container,
      style: STYLE_URL,
      center: [0, 0], // world view: MainPage always starts here regardless of adapter
      zoom: worldFitZoom(container.clientHeight - this.topInsetPx),
      // A landscape phone is under 512px tall, so the world-fit zoom goes
      // below the default minZoom of 0 (-2 is MapLibre's floor).
      minZoom: -2,
      attributionControl: false,
      // Drag and zoom only - no rotating or tilting the map.
      dragRotate: false,
      touchPitch: false,
      pitchWithRotate: false
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    this.map = map;
    // Before the first frame, so the world never draws under the controls.
    this.applyTopInset();

    map.on('resize', () => this.refitWorld());

    return new Promise((resolve) => {
      map.on('load', () => resolve());
    });
  }

  /**
   * What: Records how much of the container's top is covered by the
   * controls and applies it as MapLibre camera padding.
   * Why: MapLibre measures everything - its world-fit constraint, fitBounds,
   * flyTo centering - against the container minus its padding, so one
   * padding value keeps the whole world (and later framing) below the panel.
   * Without it: See MapOutlet.setTopInset.
   * Inputs: px - height of the covered strip.
   * Output: None (void). Before mount() it's only stored.
   */
  setTopInset(px: number): void {
    if (px === this.topInsetPx) return;
    this.topInsetPx = px;
    if (this.map) this.applyTopInset();
  }

  /**
   * What: Pushes topInsetPx into the map's camera padding and re-fits the
   * start-screen world view to the remaining height.
   * Why: Shared by mount() (initial value) and setTopInset() (the panel
   * changed size, e.g. its buttons wrapped onto another row).
   * Without it: Both callers would repeat the padding + refit pair.
   * Inputs: None.
   * Output: None (void).
   */
  private applyTopInset(): void {
    this.requireMap().setPadding({ top: this.topInsetPx, bottom: 0, left: 0, right: 0 });
    this.refitWorld();
  }

  /**
   * What: Re-fits the world view to the visible height, keeping the current
   * longitude, while the start screen is showing.
   * Why: The visible height changes with phone rotation, Safari's toolbar
   * collapsing, or the controls panel resizing.
   * Without it: The world would be cropped or leave gaps after those changes.
   * Inputs: None.
   * Output: None (void). No-op once the app has moved the camera.
   */
  private refitWorld(): void {
    if (!this.showingWorld) return;
    const map = this.requireMap();
    map.jumpTo({
      center: [map.getCenter().lng, 0],
      zoom: worldFitZoom(map.getContainer().clientHeight - this.topInsetPx)
    });
  }

  /**
   * What: Animates the camera to the given coordinates/zoom using a tuned,
   * distance-scaled "cinematic" flight instead of a fixed-duration jump.
   * Why: A fixed duration looks oddly slow for short hops and oddly fast for
   * long ones; speed/curve let flight time scale naturally with distance,
   * with maxDuration capping it so far-away destinations don't fly forever.
   * Without it: Either every flight would take the same amount of time
   * regardless of distance (feels wrong), or callers would need to compute
   * their own duration per call.
   * Inputs: coordinates - where to center the camera; zoom - target zoom level.
   * Output: None (void) - the camera animates as a side effect.
   */
  flyTo(coordinates: Coordinates, zoom: number): void {
    this.showingWorld = false;
    this.requireMap().flyTo({
      center: [coordinates.lng, coordinates.lat],
      zoom,
      essential: true,
      speed: 0.8, // lower = more cinematic; duration scales with distance
      curve: 1.42, // MapLibre default "swoop" shape (zoom out, pan, zoom in)
      maxDuration: 6000 // cap so far-away destinations don't fly forever
    });
  }

  /**
   * What: Instantly snaps the camera to frame the given bounding box, with
   * animation explicitly disabled.
   * Why: MapLibre's fitBounds animates by default (like flyTo) - this method
   * exists specifically for the "frame this area right now" case (e.g. the
   * search-radius circle the moment current location locks in), where an
   * animated transition would work against the "instantly" requirement.
   * Without it: Callers wanting an instant frame would have to remember to
   * pass animate:false themselves every time, or get an unwanted animation.
   * Inputs: bounds - the west/south/east/north box to fit entirely on screen.
   * Output: None (void) - the camera snaps to the bounds as a side effect.
   */
  fitBounds(bounds: BoundingBox): void {
    this.showingWorld = false;
    this.requireMap().fitBounds(
      [
        [bounds.west, bounds.south],
        [bounds.east, bounds.north]
      ],
      { animate: false, padding: FIT_BOUNDS_PADDING_PX }
    );
  }

  /**
   * What: Shows a single reusable marker at the given coordinates, creating
   * it on first use and just repositioning it afterward.
   * Why: The app only ever needs one marker ("current location" or the most
   * recent search result) - reusing it avoids marker buildup on the map.
   * Without it: Every call would add a brand-new marker, leaving every past
   * search's marker still on the map.
   * Inputs: coordinates - where the marker should appear.
   * Output: None (void) - the marker is created/moved as a side effect.
   */
  setMarker(coordinates: Coordinates): void {
    const map = this.requireMap();
    if (!this.marker) {
      this.marker = new Marker({ color: '#007AFF' })
        .setLngLat([coordinates.lng, coordinates.lat])
        .addTo(map);
    } else {
      this.marker.setLngLat([coordinates.lng, coordinates.lat]);
    }
  }

  /**
   * What: Disables all user-driven camera interaction (scroll-zoom, drag-pan,
   * touch, double-click-zoom, box-zoom, keyboard).
   * Why: Used while the entity-info modal is open so the map underneath can't
   * be panned/zoomed out from under it.
   * Without it: Scrolling or dragging while the modal is open would move the
   * map in the background, which is disorienting and was explicitly unwanted.
   * Inputs: None.
   * Output: None (void) - interaction handlers are disabled as a side effect.
   */
  lockInteraction(): void {
    this.interactionLocked = true;
    this.applyInteraction();
  }

  /**
   * What: Re-enables the interaction handlers disabled by lockInteraction()
   * (zoom only if setZoomEnabled hasn't turned it off).
   * Why: Restores normal map use once the modal that required locking it closes.
   * Without it: The map would stay frozen/unusable after the first modal open/close.
   * Inputs: None.
   * Output: None (void) - interaction handlers are re-enabled as a side effect.
   */
  unlockInteraction(): void {
    this.interactionLocked = false;
    this.applyInteraction();
  }

  /**
   * What: Calls handler whenever the camera starts moving.
   * Why: See MapOutlet.onMoveStart.
   * Without it: MainPage couldn't cancel a pending search when a new drag starts.
   * Inputs: handler - called with no arguments.
   * Output: None (void).
   */
  onMoveStart(handler: () => void): void {
    this.requireMap().on('movestart', () => handler());
  }

  /**
   * What: Calls handler with the map center whenever the camera stops moving.
   * Why: See MapOutlet.onMoveEnd. MapLibre's 'moveend' fires once a drag's
   * inertia has finished, so this is "the map stopped", not "finger lifted".
   * Without it: MainPage couldn't re-search where the user ends up looking.
   * Inputs: handler - called with the new center.
   * Output: None (void).
   */
  onMoveEnd(handler: (center: Coordinates) => void): void {
    const map = this.requireMap();
    map.on('moveend', () => {
      // wrap(): after dragging around the globe, lng can drift past ±180.
      const { lng, lat } = map.getCenter().wrap();
      handler({ lng, lat });
    });
  }

  /**
   * What: Allows or blocks user zooming (scroll, pinch, double-click/tap,
   * box-zoom, keyboard), leaving drag-panning as it is.
   * Why: See MapOutlet.setZoomEnabled - the start-screen world map can only
   * be dragged sideways until current location locks in.
   * Without it: The world map would be zoomable from the first touch.
   * Inputs: enabled - true to allow zooming.
   * Output: None (void) - handlers are toggled as a side effect.
   */
  setZoomEnabled(enabled: boolean): void {
    this.zoomEnabled = enabled;
    this.applyInteraction();
  }

  /**
   * What: Enables/disables each MapLibre interaction handler from the
   * combined interactionLocked + zoomEnabled state.
   * Why: The modal lock and the start-screen zoom lock overlap; deriving
   * every handler from both flags means unlocking after a modal can't
   * accidentally re-enable zoom that should stay off.
   * Without it: unlockInteraction() would blindly turn zoom back on.
   * Inputs: None (reads this.interactionLocked/this.zoomEnabled).
   * Output: None (void).
   */
  private applyInteraction(): void {
    const map = this.requireMap();
    const panOn = !this.interactionLocked;
    const zoomOn = panOn && this.zoomEnabled;
    const toggle = (handler: { enable(): void; disable(): void }, on: boolean): void => {
      if (on) handler.enable();
      else handler.disable();
    };
    toggle(map.dragPan, panOn);
    toggle(map.scrollZoom, zoomOn);
    toggle(map.touchZoomRotate, zoomOn);
    toggle(map.doubleClickZoom, zoomOn);
    toggle(map.boxZoom, zoomOn);
    toggle(map.keyboard, zoomOn);
  }

  /**
   * What: Returns the underlying MapLibreGLMap instance.
   * Why: MapEntityConnector/MapLibreEntityConnector need direct access to
   * add sources/layers, set layer filters, and register click handlers that
   * MapOutlet deliberately doesn't abstract.
   * Without it: Those entity connectors would have no way to reach the map
   * it needs to configure.
   * Inputs: None.
   * Output: The MapLibreGLMap instance, typed as unknown at this boundary
   * since MapOutlet itself stays vendor-agnostic.
   */
  getNativeMap(): unknown {
    return this.requireMap();
  }

  /**
   * What: Returns the mounted map instance or throws if called too early.
   * Why: Every other method needs the map instance; centralizing the
   * "is it mounted yet" check avoids repeating a null-check (and a vague
   * null-reference error) in each method.
   * Without it: Calling flyTo/setMarker/etc before mount() resolves would
   * throw a confusing "Cannot read properties of null" instead of a clear
   * message pointing at the actual mistake (using the adapter too early).
   * Inputs: None.
   * Output: The mounted MapLibreGLMap instance.
   */
  private requireMap(): MapLibreGLMap {
    if (!this.map) throw new Error('MapLibreMapAdapter used before mount() resolved');
    return this.map;
  }
}

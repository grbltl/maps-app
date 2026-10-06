import { Map as MapLibreGLMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { MapAdapter } from '../../core/interfaces/MapAdapter';
import type { Coordinates } from '../../core/types';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/bright';

/**
 * What: MapAdapter implementation backed by MapLibre GL JS rendering
 * OpenFreeMap's "bright" vector tile style.
 * Why: This is today's concrete map "connector" - the thing that actually
 * talks to a map vendor's SDK so the rest of the app can depend only on the
 * MapAdapter interface.
 * Without it: There would be no working map at all; MapAdapter is just a
 * contract, this class is what fulfills it for MapLibre/OpenFreeMap.
 * Inputs: n/a (class declaration - see each method below).
 * Output: n/a (class declaration - see each method below).
 */
export class MapLibreMapAdapter implements MapAdapter {
  private map: MapLibreGLMap | null = null;
  private marker: Marker | null = null;

  /**
   * What: Creates the MapLibre map inside the given container and resolves
   * once its style has finished loading.
   * Why: MainPage and EntityProvider.activate() both need a guarantee that
   * the map's style/layers exist before they touch it.
   * Without it: flyTo/setMarker calls or EntityProvider layer filters made
   * before the style loads would throw or silently no-op, since MapLibre
   * hasn't built its internal layer state yet.
   * Inputs: container - the HTMLElement to render the map into.
   * Output: A Promise that resolves (no value) once the map's 'load' event fires.
   */
  mount(container: HTMLElement): Promise<void> {
    const map = new MapLibreGLMap({
      container,
      style: STYLE_URL,
      center: [0, 20], // world view: MainPage always starts here regardless of adapter
      zoom: 1,
      attributionControl: false
    });
    this.map = map;

    return new Promise((resolve) => {
      map.on('load', () => resolve());
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
    const map = this.requireMap();
    map.scrollZoom.disable();
    map.dragPan.disable();
    map.touchZoomRotate.disable();
    map.doubleClickZoom.disable();
    map.boxZoom.disable();
    map.keyboard.disable();
  }

  /**
   * What: Re-enables the interaction handlers disabled by lockInteraction().
   * Why: Restores normal map use once the modal that required locking it closes.
   * Without it: The map would stay frozen/unusable after the first modal open/close.
   * Inputs: None.
   * Output: None (void) - interaction handlers are re-enabled as a side effect.
   */
  unlockInteraction(): void {
    const map = this.requireMap();
    map.scrollZoom.enable();
    map.dragPan.enable();
    map.touchZoomRotate.enable();
    map.doubleClickZoom.enable();
    map.boxZoom.enable();
    map.keyboard.enable();
  }

  /**
   * What: Returns the underlying MapLibreGLMap instance.
   * Why: MapLibreEntityProvider needs direct access to register layer
   * filters and click handlers that MapAdapter deliberately doesn't abstract.
   * Without it: MapLibreEntityProvider would have no way to reach the map
   * it needs to configure.
   * Inputs: None.
   * Output: The MapLibreGLMap instance, typed as unknown at this boundary
   * since MapAdapter itself stays vendor-agnostic.
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

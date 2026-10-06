import type { BoundingBox, Coordinates } from '../types';

/**
 * What: The map "outlet" interface - pure map mechanics only (display,
 * camera, a single marker, locking interaction). Deliberately knows nothing
 * about what a "restaurant" or any other entity category is - that's
 * EntityProviderOutlet's job.
 * Why: Lets MainPage and Modal work against a stable contract instead of a
 * specific map vendor's API, so the map connector can be swapped (MapLibre
 * today, Google Maps/others later) by writing a new implementation of this
 * interface, not by changing the UI.
 * Without it: Every component that needs the map would call MapLibre's SDK
 * directly, hard-coding the app to one vendor and making a future connector
 * swap mean rewriting UI code instead of adding one file.
 * Inputs: n/a (interface declaration - see each method below).
 * Output: n/a (interface declaration - see each method below).
 */
export interface MapOutlet {
  /**
   * What: Mounts the map into a container element and resolves once it's
   * ready to use.
   * Why: MainPage needs to know when it's safe to call flyTo/setMarker/etc,
   * and when EntityProviderOutlet.activate() can safely register layer
   * filters and click handlers.
   * Without it: Callers would have to guess when the underlying map library
   * has finished initializing, causing calls made too early to silently
   * fail or throw.
   * Inputs: container - the HTMLElement the map should render into.
   * Output: A Promise that resolves (with no value) once the map is ready.
   * Implementations default to a world view (whole-planet, zoomed out) until
   * told otherwise - MainPage always starts on a world map regardless of
   * which connector is plugged in.
   */
  mount(container: HTMLElement): Promise<void>;

  /**
   * What: Animates the camera to the given coordinates and zoom level.
   * Why: Gives MainPage a vendor-agnostic way to recenter the map after an
   * address search or a "use current location" action.
   * Without it: MainPage would need vendor-specific camera APIs, defeating
   * the purpose of the outlet boundary.
   * Inputs: coordinates - where to center the camera; zoom - the target zoom level.
   * Output: None (void) - the camera animates as a side effect.
   */
  flyTo(coordinates: Coordinates, zoom: number): void;

  /**
   * What: Instantly frames the camera to fit the given bounding box, with no
   * pan/zoom animation.
   * Why: Used to snap the view to show an entire area (e.g. a search-radius
   * circle) the moment it's known, rather than animating toward a single
   * point at a fixed zoom - that's what flyTo is for, and the two serve
   * different camera-framing needs (a region vs. a point).
   * Without it: There would be no way to frame an area as opposed to a
   * point, forcing every camera move through flyTo's point+zoom model even
   * when what's actually known is a region to fit entirely on screen.
   * Inputs: bounds - the west/south/east/north box to fit entirely on screen.
   * Output: None (void) - the camera snaps to the bounds as a side effect, no animation.
   */
  fitBounds(bounds: BoundingBox): void;

  /**
   * What: Shows a single reusable marker at the given coordinates, moving it
   * if one already exists rather than creating a new one each time.
   * Why: The app only ever needs to mark "current location" - reusing one
   * marker avoids accumulating stale markers on repeated searches.
   * Without it: Every search/locate action would need its own marker
   * lifecycle management duplicated at the call site, and old markers would
   * pile up on the map.
   * Inputs: coordinates - where the marker should appear.
   * Output: None (void) - the marker is created/moved as a side effect.
   */
  setMarker(coordinates: Coordinates): void;

  /**
   * What: Disables user-driven pan/zoom/rotate on the map.
   * Why: Used while the entity-info modal is open, so dragging/scrolling
   * behind the modal can't move the map the user can't currently see clearly.
   * Without it: Users could pan/zoom the map underneath an open modal,
   * which is disorienting and was explicitly called out as unwanted.
   * Inputs: None.
   * Output: None (void) - interaction is disabled as a side effect.
   */
  lockInteraction(): void;

  /**
   * What: Re-enables interaction previously disabled by lockInteraction().
   * Why: Restores normal map use once the modal that required locking it closes.
   * Without it: The map would stay frozen/unusable after the first time a
   * modal was opened and closed.
   * Inputs: None.
   * Output: None (void) - interaction is re-enabled as a side effect.
   */
  unlockInteraction(): void;

  /**
   * What: Escape hatch that exposes the underlying, vendor-specific map
   * instance (e.g. the real maplibregl.Map).
   * Why: A matching EntityProviderOutlet implementation (e.g.
   * MapLibreEntityConnector) needs direct access to the native map to
   * register layer filters and click handlers that this interface
   * intentionally doesn't abstract, since POI mechanisms differ too much per
   * vendor to generalize here.
   * Without it: EntityProviderOutlet implementations would have no way to
   * reach the map they need to attach to, forcing MapOutlet to grow a much
   * larger, vendor-leaking interface just to cover every possible POI
   * mechanism.
   * Inputs: None.
   * Output: The native map instance, typed as unknown since its real shape is
   * only known to the matching EntityProviderOutlet implementation.
   */
  getNativeMap(): unknown;
}

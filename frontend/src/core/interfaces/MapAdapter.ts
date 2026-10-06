import type { Coordinates } from '../types';

/**
 * The map "socket": pure map mechanics only (display, camera, a single
 * marker, locking interaction). Deliberately knows nothing about what a
 * "restaurant" or any other entity category is - that's EntityProvider's job.
 * Implement this once per map vendor (MapLibre today; Google Maps, etc. later).
 */
export interface MapAdapter {
  /** Mount into the given container and resolve once the map is ready to use.
   * Implementations default to a world view (whole-planet, zoomed out) until
   * told otherwise - MainPage always starts on a world map regardless of adapter. */
  mount(container: HTMLElement): Promise<void>;

  /** Animate the camera to the given coordinates/zoom. */
  flyTo(coordinates: Coordinates, zoom: number): void;

  /** Show a single reusable marker at the given coordinates, moving it if one already exists. */
  setMarker(coordinates: Coordinates): void;

  /** Disable user-driven pan/zoom/rotate (e.g. while a modal is open over the map). */
  lockInteraction(): void;

  /** Re-enable interaction disabled by lockInteraction(). */
  unlockInteraction(): void;

  /** Escape hatch for a matching EntityProvider implementation that needs the
   * native map instance (e.g. MapLibreEntityProvider needs the maplibregl.Map
   * to register layer filters/click handlers). Opaque to everything else. */
  getNativeMap(): unknown;
}

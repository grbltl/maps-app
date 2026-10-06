import type { Coordinates } from '../types';

/**
 * What: Interface for turning free-text addresses into coordinates.
 * Why: Kept separate from MapOutlet since a map vendor and a geocoding
 * vendor don't have to be the same choice (e.g. a Google connector might
 * want Google's geocoding, while a MapLibre/OpenFreeMap connector has no
 * geocoding of its own and reaches for Nominatim instead).
 * Without it: Geocoding calls would be made directly against one vendor's
 * API from inside MainPage, coupling address search to that vendor even if
 * the map itself is swapped.
 * Inputs: n/a (interface declaration - see the method below).
 * Output: n/a (interface declaration - see the method below).
 */
export interface GeocodingOutlet {
  /**
   * What: Resolves a free-text address/query to coordinates.
   * Why: Powers the address search box - MainPage needs coordinates to fly
   * the map to and to potentially lock in as "current location".
   * Without it: There would be no way to turn what a user types into a map
   * location without MainPage calling a specific geocoding vendor directly.
   * Inputs: query - the free-text address/search string the user typed.
   * Output: A Promise resolving to Coordinates, or null if nothing matched.
   */
  geocode(query: string): Promise<Coordinates | null>;
}

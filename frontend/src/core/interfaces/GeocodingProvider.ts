import type { Coordinates, EntityDetails } from '../types';

/**
 * What: Interface for turning free-text addresses into coordinates and
 * coordinates into human-readable details (address/phone/etc).
 * Why: Kept separate from MapAdapter since a map vendor and a geocoding
 * vendor don't have to be the same choice (e.g. a Google connector might
 * want Google's geocoding, while a MapLibre/OpenFreeMap connector has no
 * geocoding of its own and reaches for Nominatim instead).
 * Without it: Geocoding calls would be made directly against one vendor's
 * API from inside MainPage, coupling address search and the modal's
 * address/phone display to that vendor even if the map itself is swapped.
 * Inputs: n/a (interface declaration - see each method below).
 * Output: n/a (interface declaration - see each method below).
 */
export interface GeocodingProvider {
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

  /**
   * What: Reverse-geocodes coordinates into whatever details are available
   * (address, phone, etc).
   * Why: Powers the entity-info modal's address/phone lines after a user
   * clicks an entity on the map.
   * Without it: The modal would only ever be able to show what the map's own
   * POI data carries (typically just a name), with no address or phone.
   * Inputs: coordinates - the location to look up.
   * Output: A Promise resolving to an EntityDetails object (address lines
   * and/or phone, each null when not available).
   */
  getEntityDetails(coordinates: Coordinates): Promise<EntityDetails>;
}

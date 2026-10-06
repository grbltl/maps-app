import type { Coordinates, EntityDetails } from '../types';

/**
 * Turns free-text addresses into coordinates and coordinates into
 * human-readable details (address/phone/etc). Kept separate from MapAdapter
 * since a map vendor and a geocoding vendor don't have to be the same choice
 * (e.g. a Google connector might want Google's geocoding, while a MapLibre/
 * OpenFreeMap connector has no geocoding of its own and reaches for Nominatim).
 */
export interface GeocodingProvider {
  /** Resolve a free-text address/query to coordinates, or null if nothing matched. */
  geocode(query: string): Promise<Coordinates | null>;

  /** Reverse-geocode coordinates into whatever details are available (address, phone, ...). */
  getEntityDetails(coordinates: Coordinates): Promise<EntityDetails>;
}

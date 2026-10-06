import type { GeocodingProvider } from '../../core/interfaces/GeocodingProvider';
import type { Coordinates } from '../../core/types';

interface NominatimSearchResult {
  lat: string;
  lon: string;
}

/**
 * What: GeocodingProvider implementation backed by OpenStreetMap's Nominatim
 * (free, no API key).
 * Why: This is today's concrete geocoding "connector" - the thing that
 * actually talks to a geocoding vendor's API so MainPage can depend only on
 * the GeocodingProvider interface.
 * Without it: There would be no way to turn a typed address into coordinates.
 * Inputs: n/a (class declaration - see the method below).
 * Output: n/a (class declaration - see the method below).
 */
export class NominatimGeocodingProvider implements GeocodingProvider {
  /**
   * What: Looks up a free-text address via Nominatim's /search endpoint and
   * returns its coordinates.
   * Why: Powers the address search box.
   * Without it: There would be no way to resolve what a user types into a
   * map location.
   * Inputs: query - the free-text address/search string.
   * Output: A Promise resolving to Coordinates, or null if Nominatim
   * returned no matches. Throws if the HTTP request itself fails.
   */
  async geocode(query: string): Promise<Coordinates | null> {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
      query
    )}`;
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Geocoding request failed');

    const results = (await response.json()) as NominatimSearchResult[];
    if (!results || results.length === 0) return null;

    return { lng: parseFloat(results[0].lon), lat: parseFloat(results[0].lat) };
  }
}

import type { GeocodingProvider } from '../../core/interfaces/GeocodingProvider';
import type { Coordinates, EntityDetails } from '../../core/types';
import { formatAddressLines, type StructuredAddress } from '../../utils/usAddress';

interface NominatimSearchResult {
  lat: string;
  lon: string;
}

interface NominatimReverseResult {
  display_name?: string;
  address?: StructuredAddress;
  extratags?: Record<string, string | undefined>;
}

/**
 * What: GeocodingProvider implementation backed by OpenStreetMap's Nominatim
 * (free, no API key).
 * Why: This is today's concrete geocoding "connector" - the thing that
 * actually talks to a geocoding vendor's API so MainPage/Modal can depend
 * only on the GeocodingProvider interface.
 * Without it: There would be no way to turn a typed address into
 * coordinates, or a clicked entity's coordinates into an address/phone.
 * Inputs: n/a (class declaration - see each method below).
 * Output: n/a (class declaration - see each method below).
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

  /**
   * What: Reverse-geocodes coordinates via Nominatim's /reverse endpoint
   * (with addressdetails and extratags) into a formatted address and phone.
   * Why: Powers the entity-info modal's address/phone lines. Builds the
   * address from Nominatim's structured `address` fields (via
   * formatAddressLines) rather than its `display_name`, which leads with the
   * POI's own name/category and would duplicate what the modal already shows
   * as the entity's title.
   * Without it: The modal would have no address or phone to show, or would
   * show a raw, US-unformatted, name-duplicating string.
   * Inputs: coordinates - the location to look up.
   * Output: A Promise resolving to EntityDetails: address (formatted lines,
   * falling back to display_name, or null if neither is available) and phone
   * (from extratags.phone/contact:phone, or null if untagged - not every
   * place has a phone number in OpenStreetMap). Throws if the HTTP request
   * itself fails.
   */
  async getEntityDetails(coordinates: Coordinates): Promise<EntityDetails> {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${coordinates.lat}` +
      `&lon=${coordinates.lng}&zoom=18&addressdetails=1&extratags=1`;
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Reverse geocoding failed');

    const data = (await response.json()) as NominatimReverseResult;
    const address = formatAddressLines(data.address) ?? (data.display_name ? [data.display_name] : null);
    const phone = data.extratags?.phone || data.extratags?.['contact:phone'] || null;

    return { address, phone };
  }
}

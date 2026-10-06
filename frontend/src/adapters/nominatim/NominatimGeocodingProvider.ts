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

export class NominatimGeocodingProvider implements GeocodingProvider {
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

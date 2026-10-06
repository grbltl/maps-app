import type { Coordinates, Entity } from '../../core/types';
import { formatAddressLines, type StructuredAddress } from '../../utils/usAddress';

const MILES_TO_METERS = 1609.344;

export interface OverpassTagMatch {
  key: string;
  values: string[];
}

export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface OverpassResponse {
  elements: OverpassElement[];
}

/**
 * What: Escapes regex metacharacters in a string.
 * Why: Tag values get interpolated into an Overpass QL regex alternation
 * (`~"^(a|b)$"`); config-supplied values are trusted today, but escaping is
 * cheap insurance against a future value containing a regex metacharacter
 * breaking the query.
 * Without it: A category value containing e.g. a `.` or `+` could silently
 * change what the regex matches instead of being treated as a literal string.
 * Inputs: value - a raw string to embed in a regex.
 * Output: The same string with regex metacharacters backslash-escaped.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * What: Builds an Overpass QL query string that finds every node/way tagged
 * with the given OSM key/values within a radius of a center point.
 * Why: This is what powers "all restaurants within N miles of here" -
 * Overpass's `around` filter does the radius search server-side, and
 * matching multiple tag values via one regex alternation keeps the query to
 * two clauses (node + way) regardless of how many values a category has.
 * Without it: There would be no way to ask Overpass the actual question this
 * feature needs answered; `out center` is included so ways (which have no
 * single lat/lon of their own) still come back with a usable point.
 * Inputs: osmTag - the key/values to match (e.g. {key: "amenity", values:
 * ["restaurant"]}); center - the point to search around; radiusMiles - how
 * far out to search.
 * Output: A complete Overpass QL query string, ready to POST to an Overpass endpoint.
 */
export function buildOverpassQuery(osmTag: OverpassTagMatch, center: Coordinates, radiusMiles: number): string {
  const radiusMeters = Math.round(radiusMiles * MILES_TO_METERS);
  const valuePattern = osmTag.values.map(escapeRegExp).join('|');
  const tagFilter = `["${osmTag.key}"~"^(${valuePattern})$"]`;
  const around = `(around:${radiusMeters},${center.lat},${center.lng})`;
  return `[out:json][timeout:25];(node${tagFilter}${around};way${tagFilter}${around};);out center;`;
}

/**
 * What: Maps Overpass's addr:* OSM tags onto the StructuredAddress shape
 * formatAddressLines() already knows how to format.
 * Why: Reuses the exact same US-mailing-address formatting (abbreviated
 * street suffix, two-line "street" / "City, ST zip") for Overpass-sourced
 * addresses as for Nominatim-sourced ones, instead of a second formatter.
 * Without it: Overpass-derived addresses would need their own formatting
 * logic, duplicating (and risking diverging from) usAddress.ts.
 * Inputs: tags - the raw OSM tags object from an Overpass element (may be
 * missing any/all addr:* keys - most POIs have only some, if any).
 * Output: A StructuredAddress (fields undefined where the source tags lack them).
 */
function tagsToStructuredAddress(tags: Record<string, string>): StructuredAddress {
  return {
    house_number: tags['addr:housenumber'],
    road: tags['addr:street'],
    unit: tags['addr:unit'],
    city: tags['addr:city'],
    state: tags['addr:state'],
    postcode: tags['addr:postcode'],
    country: tags['addr:country'],
    country_code: tags['addr:country']?.toLowerCase()
  };
}

/**
 * What: Extracts a phone number from OSM tags, preferring `phone` over `contact:phone`.
 * Why: OSM data uses either tag inconsistently depending on who mapped the
 * place; checking both maximizes how often a phone number is actually found.
 * Without it: Places tagged only with `contact:phone` (a common alternate
 * convention) would show no phone even when one exists in the data.
 * Inputs: tags - the raw OSM tags object from an Overpass element.
 * Output: The phone number string, or null if neither tag is present.
 */
function extractPhone(tags: Record<string, string>): string | null {
  return tags.phone || tags['contact:phone'] || null;
}

/**
 * What: Converts one Overpass element (a node, or a way/relation with a
 * computed center) into the app's normalized Entity shape, or null if it has
 * no usable coordinates.
 * Why: Keeps Overpass's raw node/way/tags shape out of the rest of the app,
 * and pre-fills Entity.details from the element's own tags so MainPage can
 * skip a redundant Nominatim reverse-geocode for data Overpass already gave us.
 * Without it: Every consumer would need to know about Overpass's node-vs-way
 * coordinate shapes and raw tag keys.
 * Inputs: element - one element from an Overpass response; fallbackLabel -
 * used as the entity's name when the element has no "name" tag (e.g. the
 * EntityConfig's label, "Restaurant").
 * Output: A normalized Entity with details pre-filled from OSM tags, or null
 * if the element has neither a direct lat/lon nor a computed center.
 */
function elementToEntity(element: OverpassElement, fallbackLabel: string): Entity | null {
  const position =
    element.lat !== undefined && element.lon !== undefined
      ? { lat: element.lat, lon: element.lon }
      : element.center;
  if (!position) return null;

  const tags = element.tags ?? {};
  return {
    name: tags.name || fallbackLabel,
    coordinates: { lat: position.lat, lng: position.lon },
    details: {
      address: formatAddressLines(tagsToStructuredAddress(tags)),
      phone: extractPhone(tags)
    }
  };
}

/**
 * What: Converts a full Overpass response into an array of normalized Entities.
 * Why: This is the single place that turns "what Overpass sent back" into
 * "what the rest of the app understands."
 * Without it: Callers would need to map over raw elements themselves,
 * duplicating the null-coordinate filtering and per-element conversion.
 * Inputs: response - the parsed JSON body of an Overpass query response;
 * fallbackLabel - passed through to elementToEntity for unnamed places.
 * Output: An array of Entity, skipping any element with no usable coordinates.
 */
export function parseOverpassEntities(response: OverpassResponse, fallbackLabel: string): Entity[] {
  return response.elements
    .map((element) => elementToEntity(element, fallbackLabel))
    .filter((entity): entity is Entity => entity !== null);
}

export interface Coordinates {
  lat: number;
  lng: number;
}

/** An axis-aligned geographic bounding box, for framing an area (as opposed
 * to a single point + zoom, which is what MapAdapter.flyTo deals with). */
export interface BoundingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** An address broken into display lines (e.g. ["18484 Preston Rd", "Dallas, TX 75252"]),
 * already formatted the way it should be shown - line count/format may vary by locale/provider. */
export type AddressLines = string[];

export interface EntityDetails {
  address: AddressLines | null;
  phone: string | null;
}

/** A single point of interest, normalized away from whatever vendor-specific
 * shape the underlying map/data source returned it in. */
export interface Entity {
  name: string;
  coordinates: Coordinates;
  /** Details the EntityProvider already had on hand when it found this entity
   * (e.g. address/phone read straight from OSM tags in an Overpass
   * response), so MainPage can skip a redundant reverse-geocode call for
   * whichever fields are already here. Absent/null fields still fall back to
   * GeocodingProvider.getEntityDetails(). */
  details?: EntityDetails;
}

/** Declares which category of point-of-interest an EntityProvider should
 * surface. Swapping this (e.g. restaurants -> clothing stores) is meant to be
 * the only change needed to retarget the whole app at a different category. */
export interface EntityConfig {
  /** Human-facing label, e.g. "Restaurant". Falls back to this when an entity has no name. */
  label: string;
  /** Values matched against the data source's own category/class field. Meaning is provider-specific.
   * Used by tile-filtering providers (e.g. MapLibreEntityProvider), whose
   * underlying vector tiles expose every POI category through one shared
   * property. */
  categoryValues: string[];
  /** The real OpenStreetMap tag this category corresponds to - a key/value
   * pair, not just a value, since OSM splits categories across different
   * keys entirely (amenity=restaurant vs shop=clothes), unlike
   * categoryValues' single shared property. Used by tag-query providers
   * (e.g. OverpassEntityProvider). */
  osmTag: {
    key: string;
    values: string[];
  };
}

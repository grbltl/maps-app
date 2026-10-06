export interface Coordinates {
  lat: number;
  lng: number;
}

/** A single point of interest, normalized away from whatever vendor-specific
 * shape the underlying map/data source returned it in. */
export interface Entity {
  name: string;
  coordinates: Coordinates;
}

/** Declares which category of point-of-interest an EntityProvider should
 * surface. Swapping this (e.g. restaurants -> clothing stores) is meant to be
 * the only change needed to retarget the whole app at a different category. */
export interface EntityConfig {
  /** Human-facing label, e.g. "Restaurant". Falls back to this when an entity has no name. */
  label: string;
  /** Values matched against the data source's own category/class field. Meaning is provider-specific. */
  categoryValues: string[];
}

/** An address broken into display lines (e.g. ["18484 Preston Rd", "Dallas, TX 75252"]),
 * already formatted the way it should be shown - line count/format may vary by locale/provider. */
export type AddressLines = string[];

export interface EntityDetails {
  address: AddressLines | null;
  phone: string | null;
}

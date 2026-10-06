export interface Coordinates {
  lat: number;
  lng: number;
}

/** An axis-aligned geographic bounding box, for framing an area (as opposed
 * to a single point + zoom, which is what MapOutlet.flyTo deals with). */
export interface BoundingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** An address broken into display lines (e.g. ["18484 Preston Rd", "Dallas, TX 75252"]),
 * already formatted the way it should be shown - line count/format may vary by locale/provider. */
export type AddressLines = string[];

/** A deal/promotion an entity is running. Dates are calendar dates in
 * "YYYY-MM-DD" form, both inclusive; a missing start means "already
 * running", a missing end means "no end date". */
export interface Deal {
  description: string;
  startDate?: string | null;
  endDate?: string | null;
}

/** Everything known about an entity beyond its name and position. Every
 * field is optional - whatever the data source doesn't have is simply not
 * shown. */
export interface EntityDetails {
  address?: AddressLines | null;
  phone?: string | null;
  website?: string | null;
  /** Free text, shown as-is (e.g. "Mon-Fri 11am-10pm, Sat-Sun 10am-11pm"). */
  hours?: string | null;
  cuisine?: string | null;
  deals?: Deal[];
}

/** A single point of interest, normalized away from whatever
 * vendor-specific shape the underlying data source stores it in. */
export interface Entity {
  name: string;
  coordinates: Coordinates;
  details?: EntityDetails;
}

/** Declares which category of point-of-interest an EntityProviderOutlet
 * should surface. Swapping this (e.g. restaurants -> clothing stores) is meant
 * to be the only change needed to retarget the whole app at a different category. */
export interface EntityConfig {
  /** Human-facing label, e.g. "Restaurant". */
  label: string;
  /** Values matched against the data source's own category/class field. Meaning is connector-specific.
   * Used by tile-filtering connectors (e.g. MapLibreEntityConnector), whose
   * underlying vector tiles expose every POI category through one shared
   * property. */
  categoryValues: string[];
}

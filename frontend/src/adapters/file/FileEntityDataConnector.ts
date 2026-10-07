import type { EntityDataOutlet } from '../../core/interfaces/EntityDataOutlet';
import type { Coordinates, Entity } from '../../core/types';
import { formatAddressLines } from '../../utils/usAddress';

/** One record of the data file, as written by scripts/build-restaurant-data.mjs. */
export interface EntityFileRecord {
  name: string;
  lat: number;
  lng: number;
  street?: string;
  unit?: string;
  city?: string;
  state?: string;
  zip?: string;
}

/**
 * What: Converts one data-file record into an Entity.
 * Why: Keeps the file's flat, presentation-agnostic shape (structured
 * address fields) separate from how the modal displays it.
 * Without it: The file would have to store pre-formatted display lines.
 * Inputs: record - one record from the data file (US addresses).
 * Output: The equivalent Entity.
 */
export function toEntity(record: EntityFileRecord): Entity {
  const address = formatAddressLines({
    road: record.street,
    unit: record.unit,
    city: record.city,
    state: record.state,
    postcode: record.zip,
    country_code: 'us'
  });
  return {
    name: record.name,
    coordinates: { lat: record.lat, lng: record.lng },
    details: address ? { address } : undefined
  };
}

/**
 * What: EntityDataOutlet connector that reads entity records from a static
 * JSON data file served alongside the app (public/restaurants.json by
 * default, generated from the source CSV by scripts/build-restaurant-data.mjs).
 * Why: This is the outlet the app is plugged into for now, while the data
 * set is small enough to ship as a file. A database-backed EntityDataOutlet
 * connector replaces it once the data outgrows that.
 * Without it: The map connector would have no data source to plug into.
 * Inputs: url - where the data file is served from.
 * Output: n/a (class declaration - see the method below).
 */
export class FileEntityDataConnector implements EntityDataOutlet {
  private entities: Promise<Entity[]> | null = null;

  constructor(private readonly url = '/restaurants.json') {}

  /**
   * What: Returns every entity in the data file.
   * Why: A file is loaded whole, so there's nothing to gain from narrowing
   * it here - the caller does the exact radius filtering.
   * Without it: No entities could ever be shown from the file.
   * Inputs: _center, _radiusMiles - unused (see Why).
   * Output: A Promise resolving to every entity in the file. The file is
   * fetched once and cached; a failed fetch rejects and isn't cached, so a
   * later call retries.
   */
  findNear(_center: Coordinates, _radiusMiles: number): Promise<Entity[]> {
    if (!this.entities) {
      this.entities = this.load().catch((error: unknown) => {
        this.entities = null;
        throw error;
      });
    }
    return this.entities;
  }

  private async load(): Promise<Entity[]> {
    const response = await fetch(this.url);
    if (!response.ok) throw new Error(`Entity data file ${this.url} failed to load: HTTP ${response.status}`);
    const records = (await response.json()) as EntityFileRecord[];
    return records.map(toEntity);
  }
}

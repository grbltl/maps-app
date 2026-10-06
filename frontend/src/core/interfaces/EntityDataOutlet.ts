import type { Coordinates, Entity } from '../types';

/**
 * What: Interface for where entity (e.g. restaurant) records come from - a
 * local data file today, a database behind our own backend later.
 * Why: This is the "outlet" the map-side entity connector plugs into.
 * Keeping storage behind it means moving from a file to a database is a new
 * implementation of this interface plus a one-line change in main.ts - the
 * map rendering, radius rule, and modal don't change at all.
 * Without it: The map connector would read a specific file format (or call a
 * specific API) directly, so switching storage would mean rewriting the
 * rendering/filtering code alongside it.
 * Inputs: n/a (interface declaration - see the method below).
 * Output: n/a (interface declaration - see the method below).
 */
export interface EntityDataOutlet {
  /**
   * What: Returns entities near a center point.
   * Why: Lets each implementation narrow the data however suits its storage
   * (a file can just return everything; a database can run an indexed radius
   * query so the browser never downloads the whole table).
   * Without it: There would be no way to ask a large store for only the
   * relevant rows.
   * Inputs: center - the visitor's location (may be sent to our own backend
   * for the query, but must never be logged or persisted there);
   * radiusMiles - the search radius.
   * Output: A Promise resolving to *at least* every entity within
   * radiusMiles of center - extras are fine, since the caller always does the
   * exact radius filtering itself in the browser. Rejects if the data can't
   * be loaded.
   */
  findNear(center: Coordinates, radiusMiles: number): Promise<Entity[]>;
}

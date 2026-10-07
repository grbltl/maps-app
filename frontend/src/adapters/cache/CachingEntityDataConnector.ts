import type { EntityDataOutlet } from '../../core/interfaces/EntityDataOutlet';
import type { Coordinates, Entity } from '../../core/types';
import { haversineDistanceMiles } from '../../utils/distance';

// Each real fetch covers this many times the requested radius, so drags
// within the extra margin are answered from memory. 2x = 4x the area.
const DEFAULT_PREFETCH_FACTOR = 2;

// Fetched areas kept in memory (most recently used first).
const DEFAULT_MAX_AREAS = 4;

interface FetchedArea {
  center: Coordinates;
  radiusMiles: number;
  entities: Promise<Entity[]>;
}

/**
 * What: EntityDataOutlet decorator that wraps any other EntityDataOutlet and
 * answers repeat searches from memory when they fall inside an area it has
 * already fetched.
 * Why: The search ring follows the map as the user drags around. With the
 * planned database backend every search would be a request; fetching a
 * wider area than asked and reusing it means most settled drags cost
 * nothing. Works for any data source, so swapping the file for the
 * database in main.ts keeps the caching.
 * Without it: Every settled drag would hit the backend, even a short drag
 * whose ring lies entirely within data already downloaded.
 * Inputs: n/a (class declaration - see each member below).
 * Output: n/a (class declaration - see each member below).
 * Privacy: fetched areas (including the first, which is centered on the
 * visitor's location) live only in this in-memory list, never in storage.
 */
export class CachingEntityDataConnector implements EntityDataOutlet {
  private areas: FetchedArea[] = [];

  /**
   * What: Stores the data source to wrap and the cache tuning.
   * Why: Injected so the cache works in front of any storage.
   * Without it: There'd be nothing to fetch from on a cache miss.
   * Inputs: inner - the real data source; prefetchFactor - how much wider
   * than requested each real fetch is; maxAreas - how many fetched areas to keep.
   * Output: n/a (constructor).
   */
  constructor(
    private readonly inner: EntityDataOutlet,
    private readonly prefetchFactor = DEFAULT_PREFETCH_FACTOR,
    private readonly maxAreas = DEFAULT_MAX_AREAS
  ) {}

  /**
   * What: Returns the entities of a fetched area that fully contains the
   * requested circle, or fetches a new, wider area.
   * Why: An area contains the circle when (distance between centers +
   * requested radius) <= the area's radius - every entity the caller needs
   * is then already in that area's results. Extras are fine: the caller
   * always does the exact radius filtering itself.
   * Without it: See the class doc.
   * Inputs: center - the search center; radiusMiles - the search radius.
   * Output: A Promise resolving to at least every entity within radiusMiles
   * of center. In-flight fetches are cached too, so overlapping calls share
   * one request; a failed fetch is forgotten so the next call retries.
   */
  findNear(center: Coordinates, radiusMiles: number): Promise<Entity[]> {
    const hit = this.areas.find(
      (area) => haversineDistanceMiles(area.center, center) + radiusMiles <= area.radiusMiles
    );
    if (hit) {
      this.areas = [hit, ...this.areas.filter((area) => area !== hit)];
      return hit.entities;
    }

    const fetchRadius = radiusMiles * this.prefetchFactor;
    const area: FetchedArea = {
      center,
      radiusMiles: fetchRadius,
      entities: this.inner.findNear(center, fetchRadius)
    };
    area.entities.catch(() => {
      this.areas = this.areas.filter((cached) => cached !== area);
    });
    this.areas = [area, ...this.areas].slice(0, this.maxAreas);
    return area.entities;
  }
}

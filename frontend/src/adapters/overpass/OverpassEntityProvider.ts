import type { Map as MapLibreMap, MapGeoJSONFeature, GeoJSONSource } from 'maplibre-gl';
import type { EntityProvider, EntityClickHandler } from '../../core/interfaces/EntityProvider';
import type { MapAdapter } from '../../core/interfaces/MapAdapter';
import type { Coordinates, Entity, EntityConfig } from '../../core/types';
import { buildOverpassQuery, parseOverpassEntities, type OverpassResponse } from './overpassQuery';
import { buildCirclePolygonFeature } from '../../utils/geoCircle';

// Tried in order; the first to respond successfully wins. Free public
// Overpass instances are individually unreliable (observed firsthand:
// overpass-api.de returned HTTP 406 to every request, including a
// completely empty query - a server-side fault, not anything query-specific
// or sandbox-specific, since it also failed differently but just as
// consistently from a real browser), so this doesn't depend on any one
// host's uptime. Each candidate must carry full-planet data, not a regional
// extract - overpass.osm.ch (Swiss community mirror) was tried and rejected
// specifically because it responds quickly with a *valid but empty* result
// for literally any query anywhere outside its coverage (confirmed: zero
// results for "any node at all" over Times Square), which is worse than an
// honest failure - it would win the race and silently report "no entities"
// instead of trying a mirror that actually has the data.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter'
];
// Overpass queries themselves budget [timeout:25] server-side (see
// buildOverpassQuery) - this is set just under that so a legitimately slow
// (not dead) server still gets a real chance to respond before we give up
// and try the next endpoint.
const OVERPASS_TIMEOUT_MS = 20000;

const SOURCE_ID = 'overpass-entities';
const LAYER_ID = 'overpass-entities-circles';
const RING_SOURCE_ID = 'overpass-search-radius';
const RING_LAYER_ID = 'overpass-search-radius-outline';

// These are the OpenFreeMap "bright" style's own POI symbol layers (see
// MapLibreEntityProvider) - this provider's whole point is to replace what
// they'd otherwise show (sparse/absent at zoomed-out views, and limited to
// whatever's in the currently-loaded tiles) with a real radius search, so
// they're removed entirely rather than left showing a competing/duplicate
// set of markers for the same category.
const BASE_STYLE_POI_LAYERS = ['poi_r1', 'poi_r7', 'poi_r20', 'poi_transit'];

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

function entityToFeature(entity: Entity): GeoJSON.Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [entity.coordinates.lng, entity.coordinates.lat] },
    properties: {
      name: entity.name,
      address: entity.details?.address ?? null,
      phone: entity.details?.phone ?? null
    }
  };
}

/**
 * What: POSTs an Overpass QL query to each endpoint in OVERPASS_ENDPOINTS in
 * order (each capped at OVERPASS_TIMEOUT_MS), returning the first successful
 * JSON response.
 * Why: A single hardcoded Overpass host is a single point of failure - free
 * public instances go down, rate-limit, or misconfigure independently of
 * each other and of anything this app does. Trying several means one host's
 * outage doesn't take the feature down with it.
 * Without it: The entire "show nearby entities" feature would depend on one
 * specific free server's uptime, with no recourse when it's unavailable
 * (as observed: overpass-api.de failed every request during testing).
 * Inputs: query - a complete Overpass QL query string.
 * Output: A Promise resolving to the first endpoint's parsed JSON response.
 * Rejects only if every endpoint failed, with all of their errors combined
 * into one message for debugging.
 */
async function fetchFromOverpass(query: string): Promise<OverpassResponse> {
  const failures: string[] = [];

  for (const endpoint of OVERPASS_ENDPOINTS) {
    const timeout = AbortSignal.timeout(OVERPASS_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: timeout
      });
      if (!response.ok) {
        failures.push(`${endpoint}: HTTP ${response.status}`);
        continue;
      }
      return (await response.json()) as OverpassResponse;
    } catch (error) {
      failures.push(`${endpoint}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`All Overpass endpoints failed - ${failures.join('; ')}`);
}

function featureToEntity(feature: MapGeoJSONFeature): Entity {
  const [lng, lat] = (feature.geometry as GeoJSON.Point).coordinates;
  const props = feature.properties as { name: string; address: string[] | null; phone: string | null };
  return {
    name: props.name,
    coordinates: { lng, lat },
    details: { address: props.address, phone: props.phone }
  };
}

/**
 * What: EntityProvider implementation that finds entities via a live radius
 * search against OpenStreetMap's Overpass API, rendered as a dedicated
 * MapLibre GeoJSON source/layer rather than filtered from the base style's
 * own vector tiles.
 * Why: The base style's vector tiles only reliably carry POI data at close
 * zoom (verified by decoding real tiles - see MapLibreEntityProvider), so
 * they can't answer "show every restaurant within N miles" at a zoomed-out
 * view. Overpass answers that directly, independent of map zoom/tiles.
 * Without it: Entities would only ever be whatever happens to be in the
 * currently-loaded, zoom-dependent base map tiles - the "all restaurants
 * within 5 miles" feature would be impossible with this tile source.
 * Inputs: n/a (class declaration - see each method below).
 * Output: n/a (class declaration - see each method below).
 */
export class OverpassEntityProvider implements EntityProvider {
  private config: EntityConfig | null = null;

  /**
   * What: Stores the MapAdapter this provider will pull the native MapLibre
   * map instance from.
   * Why: Needed to add/update the GeoJSON source and layer, and to remove
   * the base style's own POI layers it's replacing - the same native-map
   * escape hatch MapLibreEntityProvider uses.
   * Without it: There would be no way to reach the map this provider needs to configure.
   * Inputs: mapAdapter - the MapAdapter (expected to be backed by a real
   * maplibregl.Map) whose native map this provider will configure.
   * Output: n/a (constructor).
   */
  constructor(private readonly mapAdapter: MapAdapter) {}

  /**
   * What: Removes the base style's competing POI layers, adds an empty
   * GeoJSON source/circle layer for this provider's own entities, and
   * registers click/hover handlers on it.
   * Why: This is how "which category of entity is shown" gets applied to
   * the actual map (via showNear(), once a center point is known) without
   * MainPage touching MapLibre-specific source/layer APIs, and without the
   * base style's own (sparser, zoom-limited) POI icons competing with or
   * duplicating what this provider finds.
   * Without it: The base style's POI layers (and whatever limited set of
   * entities they manage to show) would remain, likely duplicating entities
   * this provider also finds once showNear() is called.
   * Inputs: config - which category to show (stored for use by showNear()
   * and as the fallback name for unnamed entities); onEntityClick - called
   * with a normalized Entity whenever one is clicked.
   * Output: None (void) - layers/handlers are applied as a side effect. The
   * map has no entities (or search-radius ring) to show yet until showNear()
   * is called.
   */
  activate(config: EntityConfig, onEntityClick: EntityClickHandler): void {
    this.config = config;
    const map = this.mapAdapter.getNativeMap() as MapLibreMap;

    BASE_STYLE_POI_LAYERS.forEach((id) => {
      if (map.getLayer(id)) map.removeLayer(id);
    });

    map.addSource(RING_SOURCE_ID, { type: 'geojson', data: emptyFeatureCollection() });
    map.addLayer({
      id: RING_LAYER_ID,
      type: 'line',
      source: RING_SOURCE_ID,
      paint: {
        'line-color': '#FF5A1F',
        'line-width': 2,
        'line-dasharray': [2, 2]
      }
    });

    map.addSource(SOURCE_ID, { type: 'geojson', data: emptyFeatureCollection() });
    map.addLayer({
      id: LAYER_ID,
      type: 'circle',
      source: SOURCE_ID,
      paint: {
        'circle-radius': 7,
        'circle-color': '#FF5A1F',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff'
      }
    });

    map.on('click', LAYER_ID, (e) => {
      const feature = e.features?.[0];
      if (!feature) return;
      onEntityClick(featureToEntity(feature));
    });
    map.on('mouseenter', LAYER_ID, () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', LAYER_ID, () => {
      map.getCanvas().style.cursor = '';
    });
  }

  /**
   * What: Draws (or redraws) the dashed search-radius ring for the given
   * center/radius, and queries Overpass for entities matching the active
   * config's OSM tag within that same radius, replacing the entities
   * source's data with the results.
   * Why: This is what actually answers "show every <category> within N
   * miles of here" and visually indicates that exact area - called by
   * MainPage once "current location" is resolved. Drawing the ring at the
   * same radiusMiles passed to the Overpass query (rather than an
   * independent constant) keeps what's drawn and what's searched always in
   * sync, so the ring never visually overstates or understates the real
   * search area.
   * Without it: The map would show the (empty) sources added by activate()
   * forever - no entities or ring would ever appear.
   * Inputs: center - the point to search around; radiusMiles - how far out to search.
   * Output: A Promise that resolves once the ring is drawn and the entities
   * source's data has been replaced with the query results. Throws if
   * activate() hasn't been called yet, or if every Overpass endpoint failed -
   * callers should treat a rejection as non-fatal (the map/location flow
   * calling this has already succeeded independently of whether entities loaded).
   */
  async showNear(center: Coordinates, radiusMiles: number): Promise<void> {
    if (!this.config) throw new Error('OverpassEntityProvider.showNear called before activate()');

    const map = this.mapAdapter.getNativeMap() as MapLibreMap;
    const ringSource = map.getSource(RING_SOURCE_ID) as GeoJSONSource;
    ringSource.setData(buildCirclePolygonFeature(center, radiusMiles));

    const query = buildOverpassQuery(this.config.osmTag, center, radiusMiles);
    const data = await fetchFromOverpass(query);
    const entities = parseOverpassEntities(data, this.config.label);

    const entitiesSource = map.getSource(SOURCE_ID) as GeoJSONSource;
    entitiesSource.setData({ type: 'FeatureCollection', features: entities.map(entityToFeature) });
  }
}

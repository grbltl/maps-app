import type { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl';
import type { EntityProviderOutlet, EntityClickHandler } from '../../core/interfaces/EntityProviderOutlet';
import type { EntityDataOutlet } from '../../core/interfaces/EntityDataOutlet';
import type { MapOutlet } from '../../core/interfaces/MapOutlet';
import type { Coordinates, Entity, EntityConfig } from '../../core/types';
import { buildCirclePolygonFeature } from '../../utils/geoCircle';
import { filterWithinRadius } from '../../utils/distance';
import { activeDeals } from '../../utils/deals';

const SOURCE_ID = 'entities';
const LAYER_ID = 'entities-circles';
const RING_SOURCE_ID = 'search-radius';
const RING_LAYER_ID = 'search-radius-outline';

const ENTITY_COLOR = '#FF5A1F';
// Entities with a deal running today stand out in a different color.
const DEAL_ENTITY_COLOR = '#16A34A';

// These are the OpenFreeMap "bright" style's own POI symbol layers (see
// MapLibreEntityConnector). They're removed so the only entities on the map
// are the ones from our EntityDataOutlet - otherwise the base tiles' own
// restaurant icons would show up at close zoom, unclickable and unrelated to
// our data.
const BASE_STYLE_POI_LAYERS = ['poi_r1', 'poi_r7', 'poi_r20', 'poi_transit'];

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

/**
 * What: EntityProviderOutlet connector that draws entities from an injected
 * EntityDataOutlet onto a MapLibre map, as its own GeoJSON source/circle
 * layer, plus a dashed ring showing the exact search radius.
 * Why: This is the map-side "plug + connector": it owns rendering, clicks,
 * deal highlighting and the exact radius rule, while the EntityDataOutlet
 * "outlet" (a file today, a database later) only supplies records. Swapping
 * the outlet never touches this class.
 * Without it: There would be nothing putting data-source entities on the map
 * or enforcing the exact search radius in the browser.
 * Inputs: n/a (class declaration - see each method below).
 * Output: n/a (class declaration - see each method below).
 */
export class MapEntityConnector implements EntityProviderOutlet {
  private activated = false;
  // The entities currently drawn, indexed by each feature's "index"
  // property, so a click hands back the full Entity (deals included) rather
  // than whatever MapLibre round-trips through feature properties (it
  // stringifies nested objects/arrays).
  private shownEntities: Entity[] = [];

  /**
   * What: Stores the map to draw on, the data source to read from, and a clock.
   * Why: The native MapLibre map is needed for sources/layers; the data
   * source is injected so storage can change without touching this class;
   * the clock decides which deals are active "today" (injectable for tests).
   * Without it: The connector would have no map to draw on and no data to show.
   * Inputs: mapOutlet - a MapOutlet backed by a real maplibregl.Map;
   * dataSource - where entity records come from; now - returns the current
   * date (defaults to the real clock).
   * Output: n/a (constructor).
   */
  constructor(
    private readonly mapOutlet: MapOutlet,
    private readonly dataSource: EntityDataOutlet,
    private readonly now: () => Date = () => new Date()
  ) {}

  /**
   * What: Removes the base style's POI layers, adds empty GeoJSON
   * sources/layers for the search-radius ring and the entities, and
   * registers click/hover handlers on the entity layer.
   * Why: Sets the map up so showNear() only has to swap in data once
   * "current location" is known, without MainPage touching MapLibre APIs.
   * Without it: showNear() would have nowhere to draw, and the base map's
   * own POI icons would compete with our entities.
   * Inputs: _config - the active category (unused: the data source already
   * holds only that category); onEntityClick - called with the full Entity
   * whenever one is clicked.
   * Output: None (void) - layers/handlers are applied as a side effect.
   * Nothing is shown until showNear() is called.
   */
  activate(_config: EntityConfig, onEntityClick: EntityClickHandler): void {
    this.activated = true;
    const map = this.mapOutlet.getNativeMap() as MapLibreMap;

    BASE_STYLE_POI_LAYERS.forEach((id) => {
      if (map.getLayer(id)) map.removeLayer(id);
    });

    map.addSource(RING_SOURCE_ID, { type: 'geojson', data: emptyFeatureCollection() });
    map.addLayer({
      id: RING_LAYER_ID,
      type: 'line',
      source: RING_SOURCE_ID,
      paint: {
        'line-color': ENTITY_COLOR,
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
        'circle-radius': ['case', ['get', 'hasActiveDeal'], 9, 7],
        'circle-color': ['case', ['get', 'hasActiveDeal'], DEAL_ENTITY_COLOR, ENTITY_COLOR],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff'
      }
    });

    map.on('click', LAYER_ID, (e) => {
      const index = e.features?.[0]?.properties?.index;
      const entity = typeof index === 'number' ? this.shownEntities[index] : undefined;
      if (entity) onEntityClick(entity);
    });
    map.on('mouseenter', LAYER_ID, () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', LAYER_ID, () => {
      map.getCanvas().style.cursor = '';
    });
  }

  /**
   * What: Draws the dashed search-radius ring, asks the data source for
   * entities near center, keeps only those exactly within radiusMiles, and
   * draws them (highlighting ones with a deal running today).
   * Why: This is where the n-mile rule is enforced, in the browser. The ring
   * and the filter use the same radiusMiles, so what's drawn always matches
   * what's included.
   * Without it: No ring or entities would ever appear.
   * Inputs: center - the point to search around; radiusMiles - how far out to include.
   * Output: A Promise that resolves once the ring and in-range entities are
   * showing. The ring is drawn before the data source is awaited, so it
   * appears even if loading is slow or fails. Rejects if activate() hasn't
   * been called or the data source fails - callers treat that as non-fatal.
   */
  async showNear(center: Coordinates, radiusMiles: number): Promise<void> {
    if (!this.activated) throw new Error('MapEntityConnector.showNear called before activate()');

    const map = this.mapOutlet.getNativeMap() as MapLibreMap;
    const ringSource = map.getSource(RING_SOURCE_ID) as GeoJSONSource;
    ringSource.setData(buildCirclePolygonFeature(center, radiusMiles));

    const candidates = await this.dataSource.findNear(center, radiusMiles);
    this.shownEntities = filterWithinRadius(candidates, center, radiusMiles);

    const today = this.now();
    const features: GeoJSON.Feature[] = this.shownEntities.map((entity, index) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [entity.coordinates.lng, entity.coordinates.lat] },
      properties: {
        index,
        hasActiveDeal: activeDeals(entity.details?.deals, today).length > 0
      }
    }));

    const entitiesSource = map.getSource(SOURCE_ID) as GeoJSONSource;
    entitiesSource.setData({ type: 'FeatureCollection', features });
  }
}

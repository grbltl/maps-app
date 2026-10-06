import type { Map as MapLibreMap, MapGeoJSONFeature, FilterSpecification } from 'maplibre-gl';
import type { EntityProvider, EntityClickHandler } from '../../core/interfaces/EntityProvider';
import type { MapAdapter } from '../../core/interfaces/MapAdapter';
import type { Entity, EntityConfig } from '../../core/types';

// All POI categories in OpenFreeMap's "bright" style (bus stops, hospitals,
// restaurants, clothing stores, ...) share one "poi" source-layer and are
// split across these rank-based symbol layers, distinguished only by a
// "class" property - so entities are surfaced by narrowing each layer's
// filter to the configured categoryValues, not by removing/adding layers.
const POI_LAYERS = ['poi_r1', 'poi_r7', 'poi_r20'];

// Bus/rail/airport icons specifically, regardless of category filtering above
// - a quirk of this vendor's style, not a generic POI category, so it's
// always dropped rather than exposed through EntityConfig.
const TRANSIT_LAYER = 'poi_transit';

/**
 * What: EntityProvider implementation that surfaces POIs from MapLibre's
 * OpenFreeMap "bright" style by filtering its rank-based POI layers to a
 * configured category.
 * Why: This is today's concrete entity "connector" - the thing that knows
 * how this specific vendor's vector tiles expose POI categories, so
 * MainPage can stay ignorant of that mechanism entirely.
 * Without it: There would be no way to find or click restaurants/clothing
 * stores/etc on the MapLibre map; EntityProvider is just a contract, this
 * class is what fulfills it for MapLibre/OpenFreeMap specifically.
 * Inputs: n/a (class declaration - see the method below).
 * Output: n/a (class declaration - see the method below).
 */
export class MapLibreEntityProvider implements EntityProvider {
  /**
   * What: Stores the MapAdapter this provider will pull the native MapLibre
   * map instance from.
   * Why: EntityProvider needs direct access to the real maplibregl.Map to
   * register layer filters/click handlers, which MapAdapter exposes via
   * getNativeMap() specifically for this purpose.
   * Without it: There would be no way to reach the map this provider needs
   * to configure.
   * Inputs: mapAdapter - the MapAdapter (expected to be a MapLibreMapAdapter,
   * or at least backed by a real maplibregl.Map) whose native map this
   * provider will filter/listen on.
   * Output: n/a (constructor).
   */
  constructor(private readonly mapAdapter: MapAdapter) {}

  /**
   * What: Narrows the style's POI layers to the configured category, drops
   * the transit-icon layer, and registers click/hover handlers on the
   * remaining POI layers.
   * Why: This is how "which category of entity is shown" gets applied to
   * the actual map, and how MainPage finds out when one is clicked - without
   * MainPage ever touching MapLibre-specific filter/layer APIs.
   * Without it: Every POI category the base style ships with (bus stops,
   * hospitals, hardware stores, ...) would render and be clickable, and
   * there would be no click events reaching the app at all.
   * Inputs: config - which category to show (categoryValues matched against
   * each POI feature's "class" property, label used as a fallback name);
   * onEntityClick - called with a normalized Entity whenever a matching POI
   * is clicked.
   * Output: None (void) - layer filters/handlers are applied as a side
   * effect. Safe to call again with a new config to retarget the category.
   */
  activate(config: EntityConfig, onEntityClick: EntityClickHandler): void {
    const map = this.mapAdapter.getNativeMap() as MapLibreMap;

    POI_LAYERS.forEach((id) => {
      const existingFilter = map.getFilter(id);
      map.setFilter(id, [
        'all',
        existingFilter ?? true,
        ['in', ['get', 'class'], ['literal', config.categoryValues]]
      ] as unknown as FilterSpecification);
    });

    if (map.getLayer(TRANSIT_LAYER)) map.removeLayer(TRANSIT_LAYER);

    POI_LAYERS.forEach((id) => {
      map.on('click', id, (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        onEntityClick(toEntity(feature, config));
      });
      map.on('mouseenter', id, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', id, () => {
        map.getCanvas().style.cursor = '';
      });
    });
  }
}

/**
 * What: Converts a raw MapLibre vector-tile feature into the app's
 * vendor-agnostic Entity shape.
 * Why: Keeps MapLibre-specific feature/geometry shapes out of MainPage,
 * which only ever deals with the normalized Entity type.
 * Without it: MainPage would need to know about GeoJSON feature/geometry
 * structure and MapLibre's specific property bag, re-coupling it to this
 * vendor.
 * Inputs: feature - the raw MapLibre GeoJSON point feature clicked; config -
 * used for its label, as a fallback when the feature has no name property.
 * Output: A normalized Entity (name + coordinates).
 */
function toEntity(feature: MapGeoJSONFeature, config: EntityConfig): Entity {
  const [lng, lat] = (feature.geometry as GeoJSON.Point).coordinates;
  const name = (feature.properties?.name as string | undefined) || config.label;
  return { name, coordinates: { lng, lat } };
}

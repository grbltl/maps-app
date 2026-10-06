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

export class MapLibreEntityProvider implements EntityProvider {
  constructor(private readonly mapAdapter: MapAdapter) {}

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

function toEntity(feature: MapGeoJSONFeature, config: EntityConfig): Entity {
  const [lng, lat] = (feature.geometry as GeoJSON.Point).coordinates;
  const name = (feature.properties?.name as string | undefined) || config.label;
  return { name, coordinates: { lng, lat } };
}

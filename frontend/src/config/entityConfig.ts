import type { EntityConfig } from '../core/types';

// OpenMapTiles' "poi" layer tags points with a "class" value drawn from OSM
// tags (amenity=restaurant -> class "restaurant", shop=clothes -> "clothes",
// shop=shoes -> "shoes", etc) - that's what categoryValues matches against,
// for tile-filtering providers. osmTag is the same category expressed as a
// real OSM key/value pair, for tag-query providers (e.g. Overpass), since
// OSM splits categories across different keys entirely (amenity vs shop),
// not just different values of one shared property. To retarget this whole
// app at a different category, change both fields here - nothing else in
// the app needs to know or care what category it's showing.
export const restaurantEntityConfig: EntityConfig = {
  label: 'Restaurant',
  categoryValues: ['restaurant'],
  osmTag: { key: 'amenity', values: ['restaurant'] }
};

export const clothingStoreEntityConfig: EntityConfig = {
  label: 'Clothing Store',
  categoryValues: ['clothes', 'shoes', 'bag', 'fashion_accessories'],
  osmTag: { key: 'shop', values: ['clothes', 'shoes', 'bags', 'fashion_accessories'] }
};

// The config actually wired up by the composition root (src/main.ts).
export const activeEntityConfig: EntityConfig = restaurantEntityConfig;

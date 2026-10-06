import type { EntityConfig } from '../core/types';

// OpenMapTiles' "poi" layer tags points with a "class" value drawn from OSM
// tags (amenity=restaurant -> class "restaurant", shop=clothes -> "clothes",
// shop=shoes -> "shoes", etc). To retarget this whole app at a different
// category, change categoryValues here - nothing else in the app needs to
// know or care what category it's showing.
export const restaurantEntityConfig: EntityConfig = {
  label: 'Restaurant',
  categoryValues: ['restaurant']
};

export const clothingStoreEntityConfig: EntityConfig = {
  label: 'Clothing Store',
  categoryValues: ['clothes', 'shoes', 'bag', 'fashion_accessories']
};

// The config actually wired up by the composition root (src/main.ts).
export const activeEntityConfig: EntityConfig = restaurantEntityConfig;

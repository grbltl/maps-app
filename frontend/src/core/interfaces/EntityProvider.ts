import type { Entity, EntityConfig } from '../types';

export type EntityClickHandler = (entity: Entity) => void;

/**
 * Finds/surfaces points of interest for whatever category an EntityConfig
 * describes, on whatever underlying map a matching MapAdapter is driving.
 * This is what makes the app generic over "restaurants" vs. "clothing
 * stores" vs. anything else: the config is the only thing that changes.
 */
export interface EntityProvider {
  /** Start showing entities matching the given config and invoke the handler
   * when one is clicked. Safe to call again with a new config to retarget
   * the category (e.g. switching from restaurants to clothing stores). */
  activate(config: EntityConfig, onEntityClick: EntityClickHandler): void;
}

import type { Coordinates, Entity, EntityConfig } from '../types';

export type EntityClickHandler = (entity: Entity) => void;

/**
 * What: Interface for finding/surfacing points of interest for whatever
 * category an EntityConfig describes, on whatever underlying map a matching
 * MapOutlet is driving.
 * Why: This is what makes the app generic over "restaurants" vs. "clothing
 * stores" vs. anything else - the config is the only thing that should need
 * to change to retarget the app, and this interface is what makes that true
 * by keeping category-matching logic out of MainPage/Modal.
 * Without it: Entity discovery/click-handling would be written directly
 * against one vendor's POI mechanism inside MainPage, so switching category
 * or map vendor would mean rewriting UI code instead of swapping a connector.
 * Inputs: n/a (interface declaration - see the method below).
 * Output: n/a (interface declaration - see the method below).
 */
export interface EntityProviderOutlet {
  /**
   * What: Starts showing entities matching the given config and invokes the
   * handler whenever one is clicked.
   * Why: MainPage needs to react to entity clicks (to open the info modal)
   * without knowing how a particular map vendor exposes POI data or click
   * events.
   * Without it: MainPage would have to register vendor-specific click
   * listeners itself, re-coupling it to one map/data connector.
   * Inputs: config - which category of entity to surface (e.g. restaurants);
   * onEntityClick - called with a normalized Entity whenever one is clicked.
   * Output: None (void) - entities start appearing/responding to clicks as a
   * side effect. Safe to call again with a new config to retarget the
   * category (e.g. switching from restaurants to clothing stores).
   */
  activate(config: EntityConfig, onEntityClick: EntityClickHandler): void;

  /**
   * What: (Re)loads entities within a radius of a center point.
   * Why: Some connectors' entity data isn't tied to whatever map tiles happen
   * to be on screen (e.g. MapEntityConnector, which reads our own
   * EntityDataOutlet and keeps what's within 5 miles of here) - this is how
   * MainPage tells such a connector where "here" is, once it knows. Optional
   * because it's meaningless for a connector whose entities already come from
   * the visible map tiles (e.g. MapLibreEntityConnector) - activate() alone
   * covers that connector's whole behavior.
   * Without it: A radius-search connector would have no way to know what
   * point to search around, since activate() only runs once at startup,
   * before "current location" exists.
   * Inputs: center - the point to search around; radiusMiles - how far out to search.
   * Output: A Promise that resolves once entities within range are loaded
   * and showing (or rejects if the search failed - callers should treat this
   * as non-fatal, since the map/current-location flow it's attached to has
   * already succeeded independently).
   */
  showNear?(center: Coordinates, radiusMiles: number): Promise<void>;
}

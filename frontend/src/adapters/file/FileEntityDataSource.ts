import type { EntityDataSource } from '../../core/interfaces/EntityDataSource';
import type { Coordinates, Entity } from '../../core/types';

/**
 * What: EntityDataSource implementation that reads entity records from a
 * local data file (spreadsheet/CSV/...).
 * Why: This is the socket the app is plugged into for now, while the data
 * set is small enough to ship as a file. A database-backed EntityDataSource
 * replaces it once the data outgrows that.
 * Without it: The map provider would have no data source to plug into.
 * Inputs: n/a (class declaration - see the method below).
 * Output: n/a (class declaration - see the method below).
 */
export class FileEntityDataSource implements EntityDataSource {
  /**
   * What: Returns every entity in the data file.
   * Why: A file is loaded whole, so there's nothing to gain from narrowing
   * it here - the caller does the exact radius filtering.
   * Without it: No entities could ever be shown from the file.
   * Inputs: _center, _radiusMiles - unused (see Why).
   * Output: A Promise resolving to every entity in the file. The file format
   * hasn't been chosen and no data file exists yet, so this resolves to an
   * empty list and the map shows no entities.
   */
  async findNear(_center: Coordinates, _radiusMiles: number): Promise<Entity[]> {
    return [];
  }
}

import type { FieldContext } from '../domain/fieldDictionary';
import type { Certificate, ClockChange, CrewDocument, CrewMember, Voyage } from '../domain/types';
import { listForShip } from './records';
import type { MasterpieceDB } from './schema';

/**
 * Everything `resolveField` reads for one ship, loaded in one consistent read: the ship, and its crew, voyages,
 * certificates, crew documents and clock changes. Deleted records are left out. `nowUtc` is the instant the dictionary
 * takes as now (`today`, `now`, the ship's offset); the caller passes it so that one fill uses one instant. Throws when
 * the ship does not exist or is deleted.
 */
export function loadFieldContext(db: MasterpieceDB, shipId: string, nowUtc: Date): Promise<FieldContext> {
  // Dexie keeps this transaction open across the awaits only because the callback is an async function.
  return db.transaction('r', [db.ships, db.crew, db.voyages, db.certificates, db.crewDocuments, db.clockChanges], async () => {
    const ship = await db.ships.get(shipId);
    if (!ship || ship.deleted) throw new Error(`There is no ship with id ${shipId}.`);
    const [crew, voyages, certificates, crewDocuments, clockChanges] = await Promise.all([
      listForShip<CrewMember>(db, 'crew', shipId),
      listForShip<Voyage>(db, 'voyages', shipId),
      listForShip<Certificate>(db, 'certificates', shipId),
      listForShip<CrewDocument>(db, 'crewDocuments', shipId),
      listForShip<ClockChange>(db, 'clockChanges', shipId),
    ]);
    return { ship, crew, voyages, certificates, crewDocuments, clockChanges, nowUtc };
  });
}

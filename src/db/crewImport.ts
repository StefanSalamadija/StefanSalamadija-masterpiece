import type { ImportPlan } from '../domain/crewImport/plan';
import type { CrewImportMapping, CrewMember, ShipProfile } from '../domain/types';
import { createRecord, updateRecord } from './records';
import type { MasterpieceDB } from './schema';
import { takeSnapshot } from './snapshots';
import { guardWrite } from './storage';

/**
 * Writes an import: first a `'before-import'` snapshot named after the file, then, in one transaction, the new
 * contracts, the changed fields of the updated ones and the column mapping on the ship. If any write fails, none of
 * them is made (the snapshot stays). Returns how many contracts were written.
 */
export async function importCrew(
  db: MasterpieceDB, ship: ShipProfile, plan: ImportPlan, mapping: CrewImportMapping, fileName: string,
): Promise<number> {
  await takeSnapshot(db, 'before-import', fileName);
  await guardWrite(() =>
    // `settings` is in the scope because `createRecord` and `updateRecord` read the device id from it.
    db.transaction('rw', [db.ships, db.crew, db.settings], async () => {
      for (const draft of plan.creates) await createRecord<CrewMember>(db, 'crew', { shipId: ship.id, ...draft });
      for (const { id, patch } of plan.updates) await updateRecord<CrewMember>(db, 'crew', id, patch);
      await updateRecord<ShipProfile>(db, 'ships', ship.id, { crewImportMapping: mapping });
    }),
  );
  return plan.creates.length + plan.updates.length;
}

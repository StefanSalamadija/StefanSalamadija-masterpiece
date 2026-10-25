import { currentVoyage } from '../domain/voyage';
import type { VoyageFields } from '../domain/voyage';
import type { Voyage } from '../domain/types';
import { createRecord, listForShip, updateRecord } from './records';
import type { MasterpieceDB } from './schema';
import { guardWrite } from './storage';

/**
 * Saves the ship's current voyage: updates its active voyage, or begins one if it has none. The choice is made inside
 * the transaction that writes, so two saves in a row never leave two voyages.
 */
export function saveCurrentVoyage(db: MasterpieceDB, shipId: string, fields: VoyageFields): Promise<Voyage> {
  return guardWrite(() =>
    db.transaction('rw', [db.voyages, db.settings], async () => {
      const current = currentVoyage(await listForShip<Voyage>(db, 'voyages', shipId));
      if (current) return updateRecord<Voyage>(db, 'voyages', current.id, fields);
      return createRecord<Voyage>(db, 'voyages', { shipId, active: true, ...fields });
    }),
  );
}

/**
 * Ends the ship's active voyage (every one, if two devices each began one) and begins a blank one, in one transaction:
 * either both happen or neither. `etaOffsetMinutes` is the new voyage's ETA offset, which the form starts from.
 */
export function startNewVoyage(db: MasterpieceDB, shipId: string, etaOffsetMinutes: number): Promise<Voyage> {
  return guardWrite(() =>
    db.transaction('rw', [db.voyages, db.settings], async () => {
      for (const voyage of await listForShip<Voyage>(db, 'voyages', shipId)) {
        if (voyage.active) await updateRecord<Voyage>(db, 'voyages', voyage.id, { active: false });
      }
      return createRecord<Voyage>(db, 'voyages', {
        shipId, active: true, voyageNo: '', lastPort: '', nextPort: '', etaLocal: '', etaOffsetMinutes, cargo: '',
        charterers: '', agents: '',
      });
    }),
  );
}

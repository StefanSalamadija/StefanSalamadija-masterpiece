import { shipOffsetAt } from '../domain/shipTime';
import { certificateShell, copyParticulars } from '../domain/profileCopy';
import { TABLE_NAMES } from '../domain/types';
import type { Certificate, ClockChange, Particulars, ShipProfile } from '../domain/types';
import { createRecord, listForShip } from './records';
import type { MasterpieceDB } from './schema';
import { syncTable, syncTables } from './schema';
import { getSettings, updateSettings } from './settings';
import { guardWrite } from './storage';

function emptyParticulars(name: string): Particulars {
  return { name, imo: '', callSign: '', mmsi: '', flag: '', portOfRegistry: '', owners: '', managers: '', pandi: '', classSociety: '' };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The live ships, oldest first (ties by id), so "the first remaining ship" is the same on every device. */
export async function listShips(db: MasterpieceDB): Promise<ShipProfile[]> {
  const ships = await db.ships.filter((s) => !s.deleted).toArray();
  return ships.sort((a, b) => compare(a.createdAt, b.createdAt) || compare(a.id, b.id));
}

/**
 * Adds a ship and its first clock change, and makes it the active ship if there is none.
 * Must run inside a read-write transaction on `ships`, `clockChanges` and `settings`.
 */
async function addShip(db: MasterpieceDB, particulars: Particulars, offsetMinutes: number, now: Date): Promise<ShipProfile> {
  const ship = await createRecord<ShipProfile>(db, 'ships', { particulars });
  await createRecord<ClockChange>(db, 'clockChanges', {
    shipId: ship.id, effectiveAt: now.toISOString(), toOffsetMinutes: offsetMinutes,
  });
  if (!(await getSettings(db)).activeShipId) await updateSettings(db, { activeShipId: ship.id });
  return ship;
}

/** A new ship with blank particulars apart from its name, whose clock starts now at `offsetMinutes` from UTC. */
export function createShip(db: MasterpieceDB, name: string, offsetMinutes: number, now: Date = new Date()): Promise<ShipProfile> {
  return guardWrite(() =>
    db.transaction('rw', [db.ships, db.clockChanges, db.settings], async () => addShip(db, emptyParticulars(name), offsetMinutes, now)),
  );
}

/** What deleting the ship would remove, for the confirmation: live records only. */
export async function deleteSummary(
  db: MasterpieceDB, shipId: string,
): Promise<{ crew: number; certificates: number; voyages: number; clockChanges: number }> {
  const [crew, certificates, voyages, clockChanges] = await Promise.all(
    (['crew', 'certificates', 'voyages', 'clockChanges'] as const).map(async (table) => (await listForShip(db, table, shipId)).length),
  );
  return { crew, certificates, voyages, clockChanges };
}

/**
 * Soft-deletes the ship and every live record that belongs to it, in one transaction. Records that were already
 * deleted keep their own deletion time. If the ship was the active one, the first remaining ship becomes active.
 */
export async function deleteShip(db: MasterpieceDB, shipId: string): Promise<void> {
  const { deviceId } = await getSettings(db);
  await guardWrite(() =>
    db.transaction('rw', [...syncTables(db), db.settings], async () => {
      const ship = await db.ships.get(shipId);
      if (!ship) throw new Error(`There is no ship with id ${shipId}.`);
      const stamp = { deleted: true, updatedAt: new Date().toISOString(), updatedBy: deviceId };
      if (!ship.deleted) await db.ships.put({ ...ship, ...stamp });
      for (const name of TABLE_NAMES.filter((n) => n !== 'ships')) {
        const table = syncTable(db, name);
        const live = await table.where('shipId').equals(shipId).filter((r) => !r.deleted).toArray();
        await table.bulkPut(live.map((r) => ({ ...r, ...stamp })));
      }
      if ((await getSettings(db)).activeShipId === shipId) {
        await updateSettings(db, { activeShipId: (await listShips(db))[0]?.id });
      }
    }),
  );
}

/**
 * A sister ship: the source's particulars without its identity (IMO, call sign, MMSI) under `newName`, a first clock
 * change at the source's offset now, and optionally its certificates as empty shells. Crew, voyages, clock history and
 * the crew import mapping are never copied.
 */
export function copyShip(
  db: MasterpieceDB, sourceId: string, newName: string, opts: { includeCertificates: boolean },
): Promise<ShipProfile> {
  return guardWrite(() =>
    db.transaction('rw', [db.ships, db.clockChanges, db.certificates, db.settings], async () => {
      const source = await db.ships.get(sourceId);
      if (!source || source.deleted) throw new Error(`There is no ship with id ${sourceId} to copy.`);
      const now = new Date();
      const offset = shipOffsetAt(await listForShip<ClockChange>(db, 'clockChanges', sourceId), now);
      const ship = await addShip(db, copyParticulars(source.particulars, newName), offset, now);
      if (opts.includeCertificates) {
        for (const certificate of await listForShip<Certificate>(db, 'certificates', sourceId)) {
          await createRecord<Certificate>(db, 'certificates', { shipId: ship.id, ...certificateShell(certificate) });
        }
      }
      return ship;
    }),
  );
}

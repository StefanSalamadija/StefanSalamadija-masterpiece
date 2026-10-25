import { allTables, putRecords } from '../db/records';
import { syncTables } from '../db/schema';
import type { MasterpieceDB } from '../db/schema';
import { getSettings, updateSettings } from '../db/settings';
import { listShips } from '../db/ships';
import { takeSnapshot } from '../db/snapshots';
import { guardWrite } from '../db/storage';
import { computeMerge, resolveMerge } from '../domain/merge';
import type { MergeDecisions, MergePlan } from '../domain/merge';
import { shipOffsetAt, toShipLocal } from '../domain/shipTime';
import { TABLE_NAMES } from '../domain/types';
import type { ClockChange, ShipProfile, SyncRecord, TableName, Tables } from '../domain/types';
import { DamagedFileError, openBackup, sealBackup } from './envelope';
import type { BackupHeader } from './envelope';
import { backupFileName } from './fileName';

export interface PreparedImport { header: BackupHeader; plan: MergePlan }

/** A handover holds one ship: its own record, and the ship-scope records (tombstones too) that carry its `shipId`. */
export function collectHandover(t: Tables, shipId: string): Tables {
  const belongs = (name: TableName, r: SyncRecord): boolean =>
    r.scope === 'ship' && (name === 'ships' ? r.id === shipId : (r as { shipId?: string }).shipId === shipId);
  const out = {} as Tables;
  for (const name of TABLE_NAMES) out[name] = t[name].filter((r) => belongs(name, r));
  return out;
}

/**
 * Seals this device's data into a backup file. `shipId` names the ship the file is named after (its name and its
 * current ship's time); for a handover it is also the one ship exported. A full export, which has every ship and
 * table and every tombstone, also resets the backup reminder; a handover does not.
 */
export async function exportBackup(
  db: MasterpieceDB, kind: 'full' | 'handover', password: string, opts: { shipId: string; iterations?: number },
): Promise<{ fileName: string; text: string }> {
  const settings = await getSettings(db);
  const tables = await allTables(db);
  const ship = (tables.ships as ShipProfile[]).find((s) => s.id === opts.shipId);
  if (!ship) throw new Error(`There is no ship with id ${opts.shipId}.`);

  const now = new Date();
  const clock = (tables.clockChanges as ClockChange[]).filter((c) => c.shipId === ship.id);
  const fileName = backupFileName(kind, ship.particulars.name, toShipLocal(now, shipOffsetAt(clock, now)).dateTime);
  const header: BackupHeader = {
    format: 'masterpiece-backup', version: 1, kind, deviceId: settings.deviceId, deviceName: settings.deviceName,
    exportedAt: now.toISOString(),
  };
  const payload = { tables: kind === 'full' ? tables : collectHandover(tables, ship.id) };
  const text = await sealBackup(header, payload, password, { iterations: opts.iterations });
  if (kind === 'full') await updateSettings(db, { lastExportAt: header.exportedAt, firstExportDone: true });
  return { fileName, text };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): boolean {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

/**
 * The envelope only checks that each record has an `id` and an `updatedAt` string. Everything the app and the merge
 * rely on is checked here, before any of it can reach the database.
 */
function assertWellFormed(tables: Tables): void {
  for (const name of TABLE_NAMES) {
    for (const record of tables[name]) {
      const r = record as unknown as Record<string, unknown>;
      const ok = (r.scope === 'ship' || r.scope === 'personal') && typeof r.deleted === 'boolean'
        && isTimestamp(r.createdAt) && isTimestamp(r.updatedAt)
        && (name === 'ships' ? isObject(r.particulars) : typeof r.shipId === 'string');
      if (!ok) throw new DamagedFileError();
    }
  }
}

/** Opens a backup file and works out what importing it would change. Writes nothing. Throws the envelope's errors, or `DamagedFileError`. */
export async function prepareImport(db: MasterpieceDB, text: string, password: string): Promise<PreparedImport> {
  const { header, payload } = await openBackup(text, password);
  assertWellFormed(payload.tables);
  const [local, settings] = await Promise.all([allTables(db), getSettings(db)]);
  return { header, plan: computeMerge(local, payload.tables, settings.lastSync[header.deviceId]) };
}

/**
 * Merges a prepared import into this device. The data as it is now is first saved as a `'before-import'` snapshot.
 * The records, the time of this exchange with the other device (`lastSync`) and the active ship are then saved in one
 * transaction, so a failed write leaves all three as they were. Throws, before touching anything, if a conflict has
 * no decision.
 */
export async function applyImport(db: MasterpieceDB, p: PreparedImport, decisions: MergeDecisions): Promise<void> {
  const { deviceId } = await getSettings(db);
  const writes = resolveMerge(p.plan, decisions, new Date().toISOString(), deviceId);
  await takeSnapshot(db, 'before-import');
  await guardWrite(() =>
    db.transaction('rw', [...syncTables(db), db.settings], async () => {
      await putRecords(db, writes);
      const settings = await getSettings(db);
      const ships = await listShips(db);
      // The active ship must be a live one: keep it if it is, else the first live ship, else none.
      const activeShipId = ships.some((ship) => ship.id === settings.activeShipId) ? settings.activeShipId : ships[0]?.id;
      await updateSettings(db, { lastSync: { ...settings.lastSync, [p.header.deviceId]: p.header.exportedAt }, activeShipId });
    }),
  );
}

import { allTables, putRecords } from '../db/records';
import { syncTable, syncTables } from '../db/schema';
import type { MasterpieceDB } from '../db/schema';
import { getSettings, updateSettings } from '../db/settings';
import { listShips, liveActiveShipId } from '../db/ships';
import { takeSnapshot } from '../db/snapshots';
import { guardWrite } from '../db/storage';
import { computeMerge, resolveMerge } from '../domain/merge';
import type { MergeDecisions, MergePlan } from '../domain/merge';
import { shipOffsetAt, toShipLocal } from '../domain/shipTime';
import { TABLE_NAMES } from '../domain/types';
import type { ClockChange, ShipProfile, SyncRecord, TableName, Tables } from '../domain/types';
import { DamagedFileError, StaleReviewError, openBackup, sealBackup, validatePassword } from './envelope';
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
 * current ship's time); for a handover it is also the one ship exported. A full export has every ship and table and
 * every tombstone. It writes nothing to the settings: the file has not left the device yet, so the caller records a
 * full backup with `recordFullBackup(db, exportedAt)` once the user has shared or saved it.
 */
export async function exportBackup(
  db: MasterpieceDB, kind: 'full' | 'handover', password: string, opts: { shipId: string; iterations?: number },
): Promise<{ fileName: string; text: string; exportedAt: string }> {
  const weak = validatePassword(password);
  if (weak) throw new Error(weak);
  const settings = await getSettings(db);
  const tables = await allTables(db);
  const ship = (tables.ships as ShipProfile[]).find((s) => s.id === opts.shipId && !s.deleted);
  if (!ship) throw new Error(`Ship not found: ${opts.shipId}`);

  const now = new Date();
  const clock = (tables.clockChanges as ClockChange[]).filter((c) => c.shipId === ship.id);
  // Only an object is checked on import, so a hand-edited file may have no name; the file name must still be made.
  const shipName = String(ship.particulars.name ?? '');
  const fileName = backupFileName(kind, shipName, toShipLocal(now, shipOffsetAt(clock, now)).dateTime);
  const header: BackupHeader = {
    format: 'masterpiece-backup', version: 1, kind, deviceId: settings.deviceId, deviceName: settings.deviceName,
    exportedAt: now.toISOString(),
  };
  const payload = { tables: kind === 'full' ? tables : collectHandover(tables, ship.id) };
  const text = await sealBackup(header, payload, password, { iterations: opts.iterations });
  return { fileName, text, exportedAt: header.exportedAt };
}

/** Marks a full backup as made at `exportedAt` (from `exportBackup`), which resets the backup reminder. Call it once the file was shared or saved. */
export async function recordFullBackup(db: MasterpieceDB, exportedAt: string): Promise<void> {
  await updateSettings(db, { lastExportAt: exportedAt, firstExportDone: true });
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

/** The later of two instants; an `existing` that is missing or unreadable gives way to `incoming`. */
function laterOf(existing: string | undefined, incoming: string): string {
  if (existing === undefined) return incoming;
  const known = Date.parse(existing);
  return Number.isNaN(known) || Date.parse(incoming) > known ? incoming : existing;
}

/**
 * Throws `StaleReviewError` unless every record the review compared the file with is still as the review saw it: the
 * same `updatedAt` for a record that was there, and still absent for one that was added. Without this an import would
 * write the file's version over a change made here after the review (in another tab, say), and a conflict settled as
 * "keep this device's version" would write back the old copy of this device's record. Run inside the write transaction
 * it is exact; run before it, it only keeps a refused review from using up a snapshot.
 */
async function assertReviewCurrent(db: MasterpieceDB, plan: MergePlan): Promise<void> {
  for (const table of TABLE_NAMES) {
    const items = plan.items.filter((item) => item.table === table);
    if (items.length === 0) continue;
    const current = await syncTable(db, table).bulkGet(items.map((item) => item.id));
    const stale = items.some((item, i) => (item.local === undefined ? current[i] !== undefined : current[i]?.updatedAt !== item.local.updatedAt));
    if (stale) throw new StaleReviewError();
  }
}

/**
 * Merges a prepared import into this device. First it checks that the data here is still what the review saw
 * (`StaleReviewError` if not, before anything is written, a snapshot included, so that a refused review never uses up
 * one of the snapshots). When it writes anything, the data as it is now is then saved as a `'before-import'` snapshot
 * (an import that changes nothing must not push an older snapshot out). The records, the time of this exchange with the
 * other device (`lastSync`, never moved back) and the active ship are then saved in one transaction, which checks the
 * review once more, so a change made while the snapshot was taken is not written over either, and a failed write leaves
 * all three as they were. Throws, before touching anything, if a conflict has no decision.
 */
export async function applyImport(db: MasterpieceDB, p: PreparedImport, decisions: MergeDecisions): Promise<void> {
  const { deviceId } = await getSettings(db);
  const writes = resolveMerge(p.plan, decisions, new Date().toISOString(), deviceId);
  await assertReviewCurrent(db, p.plan);
  if (writes.length > 0) await takeSnapshot(db, 'before-import');
  await guardWrite(() =>
    db.transaction('rw', [...syncTables(db), db.settings], async () => {
      await assertReviewCurrent(db, p.plan);
      await putRecords(db, writes);
      const settings = await getSettings(db);
      const from = p.header.deviceId;
      await updateSettings(db, {
        lastSync: { ...settings.lastSync, [from]: laterOf(settings.lastSync[from], p.header.exportedAt) },
        activeShipId: liveActiveShipId(settings.activeShipId, await listShips(db)),
      });
    }),
  );
}

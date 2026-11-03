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
import { isBase64 } from './crypto';
import {
  BackupTooLargeError, DamagedFileError, MAX_BACKUP_FILE_BYTES, StaleReviewError, openBackup, sealBackup, validatePassword,
} from './envelope';
import type { BackupHeader } from './envelope';
import { backupFileName } from './fileName';

export interface PreparedImport { header: BackupHeader; plan: MergePlan }

/**
 * A handover holds one ship: its own record, and the ship-scope records (tombstones too) that carry its `shipId`, its
 * form drafts, last values and photos among them. The forms library is personal, so that rule never picks it up: with
 * `includeLibrary` the live templates are added, so that the relief can fill the ship's forms. Deleted templates stay
 * out: the merge does not need them (a relief's own templates have ids of their own), and a library the relief received
 * earlier is theirs to keep or prune. A ship that is not there gives an empty handover, with no library either.
 */
export function collectHandover(t: Tables, shipId: string, opts: { includeLibrary: boolean }): Tables {
  const belongs = (name: TableName, r: SyncRecord): boolean =>
    r.scope === 'ship' && (name === 'ships' ? r.id === shipId : (r as { shipId?: string }).shipId === shipId);
  const out = {} as Tables;
  for (const name of TABLE_NAMES) out[name] = t[name].filter((r) => belongs(name, r));
  if (opts.includeLibrary && out.ships.length > 0) out.formTemplates = t.formTemplates.filter((r) => r.scope === 'personal' && !r.deleted);
  return out;
}

/**
 * Seals this device's data into a backup file. `shipId` names the ship the file is named after (its name and its
 * current ship's time); for a handover it is also the one ship exported, with the forms library only when
 * `includeLibrary` is set (see `collectHandover`; leaving it out leaves the library out). A full export has every ship and
 * table and every tombstone, the library included. A file larger than an import takes (`MAX_BACKUP_FILE_BYTES`, or
 * `maxBytes` for tests) is refused with `BackupTooLargeError`: it would be a backup that could not be restored. It writes
 * nothing to the settings: the file has not left the device yet, so the caller records a full backup with
 * `recordFullBackup(db, exportedAt)` once the user has shared or saved it.
 */
export async function exportBackup(
  db: MasterpieceDB, kind: 'full' | 'handover', password: string,
  opts: { shipId: string; includeLibrary?: boolean; iterations?: number; maxBytes?: number },
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
  const payload = { tables: kind === 'full' ? tables : collectHandover(tables, ship.id, { includeLibrary: opts.includeLibrary === true }) };
  const text = await sealBackup(header, payload, password, { iterations: opts.iterations });
  const limit = opts.maxBytes ?? MAX_BACKUP_FILE_BYTES;
  if (utf8ByteLength(text, limit) > limit) throw new BackupTooLargeError();
  return { fileName, text, exportedAt: header.exportedAt };
}

/**
 * The size of `text` as UTF-8, as the saved file has it, counted only as far as is needed to know it is over `limit`
 * (a UTF-8 file is never smaller than its number of UTF-16 units, so a text longer than `limit` is over at once).
 */
function utf8ByteLength(text: string, limit: number): number {
  if (text.length > limit) return text.length;
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) {
      bytes += 4; // a surrogate pair is one character of 4 bytes
      i += 1;
    } else bytes += 3;
  }
  return bytes;
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

/** Base64 text, as the forms tables keep their files and photos in (`''` for a photo's tombstone). */
function isBase64Text(value: unknown): boolean {
  return typeof value === 'string' && isBase64(value);
}

/**
 * What a record of `name` needs beyond what every record needs: what it belongs to, and what the app reads from it
 * without checking again. Every table but the ships and the forms library belongs to a ship by its `shipId`.
 */
function hasOwnFields(name: TableName, r: Record<string, unknown>): boolean {
  if (name === 'ships') return isObject(r.particulars);
  // The library is personal and belongs to no ship. Its file is what every filled form is made from.
  if (name === 'formTemplates') {
    return r.scope === 'personal' && typeof r.code === 'string' && isBase64Text(r.fileBase64) && isObject(r.schema) && isObject(r.setup);
  }
  if (typeof r.shipId !== 'string') return false;
  switch (name) {
    // A document is found by its contract; without one it would belong to nobody.
    case 'crewDocuments': return typeof r.crewId === 'string';
    // A draft is filled from its template, found by its id or its code.
    case 'formDrafts':
      return typeof r.templateId === 'string' && typeof r.code === 'string' && isObject(r.values) && Array.isArray(r.photoIds)
        && (r.autoIds === undefined || (Array.isArray(r.autoIds) && r.autoIds.every((id) => typeof id === 'string')));
    case 'formLastValues': return typeof r.code === 'string' && isObject(r.values);
    // A photo is found by its draft.
    case 'formPhotos': return typeof r.draftId === 'string' && isBase64Text(r.jpegBase64);
    default: return true;
  }
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
        && isTimestamp(r.createdAt) && isTimestamp(r.updatedAt) && hasOwnFields(name, r);
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
 * all three as they were. Only a full backup moves `lastSync`: a handover holds one ship, so it says nothing about the
 * other ships' records, and a `lastSync` moved by it would make the other device's later changes to those ships look old
 * and be dropped without a conflict. The active ship is repaired either way. Throws, before touching anything, if a
 * conflict has no decision.
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
      const lastSync = p.header.kind === 'full'
        ? { ...settings.lastSync, [from]: laterOf(settings.lastSync[from], p.header.exportedAt) }
        : settings.lastSync;
      await updateSettings(db, { lastSync, activeShipId: liveActiveShipId(settings.activeShipId, await listShips(db)) });
    }),
  );
}

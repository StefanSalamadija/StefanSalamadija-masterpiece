import { rejoinDraft } from '../domain/crew';
import { carryOverDocuments } from '../domain/crewDocs';
import { TABLE_NAMES } from '../domain/types';
import type { BaseRecord, CrewDocument, CrewMember, SyncRecord, TableName, Tables } from '../domain/types';
import type { MasterpieceDB } from './schema';
import { syncTable, syncTables } from './schema';
import { getSettings } from './settings';
import { guardWrite } from './storage';

/** Writes a new record: fresh id, created and updated now by this device, on the ship's side of the ship/personal split. */
export async function createRecord<T extends SyncRecord>(
  db: MasterpieceDB, table: TableName, fields: Omit<T, keyof BaseRecord>,
): Promise<T> {
  const { deviceId } = await getSettings(db);
  const now = new Date().toISOString();
  const record = {
    ...fields, id: crypto.randomUUID(), createdAt: now, updatedAt: now, updatedBy: deviceId, deleted: false, scope: 'ship',
  } as unknown as T;
  await guardWrite(() => syncTable(db, table).put(record));
  return record;
}

/** Fields a patch never changes: identity, creation time, ship/personal side, owning ship, and deletion (see `softDelete`). */
const FIXED_FIELDS: ReadonlySet<string> = new Set(['id', 'createdAt', 'scope', 'shipId', 'deleted']);

/**
 * Reads a record and writes the version `next` builds from it, stamped as changed now by this device, in one
 * transaction. `next` returning undefined leaves the record as it is.
 */
async function rewrite(
  db: MasterpieceDB, table: TableName, id: string,
  next: (current: SyncRecord, stamp: Pick<BaseRecord, 'updatedAt' | 'updatedBy'>) => SyncRecord | undefined,
): Promise<SyncRecord> {
  const { deviceId } = await getSettings(db);
  const t = syncTable(db, table);
  return guardWrite(() =>
    db.transaction('rw', t, async () => {
      const current = await t.get(id);
      if (!current) throw new Error(`There is no ${table} record with id ${id}.`);
      const updated = next(current, { updatedAt: new Date().toISOString(), updatedBy: deviceId });
      if (updated) await t.put(updated);
      return updated ?? current;
    }),
  );
}

/** A copy of the record without the keys whose value is `undefined`: a patch removes an optional field by setting it so. */
function withoutUndefined(record: SyncRecord): SyncRecord {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as unknown as SyncRecord;
}

/**
 * Applies `patch` to a live record and stamps it as updated now by this device. Keys in `FIXED_FIELDS` are ignored,
 * so a stale copy cannot move a record to another ship, change its side or undo a deletion. A field the patch sets to
 * `undefined` is removed from the record (it is never stored as `undefined`). A deleted record is refused.
 */
export async function updateRecord<T extends SyncRecord>(
  db: MasterpieceDB, table: TableName, id: string, patch: Partial<T>,
): Promise<T> {
  const changes = Object.fromEntries(Object.entries(patch).filter(([key]) => !FIXED_FIELDS.has(key)));
  const updated = await rewrite(db, table, id, (current, stamp) => {
    if (current.deleted) throw new Error(`Record is deleted: ${table}:${id}`);
    return withoutUndefined({ ...current, ...changes, ...stamp });
  });
  return updated as T;
}

/**
 * Marks a record deleted. It stays in the table as a tombstone, so the deletion reaches other devices. Deleting a
 * tombstone again changes nothing, so it keeps its original deletion time.
 */
export async function softDelete(db: MasterpieceDB, table: TableName, id: string): Promise<void> {
  await rewrite(db, table, id, (current, stamp) => (current.deleted ? undefined : { ...current, deleted: true, ...stamp }));
}

/** The ship's records in `table` that are not deleted. */
export async function listForShip<T extends SyncRecord = SyncRecord>(
  db: MasterpieceDB, table: Exclude<TableName, 'ships'>, shipId: string,
): Promise<T[]> {
  const rows = await syncTable(db, table).where('shipId').equals(shipId).filter((r) => !r.deleted).toArray();
  return rows as T[];
}

/** Every syncable table as one consistent snapshot. Deleted records are included; each table is in primary-key order. */
export function allTables(db: MasterpieceDB): Promise<Tables> {
  return db.transaction('r', syncTables(db), async () => {
    const tables = {} as Tables;
    for (const name of TABLE_NAMES) tables[name] = await syncTable(db, name).toArray();
    return tables;
  });
}

/**
 * Replaces the contents of every syncable table, all or nothing. A table missing from `t` is left empty. Settings and
 * snapshots are not touched.
 */
export function replaceAllTables(db: MasterpieceDB, t: Tables): Promise<void> {
  return guardWrite(() =>
    db.transaction('rw', syncTables(db), async () => {
      for (const name of TABLE_NAMES) {
        const table = syncTable(db, name);
        await table.clear();
        await table.bulkPut(t[name] ?? []);
      }
    }),
  );
}

/** Writes the records in one transaction: if one cannot be stored, none is. */
export async function putRecords(db: MasterpieceDB, items: { table: TableName; record: SyncRecord }[]): Promise<void> {
  if (items.length === 0) return;
  const tables = [...new Set(items.map((item) => item.table))].map((name) => syncTable(db, name));
  await guardWrite(() =>
    db.transaction('rw', tables, async () => {
      for (const { table, record } of items) await syncTable(db, table).put(record);
    }),
  );
}

/**
 * A new contract for a returning crew member (see `rejoinDraft`), with a copy of each of their documents that is still
 * valid on the sign-on day (see `carryOverDocuments`). The contract and the copies are one transaction: if one cannot
 * be written, none is. The signed-off contract and its documents are not touched.
 */
export async function rejoinCrewMember(
  db: MasterpieceDB, member: CrewMember, signOnDate: string, signOnPort: string,
): Promise<CrewMember> {
  return guardWrite(() =>
    // `settings` is in the scope because `createRecord` reads the device id from it.
    db.transaction('rw', [db.crew, db.crewDocuments, db.settings], async () => {
      const created = await createRecord<CrewMember>(db, 'crew', { shipId: member.shipId, ...rejoinDraft(member, signOnDate, signOnPort) });
      const documents = await db.crewDocuments.where('crewId').equals(member.id).toArray();
      for (const carried of carryOverDocuments(documents, member.id, signOnDate)) {
        await createRecord<CrewDocument>(db, 'crewDocuments', { ...carried, crewId: created.id });
      }
      return created;
    }),
  );
}

/**
 * Soft-deletes a crew member's contract and every live document of it, in one transaction. A contract or a document
 * that was already deleted keeps its own deletion time. Refuses a contract that does not exist.
 */
export async function deleteCrewMember(db: MasterpieceDB, id: string): Promise<void> {
  const { deviceId } = await getSettings(db);
  await guardWrite(() =>
    db.transaction('rw', [db.crew, db.crewDocuments], async () => {
      const member = await db.crew.get(id);
      if (!member) throw new Error(`There is no crew record with id ${id}.`);
      const stamp = { deleted: true, updatedAt: new Date().toISOString(), updatedBy: deviceId };
      if (!member.deleted) await db.crew.put({ ...member, ...stamp });
      const live = await db.crewDocuments.where('crewId').equals(id).filter((d) => !d.deleted).toArray();
      await db.crewDocuments.bulkPut(live.map((d) => ({ ...d, ...stamp })));
    }),
  );
}

import { TABLE_NAMES } from '../domain/types';
import type { BaseRecord, SyncRecord, TableName, Tables } from '../domain/types';
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

/**
 * Applies `patch` to a live record and stamps it as updated now by this device. Keys in `FIXED_FIELDS` are ignored,
 * so a stale copy cannot move a record to another ship, change its side or undo a deletion. A deleted record is refused.
 */
export async function updateRecord<T extends SyncRecord>(
  db: MasterpieceDB, table: TableName, id: string, patch: Partial<T>,
): Promise<T> {
  const changes = Object.fromEntries(Object.entries(patch).filter(([key]) => !FIXED_FIELDS.has(key)));
  const updated = await rewrite(db, table, id, (current, stamp) => {
    if (current.deleted) throw new Error(`Record is deleted: ${table}:${id}`);
    return { ...current, ...changes, ...stamp };
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

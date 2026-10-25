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

/** Applies `patch` to a stored record and stamps it as updated now by this device. The id and creation time cannot change. */
export async function updateRecord<T extends SyncRecord>(
  db: MasterpieceDB, table: TableName, id: string, patch: Partial<T>,
): Promise<T> {
  const { deviceId } = await getSettings(db);
  const t = syncTable(db, table);
  return guardWrite(() =>
    db.transaction('rw', t, async () => {
      const current = await t.get(id);
      if (!current) throw new Error(`There is no ${table} record with id ${id}.`);
      const updated = {
        ...current, ...patch, id: current.id, createdAt: current.createdAt, updatedAt: new Date().toISOString(), updatedBy: deviceId,
      } as T;
      await t.put(updated);
      return updated;
    }),
  );
}

/** Marks a record deleted. It stays in the table as a tombstone, so the deletion reaches other devices. */
export async function softDelete(db: MasterpieceDB, table: TableName, id: string): Promise<void> {
  await updateRecord(db, table, id, { deleted: true });
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

/** Replaces the contents of every syncable table, all or nothing. Settings and snapshots are not touched. */
export function replaceAllTables(db: MasterpieceDB, t: Tables): Promise<void> {
  return guardWrite(() =>
    db.transaction('rw', syncTables(db), async () => {
      for (const name of TABLE_NAMES) {
        const table = syncTable(db, name);
        await table.clear();
        await table.bulkPut(t[name]);
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

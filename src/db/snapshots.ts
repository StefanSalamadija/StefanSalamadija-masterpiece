import type { Table, Transaction } from 'dexie';
import { TABLE_NAMES } from '../domain/types';
import type { Snapshot, SnapshotReason, TableName, Tables } from '../domain/types';
import { allTables, replaceAllTables } from './records';
import { syncTables, type MasterpieceDB } from './schema';
import { getSettings, updateSettings } from './settings';
import { listShips, liveActiveShipId } from './ships';
import { guardWrite } from './storage';

/** How many snapshots are kept: the one just written plus the newest others by `createdAt`, ties going to the larger id. */
export const SNAPSHOTS_KEPT = 5;

/** A snapshot without its data, plus how many records (deleted ones included) it holds per table. */
export type SnapshotSummary = Omit<Snapshot, 'data'> & { counts: Record<TableName, number> };

function makeSnapshot(reason: SnapshotReason, note: string | undefined, data: Tables): Snapshot {
  return { id: crypto.randomUUID(), createdAt: new Date().toISOString(), reason, ...(note === undefined ? {} : { note }), data };
}

/**
 * Makes room for one more snapshot, so that with it there are at most `SNAPSHOTS_KEPT`: deletes the oldest of those stored. Call
 * it before writing the new one. The new snapshot is then never among the deleted, even when the device clock is behind
 * the stored ones, and storage never holds more than `SNAPSHOTS_KEPT` copies, the new one included. The `createdAt` index lists
 * the oldest first and breaks ties by primary key, so the same snapshots go every time. Reads keys only, never the data.
 */
async function makeRoomForSnapshot(snapshots: Table<Snapshot, string>): Promise<void> {
  const oldestFirst = await snapshots.orderBy('createdAt').primaryKeys();
  const excess = oldestFirst.length - (SNAPSHOTS_KEPT - 1);
  if (excess > 0) await snapshots.bulkDelete(oldestFirst.slice(0, excess));
}

/**
 * Copies every syncable table, tombstones included. Of the snapshots already stored the newest 4 are kept, so the one
 * returned is always stored; taking and pruning are one transaction.
 */
export function takeSnapshot(db: MasterpieceDB, reason: SnapshotReason, note?: string): Promise<Snapshot> {
  return guardWrite(() =>
    db.transaction('rw', [...syncTables(db), db.snapshots], async () => {
      const snapshot = makeSnapshot(reason, note, await allTables(db));
      await makeRoomForSnapshot(db.snapshots);
      await db.snapshots.put(snapshot);
      return snapshot;
    }),
  );
}

function countRecords(data: Tables): Record<TableName, number> {
  // `?.` because a snapshot taken before a table existed has no entry for it.
  return Object.fromEntries(TABLE_NAMES.map((name) => [name, data[name]?.length ?? 0])) as Record<TableName, number>;
}

/** The snapshots, newest first, without their data. A cursor reads them, so only one is in memory at a time. */
export async function listSnapshots(db: MasterpieceDB): Promise<SnapshotSummary[]> {
  const summaries: SnapshotSummary[] = [];
  await db.snapshots.orderBy('createdAt').reverse().each(({ data, ...meta }) => {
    summaries.push({ ...meta, counts: countRecords(data) });
  });
  return summaries;
}

/** Points the active ship at a live ship: the one it already names, else the first live ship, else none. */
async function keepActiveShipLive(db: MasterpieceDB): Promise<void> {
  const { activeShipId } = await getSettings(db);
  const next = liveActiveShipId(activeShipId, await listShips(db));
  if (next !== activeShipId) await updateSettings(db, { activeShipId: next });
}

/**
 * Puts the snapshot's data back, replacing every syncable table; settings are not touched, except that the active ship
 * is moved off a ship the restored data does not have (or has deleted). The data as it was just before is first saved
 * as a `'manual'` snapshot, "Before restore", so a restore can be undone. All of it is one transaction. The target is
 * read before that snapshot is taken, so restoring the oldest of 5 works even though taking it prunes the target.
 */
export function restoreSnapshot(db: MasterpieceDB, id: string): Promise<void> {
  return guardWrite(() =>
    db.transaction('rw', [...syncTables(db), db.snapshots, db.settings], async () => {
      const target = await db.snapshots.get(id);
      if (!target) throw new Error(`Snapshot not found: ${id}`);
      await takeSnapshot(db, 'manual', 'Before restore');
      await replaceAllTables(db, target.data);
      await keepActiveShipLive(db);
    }),
  );
}

/**
 * For a Dexie `version(n).upgrade()`: saves the data as it is before the upgrade changes anything. It uses only `tx`,
 * because nothing else may touch the database during an upgrade. A table whose store does not exist yet (a later
 * version adds it) is saved as empty.
 */
export async function snapshotInUpgrade(tx: Transaction, reason: SnapshotReason = 'before-update'): Promise<void> {
  const data = {} as Tables;
  for (const name of TABLE_NAMES) {
    data[name] = tx.idbtrans.objectStoreNames.contains(name) ? await tx.table(name).toArray() : [];
  }
  const snapshots = tx.table<Snapshot, string>('snapshots');
  await makeRoomForSnapshot(snapshots);
  await snapshots.put(makeSnapshot(reason, undefined, data));
}

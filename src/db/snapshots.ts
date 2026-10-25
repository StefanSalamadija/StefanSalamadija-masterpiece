import type { Table, Transaction } from 'dexie';
import { TABLE_NAMES } from '../domain/types';
import type { Snapshot, SnapshotReason, TableName, Tables } from '../domain/types';
import { allTables, replaceAllTables } from './records';
import type { MasterpieceDB } from './schema';
import { syncTables } from './schema';
import { getSettings, updateSettings } from './settings';
import { listShips } from './ships';
import { guardWrite } from './storage';

/** How many snapshots are kept: the newest by `createdAt`, ties going to the larger id. */
const KEEP = 5;

/** A snapshot without its data, plus how many records (deleted ones included) it holds per table. */
export type SnapshotSummary = Omit<Snapshot, 'data'> & { counts: Record<TableName, number> };

function makeSnapshot(reason: SnapshotReason, note: string | undefined, data: Tables): Snapshot {
  return { id: crypto.randomUUID(), createdAt: new Date().toISOString(), reason, ...(note === undefined ? {} : { note }), data };
}

/**
 * Deletes every snapshot but the newest `KEEP`. The `createdAt` index lists the oldest first and breaks ties by
 * primary key, so the same snapshots go every time. Reads keys only, never the data.
 */
async function pruneSnapshots(snapshots: Table<Snapshot, string>): Promise<void> {
  const oldestFirst = await snapshots.orderBy('createdAt').primaryKeys();
  const excess = oldestFirst.length - KEEP;
  if (excess > 0) await snapshots.bulkDelete(oldestFirst.slice(0, excess));
}

/** Copies every syncable table, tombstones included, and keeps the newest 5 snapshots; taking and pruning are one transaction. */
export function takeSnapshot(db: MasterpieceDB, reason: SnapshotReason, note?: string): Promise<Snapshot> {
  return guardWrite(() =>
    db.transaction('rw', [...syncTables(db), db.snapshots], async () => {
      const snapshot = makeSnapshot(reason, note, await allTables(db));
      await db.snapshots.put(snapshot);
      await pruneSnapshots(db.snapshots);
      return snapshot;
    }),
  );
}

function countRecords(data: Tables): Record<TableName, number> {
  // `?.` because a snapshot taken before a table existed has no entry for it.
  return Object.fromEntries(TABLE_NAMES.map((name) => [name, data[name]?.length ?? 0])) as Record<TableName, number>;
}

/** The snapshots, newest first, without their data. */
export async function listSnapshots(db: MasterpieceDB): Promise<SnapshotSummary[]> {
  const snapshots = await db.snapshots.orderBy('createdAt').reverse().toArray();
  return snapshots.map(({ data, ...meta }) => ({ ...meta, counts: countRecords(data) }));
}

/** Points the active ship at a live ship: the one it already names, else the first live ship, else none. */
async function keepActiveShipLive(db: MasterpieceDB): Promise<void> {
  const { activeShipId } = await getSettings(db);
  const ships = await listShips(db);
  if (ships.some((ship) => ship.id === activeShipId)) return;
  const first = ships[0]?.id;
  if (first !== activeShipId) await updateSettings(db, { activeShipId: first });
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
  await snapshots.put(makeSnapshot(reason, undefined, data));
  await pruneSnapshots(snapshots);
}

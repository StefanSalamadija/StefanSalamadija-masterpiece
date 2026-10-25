import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrewDraft, Snapshot, Tables } from '../domain/types';
import { TABLE_NAMES } from '../domain/types';
import { allTables, createRecord, softDelete } from './records';
import { MasterpieceDB, openDb } from './schema';
import { getSettings, updateSettings } from './settings';
import { createShip } from './ships';
import { listSnapshots, restoreSnapshot, snapshotInUpgrade, takeSnapshot } from './snapshots';
import { StorageFullError } from './storage';

const draft: CrewDraft = {
  surname: 'Petrović', givenNames: 'Ivan', rank: 'master', nationality: 'Croatian', dateOfBirth: '1980-03-14',
  placeOfBirth: 'Split', passportNo: 'P1234567', passportExpiry: '2030-01-01', seamansBookNo: 'SB-998',
  seamansBookExpiry: '2030-01-01', signOnDate: '2026-06-01', signOnPort: 'Rijeka',
};

function freshDb() {
  return openDb('t-' + crypto.randomUUID());
}

/** Moves the clock to `hour` o'clock on 2026-10-25, so every snapshot in a test gets its own `createdAt`. */
function at(hour: number) {
  vi.setSystemTime(new Date(Date.UTC(2026, 9, 25, hour)));
}

const emptyTables = (): Tables => ({ ships: [], crew: [], voyages: [], certificates: [], clockChanges: [] });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); // fake-indexeddb needs the real timers
  at(0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('takeSnapshot', () => {
  it('stores a full copy of every table, tombstones included, stamped now', async () => {
    const db = freshDb();
    const ship = await createShip(db, 'MV OCEAN STAR', 0);
    const gone = await createRecord(db, 'crew', { shipId: ship.id, ...draft });
    await createRecord(db, 'crew', { shipId: ship.id, ...draft, surname: 'Šašić' });
    await softDelete(db, 'crew', gone.id);
    at(7);
    const snap = await takeSnapshot(db, 'before-import', 'Crew list.xlsx');
    expect(snap).toMatchObject({ reason: 'before-import', note: 'Crew list.xlsx', createdAt: '2026-10-25T07:00:00.000Z' });
    expect(snap.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(snap.data).toEqual(await allTables(db));
    expect(snap.data.crew).toHaveLength(2);
    expect(snap.data.crew.filter((c) => c.deleted)).toHaveLength(1);
    expect(await db.snapshots.get(snap.id)).toEqual(snap);
  });

  it('leaves the note out when there is none', async () => {
    const snap = await takeSnapshot(freshDb(), 'manual');
    expect('note' in snap).toBe(false);
  });

  it('keeps the newest 5', async () => {
    const db = freshDb();
    for (let i = 0; i < 6; i++) { at(i); await takeSnapshot(db, 'manual', `n${i}`); }
    expect((await listSnapshots(db)).map((s) => s.note)).toEqual(['n5', 'n4', 'n3', 'n2', 'n1']);
    expect(await db.snapshots.count()).toBe(5);
  });

  it('prunes by createdAt, not by the order the snapshots were taken in', async () => {
    const db = freshDb();
    for (const hour of [3, 1, 5, 2, 4, 6]) { at(hour); await takeSnapshot(db, 'manual', `h${hour}`); }
    expect((await listSnapshots(db)).map((s) => s.note)).toEqual(['h6', 'h5', 'h4', 'h3', 'h2']);
  });

  it('breaks createdAt ties by id, so the same snapshots survive every time', async () => {
    const db = freshDb();
    const earlier: string[] = [];
    for (let i = 0; i < 5; i++) earlier.push((await takeSnapshot(db, 'manual')).id); // the clock never moves
    const lowest = '00000000-0000-4000-8000-000000000000';
    vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(lowest);
    const newest = await takeSnapshot(db, 'manual');
    expect(newest.id).toBe(lowest);
    // the new one is kept even though it ties and loses on id; of the others the lowest id goes
    expect((await listSnapshots(db)).map((s) => s.id)).toEqual([...earlier.sort().reverse().slice(0, 4), lowest]);
  });

  it('keeps the snapshot it just took when the clock is behind the stored ones', async () => {
    const db = freshDb();
    for (const hour of [5, 6, 7, 8, 9]) { at(hour); await takeSnapshot(db, 'manual', `h${hour}`); }
    at(1);
    const snap = await takeSnapshot(db, 'manual', 'h1');
    expect(await db.snapshots.get(snap.id)).toEqual(snap);
    expect((await listSnapshots(db)).map((s) => s.note)).toEqual(['h9', 'h8', 'h7', 'h6', 'h1']);
  });

  it('deletes the oldest copies before writing the new one, so storage never holds 6', async () => {
    const db = freshDb();
    for (let i = 0; i < 5; i++) { at(i); await takeSnapshot(db, 'manual', `n${i}`); }
    const put = vi.spyOn(db.snapshots, 'put');
    const bulkDelete = vi.spyOn(db.snapshots, 'bulkDelete');
    at(5);
    await takeSnapshot(db, 'manual', 'n5');
    expect(bulkDelete).toHaveBeenCalledTimes(1);
    expect(bulkDelete.mock.invocationCallOrder[0]).toBeLessThan(put.mock.invocationCallOrder[0]);
  });

  it('stores nothing when pruning fails', async () => {
    const db = freshDb();
    for (let i = 0; i < 5; i++) { at(i); await takeSnapshot(db, 'manual', `n${i}`); }
    const before = await listSnapshots(db);
    vi.spyOn(db.snapshots, 'bulkDelete').mockRejectedValueOnce(new Error('boom'));
    at(5);
    await expect(takeSnapshot(db, 'manual', 'n5')).rejects.toThrow('boom');
    expect(await listSnapshots(db)).toEqual(before);
  });

  it('reports a full disk as StorageFullError and stores nothing', async () => {
    const db = freshDb();
    vi.spyOn(db.snapshots, 'put').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
    await expect(takeSnapshot(db, 'manual')).rejects.toBeInstanceOf(StorageFullError);
    expect(await listSnapshots(db)).toEqual([]);
  });
});

describe('listSnapshots', () => {
  it('is empty when there are no snapshots', async () => {
    expect(await listSnapshots(freshDb())).toEqual([]);
  });

  it('lists metadata only, newest first, with a count per table that includes tombstones', async () => {
    const db = freshDb();
    const ship = await createShip(db, 'MV OCEAN STAR', 0); // one ship, one clock change
    const gone = await createRecord(db, 'crew', { shipId: ship.id, ...draft });
    await createRecord(db, 'crew', { shipId: ship.id, ...draft, surname: 'Šašić' });
    await softDelete(db, 'crew', gone.id);
    at(1);
    const first = await takeSnapshot(db, 'manual', 'first');
    at(2);
    const second = await takeSnapshot(db, 'before-update');
    const list = await listSnapshots(db);
    expect(list).toEqual([
      { id: second.id, createdAt: second.createdAt, reason: 'before-update', counts: { ships: 1, crew: 2, voyages: 0, certificates: 0, clockChanges: 1 } },
      { id: first.id, createdAt: first.createdAt, reason: 'manual', note: 'first', counts: { ships: 1, crew: 2, voyages: 0, certificates: 0, clockChanges: 1 } },
    ]);
    for (const item of list) expect(item).not.toHaveProperty('data');
  });

  it('reads the snapshots with a cursor, one at a time, not all at once', async () => {
    const db = freshDb();
    for (let i = 0; i < 3; i++) { at(i); await takeSnapshot(db, 'manual', `n${i}`); }
    const getAll = [vi.spyOn(IDBObjectStore.prototype, 'getAll'), vi.spyOn(IDBIndex.prototype, 'getAll')];
    expect(await listSnapshots(db)).toHaveLength(3);
    for (const spy of getAll) expect(spy).not.toHaveBeenCalled();
  });

  it('counts a table an older snapshot did not have as empty', async () => {
    const db = freshDb();
    const { voyages: _voyages, ...withoutVoyages } = emptyTables();
    await db.snapshots.put({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z', reason: 'manual', data: withoutVoyages as Tables });
    expect((await listSnapshots(db))[0].counts).toEqual({ ships: 0, crew: 0, voyages: 0, certificates: 0, clockChanges: 0 });
  });
});

describe('restoreSnapshot', () => {
  async function shipWithCrew() {
    const db = freshDb();
    const ship = await createShip(db, 'MV OCEAN STAR', 0);
    const keep = await createRecord(db, 'crew', { shipId: ship.id, ...draft });
    const undone = await createRecord(db, 'crew', { shipId: ship.id, ...draft, surname: 'Šašić' });
    return { db, ship, keep, undone };
  }

  it('brings back a record deleted since, keeps a deleted one deleted, and drops one added after', async () => {
    const { db, ship, keep, undone } = await shipWithCrew();
    await softDelete(db, 'crew', undone.id);
    at(1);
    const snap = await takeSnapshot(db, 'manual');
    await softDelete(db, 'crew', keep.id);
    await db.crew.update(undone.id, { deleted: false });
    await createRecord(db, 'crew', { shipId: ship.id, ...draft, surname: "O'Brien" });
    at(2);
    await restoreSnapshot(db, snap.id);
    const { crew } = await allTables(db);
    expect(crew).toEqual(snap.data.crew);
    expect(crew).toHaveLength(2);
    expect(crew.find((c) => c.id === keep.id)?.deleted).toBe(false);
    expect(crew.find((c) => c.id === undone.id)?.deleted).toBe(true);
  });

  it('takes a "Before restore" snapshot first, which can undo the restore', async () => {
    const { db, ship } = await shipWithCrew();
    at(1);
    const snap = await takeSnapshot(db, 'manual');
    await createRecord(db, 'crew', { shipId: ship.id, ...draft, surname: "O'Brien" });
    const beforeRestore = await allTables(db);
    at(2);
    await restoreSnapshot(db, snap.id);
    const [newest] = await listSnapshots(db);
    expect(newest).toMatchObject({ reason: 'manual', note: 'Before restore', createdAt: '2026-10-25T02:00:00.000Z' });
    expect((await db.snapshots.get(newest.id))?.data).toEqual(beforeRestore);
    at(3);
    await restoreSnapshot(db, newest.id);
    expect(await allTables(db)).toEqual(beforeRestore);
  });

  it('restores the oldest of 5 even though taking the safety snapshot prunes it', async () => {
    const { db, ship } = await shipWithCrew();
    for (let i = 0; i < 5; i++) {
      at(i + 1);
      await createRecord(db, 'crew', { shipId: ship.id, ...draft, surname: `Crew${i}` });
      await takeSnapshot(db, 'manual', `n${i}`);
    }
    const oldest = (await listSnapshots(db)).at(-1)!;
    expect(oldest.note).toBe('n0');
    const target = (await db.snapshots.get(oldest.id))!;
    at(6);
    await expect(restoreSnapshot(db, oldest.id)).resolves.toBeUndefined();
    expect(await allTables(db)).toEqual(target.data);
    const after = await listSnapshots(db);
    expect(after).toHaveLength(5);
    expect(after.map((s) => s.note)).toEqual(['Before restore', 'n4', 'n3', 'n2', 'n1']);
  });

  it('keeps its "Before restore" snapshot when the clock is behind the stored ones', async () => {
    const { db, ship } = await shipWithCrew();
    for (const hour of [5, 6, 7, 8, 9]) {
      at(hour);
      await createRecord(db, 'crew', { shipId: ship.id, ...draft, surname: `Crew${hour}` });
      await takeSnapshot(db, 'manual', `h${hour}`);
    }
    const beforeRestore = await allTables(db);
    const target = (await listSnapshots(db)).find((s) => s.note === 'h6')!;
    at(1);
    await restoreSnapshot(db, target.id);
    const list = await listSnapshots(db);
    expect(list.map((s) => s.note)).toEqual(['h9', 'h8', 'h7', 'h6', 'Before restore']);
    expect((await db.snapshots.get(list.at(-1)!.id))?.data).toEqual(beforeRestore);
  });

  it('rejects an unknown id and changes nothing', async () => {
    const { db } = await shipWithCrew();
    const before = await allTables(db);
    await expect(restoreSnapshot(db, 'no-such-id')).rejects.toThrow('Snapshot not found: no-such-id');
    expect(await allTables(db)).toEqual(before);
    expect(await listSnapshots(db)).toEqual([]);
  });

  it('leaves the settings alone', async () => {
    const { db } = await shipWithCrew();
    const snap = await takeSnapshot(db, 'manual');
    await updateSettings(db, { theme: 'night', backupReminderDays: 3, lastExportAt: '2026-10-20T10:00:00.000Z' });
    const before = await getSettings(db);
    at(1);
    await restoreSnapshot(db, snap.id);
    expect(await getSettings(db)).toEqual(before);
  });

  it('does all or nothing: a failed restore leaves the data and the snapshot list as they were', async () => {
    const { db, ship } = await shipWithCrew();
    const snap = await takeSnapshot(db, 'manual');
    await createRecord(db, 'crew', { shipId: ship.id, ...draft, surname: "O'Brien" });
    const before = await allTables(db);
    const snapshotsBefore = await listSnapshots(db);
    vi.spyOn(db.crew, 'bulkPut').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
    at(1);
    await expect(restoreSnapshot(db, snap.id)).rejects.toBeInstanceOf(StorageFullError);
    expect(await allTables(db)).toEqual(before);
    expect(await listSnapshots(db)).toEqual(snapshotsBefore);
  });

  describe('the active ship', () => {
    it('moves off a ship that did not exist when the snapshot was taken', async () => {
      const db = freshDb();
      const first = await createShip(db, 'MV OCEAN STAR', 0);
      const snap = await takeSnapshot(db, 'manual');
      at(1);
      const second = await createShip(db, 'MV SEA BREEZE', 0);
      await updateSettings(db, { activeShipId: second.id });
      at(2);
      await restoreSnapshot(db, snap.id);
      expect((await getSettings(db)).activeShipId).toBe(first.id);
    });

    it('moves off a ship that is deleted in the snapshot, to the first live ship', async () => {
      const db = freshDb();
      const first = await createShip(db, 'MV OCEAN STAR', 0);
      at(1);
      const second = await createShip(db, 'MV SEA BREEZE', 0);
      await softDelete(db, 'ships', first.id);
      const snap = await takeSnapshot(db, 'manual');
      await updateSettings(db, { activeShipId: first.id });
      at(2);
      await restoreSnapshot(db, snap.id);
      expect((await getSettings(db)).activeShipId).toBe(second.id);
    });

    it('keeps an active ship that is live in the snapshot', async () => {
      const db = freshDb();
      await createShip(db, 'MV OCEAN STAR', 0);
      at(1);
      const second = await createShip(db, 'MV SEA BREEZE', 0);
      await updateSettings(db, { activeShipId: second.id });
      const snap = await takeSnapshot(db, 'manual');
      at(2);
      await restoreSnapshot(db, snap.id);
      expect((await getSettings(db)).activeShipId).toBe(second.id);
    });

    it('picks the first live ship when none is active', async () => {
      const db = freshDb();
      const first = await createShip(db, 'MV OCEAN STAR', 0);
      const snap = await takeSnapshot(db, 'manual');
      await updateSettings(db, { activeShipId: undefined });
      at(1);
      await restoreSnapshot(db, snap.id);
      expect((await getSettings(db)).activeShipId).toBe(first.id);
    });

    it('clears the active ship when the snapshot has no live ship', async () => {
      const db = freshDb();
      const snap = await takeSnapshot(db, 'manual'); // taken before any ship existed
      at(1);
      const ship = await createShip(db, 'MV OCEAN STAR', 0);
      expect((await getSettings(db)).activeShipId).toBe(ship.id);
      at(2);
      await restoreSnapshot(db, snap.id);
      expect((await getSettings(db)).activeShipId).toBeUndefined();
      expect((await allTables(db)).ships).toEqual([]);
    });
  });
});

describe('snapshotInUpgrade', () => {
  async function v1WithOneShip() {
    const name = 'mig-' + crypto.randomUUID();
    const v1 = openDb(name);
    const ship = await createShip(v1, 'MV OCEAN STAR', 0);
    const before = await allTables(v1);
    v1.close();
    return { name, ship, before };
  }

  /** The v1 database with a `version(2)` that changes the crew index and snapshots in its upgrade. */
  const upgradedDb = (name: string, run: (tx: Parameters<typeof snapshotInUpgrade>[0]) => Promise<void>) =>
    new (class extends MasterpieceDB {
      constructor() {
        super(name);
        this.version(2).stores({ crew: 'id, shipId, surname' }).upgrade(run);
      }
    })();

  it('keeps a full copy of the data as it was before the upgrade', async () => {
    const { name, ship, before } = await v1WithOneShip();
    const v2 = upgradedDb(name, (tx) => snapshotInUpgrade(tx));
    await v2.open();
    const snaps = await listSnapshots(v2);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].reason).toBe('before-update');
    expect(snaps[0].counts).toEqual({ ships: 1, crew: 0, voyages: 0, certificates: 0, clockChanges: 1 });
    const stored = (await v2.snapshots.get(snaps[0].id)) as Snapshot;
    expect(stored.data).toEqual(before);
    expect(stored.data.ships[0].id).toBe(ship.id);
    expect(stored.createdAt).toBe('2026-10-25T00:00:00.000Z');
    expect(stored.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.keys(stored.data)).toEqual([...TABLE_NAMES]);
    expect(v2.tables.find((t) => t.name === 'crew')?.schema.idxByName.surname).toBeDefined(); // the upgrade itself still ran
    v2.close();
  });

  it('uses the reason it is given', async () => {
    const { name } = await v1WithOneShip();
    const v2 = upgradedDb(name, (tx) => snapshotInUpgrade(tx, 'before-import'));
    expect((await listSnapshots(v2))[0].reason).toBe('before-import');
    v2.close();
  });

  it('keeps only the newest 5 snapshots', async () => {
    const name = 'mig-' + crypto.randomUUID();
    const v1 = openDb(name);
    for (let i = 0; i < 5; i++) { at(i); await takeSnapshot(v1, 'manual', `n${i}`); }
    v1.close();
    at(9);
    const v2 = upgradedDb(name, (tx) => snapshotInUpgrade(tx));
    const snaps = await listSnapshots(v2);
    expect(snaps.map((s) => s.reason)).toEqual(['before-update', 'manual', 'manual', 'manual', 'manual']);
    expect(snaps.map((s) => s.note)).toEqual([undefined, 'n4', 'n3', 'n2', 'n1']);
    v2.close();
  });

  it('keeps its own snapshot when the clock is behind the stored ones', async () => {
    const name = 'mig-' + crypto.randomUUID();
    const v1 = openDb(name);
    for (const hour of [5, 6, 7, 8, 9]) { at(hour); await takeSnapshot(v1, 'manual', `h${hour}`); }
    v1.close();
    at(1);
    const v2 = upgradedDb(name, (tx) => snapshotInUpgrade(tx));
    const snaps = await listSnapshots(v2);
    expect(snaps.map((s) => s.reason)).toEqual(['manual', 'manual', 'manual', 'manual', 'before-update']);
    expect(snaps.map((s) => s.note)).toEqual(['h9', 'h8', 'h7', 'h6', undefined]);
    v2.close();
  });

  it('skips a table whose store the old schema does not have yet', async () => {
    const name = 'mig-' + crypto.randomUUID();
    const old = new Dexie(name);
    old.version(1).stores({ ships: 'id', settings: 'key', snapshots: 'id, createdAt' });
    await old.table('ships').put({ id: 'ship-1', deleted: false });
    old.close();
    const next = new Dexie(name);
    next.version(1).stores({ ships: 'id', settings: 'key', snapshots: 'id, createdAt' });
    next.version(2).upgrade((tx) => snapshotInUpgrade(tx));
    next.version(3).stores({ crew: 'id, shipId', voyages: 'id, shipId', certificates: 'id, shipId', clockChanges: 'id, shipId' });
    await next.open();
    const [snap] = await next.table<Snapshot>('snapshots').toArray();
    expect(snap.data).toEqual({ ...emptyTables(), ships: [{ id: 'ship-1', deleted: false }] });
    expect(next.tables.map((t) => t.name).sort()).toEqual(['certificates', 'clockChanges', 'crew', 'settings', 'ships', 'snapshots', 'voyages']);
    next.close();
  });
});

describe('a snapshot you can roll back to', () => {
  it('survives a migration: restoring it after the upgrade brings the old data back', async () => {
    const name = 'mig-' + crypto.randomUUID();
    const v1 = openDb(name);
    const ship = await createShip(v1, 'MV OCEAN STAR', 0);
    const before = await allTables(v1);
    v1.close();
    class V2 extends MasterpieceDB {
      constructor() { super(name); this.version(2).stores({ crew: 'id, shipId, surname' }).upgrade((tx) => snapshotInUpgrade(tx)); }
    }
    const v2 = new V2();
    await v2.open();
    await createRecord(v2, 'crew', { shipId: ship.id, ...draft });
    at(1);
    await restoreSnapshot(v2, (await listSnapshots(v2))[0].id);
    expect(await allTables(v2)).toEqual(before);
    v2.close();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { TABLE_NAMES } from '../domain/types';
import type { ClockChange, CrewDraft, CrewMember, ShipProfile, SyncRecord, Tables, Voyage } from '../domain/types';
import { getDb, openDb } from './schema';
import { getSettings, guessDeviceName, updateSettings } from './settings';
import {
  allTables, createRecord, listForShip, putRecords, replaceAllTables, softDelete, updateRecord,
} from './records';
import { createShip } from './ships';
import { StorageFullError, requestPersistentStorage } from './storage';

const draft: CrewDraft = {
  surname: 'Petrović', givenNames: 'Ivan', rank: 'master', nationality: 'Croatian', dateOfBirth: '1980-03-14',
  placeOfBirth: 'Split', passportNo: 'P1234567', passportExpiry: '2030-01-01', seamansBookNo: 'SB-998',
  seamansBookExpiry: '2030-01-01', signOnDate: '2026-06-01', signOnPort: 'Rijeka',
};

function freshDb() {
  return openDb('t-' + crypto.randomUUID());
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('database', () => {
  it('declares schema version 1 with the syncable tables, settings and snapshots', () => {
    const db = freshDb();
    expect(db.verno).toBe(1);
    expect(db.tables.map((t) => t.name).sort()).toEqual(
      ['certificates', 'clockChanges', 'crew', 'settings', 'ships', 'snapshots', 'voyages'],
    );
    expect(db.crew.schema.primKey.name).toBe('id');
    expect(db.crew.schema.idxByName).toHaveProperty('shipId');
    expect(db.snapshots.schema.idxByName).toHaveProperty('createdAt');
  });

  it('has a table for every syncable table name, each one below a ship indexed by ship', () => {
    const db = freshDb();
    const tables = new Map(db.tables.map((t) => [t.name, t]));
    for (const name of TABLE_NAMES) {
      expect(tables.has(name), name).toBe(true);
      if (name !== 'ships') expect(tables.get(name)?.schema.idxByName, name).toHaveProperty('shipId');
    }
  });

  it('hands out one app database', () => {
    expect(getDb()).toBe(getDb());
    expect(getDb().name).toBe('masterpiece');
  });
});

describe('settings', () => {
  it('creates the defaults once and returns the same device id afterwards', async () => {
    const db = freshDb();
    const s1 = await getSettings(db);
    const s2 = await getSettings(db);
    expect(s2.deviceId).toBe(s1.deviceId);
    expect(s1.deviceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(s1).toMatchObject({ key: 'device', backupReminderDays: 7, theme: 'day', lastSync: {} });
    expect(s1.deviceName).toBe(guessDeviceName(navigator.userAgent));
    expect(s1.activeShipId).toBeUndefined();
  });

  it('creates a single set of defaults when two callers ask at the same time', async () => {
    const db = freshDb();
    const [a, b] = await Promise.all([getSettings(db), getSettings(db)]);
    expect(b.deviceId).toBe(a.deviceId);
    expect((await getSettings(db)).deviceId).toBe(a.deviceId);
  });

  it('names the device from its user agent', () => {
    expect(guessDeviceName('Mozilla/5.0 (Linux; Android 14; Pixel 7)')).toBe('Android device');
    expect(guessDeviceName('Mozilla/5.0 (Windows NT 10.0)')).toBe('Laptop');
  });

  it('merges a patch into the stored settings and keeps the device id', async () => {
    const db = freshDb();
    const before = await getSettings(db);
    const after = await updateSettings(db, { theme: 'night', backupReminderDays: 14, lastSync: { 'dev-2': '2026-10-25T08:00:00.000Z' } });
    expect(after).toMatchObject({ deviceId: before.deviceId, theme: 'night', backupReminderDays: 14, key: 'device' });
    expect(await getSettings(db)).toEqual(after);
  });

  it('never lets a patch replace the device identity', async () => {
    const db = freshDb();
    const before = await getSettings(db);
    const after = await updateSettings(db, { deviceId: 'someone-else', key: 'other' as 'device', theme: 'contrast' });
    expect(after).toMatchObject({ deviceId: before.deviceId, key: 'device', theme: 'contrast' });
    expect(await getSettings(db)).toEqual(after);
    expect(await db.settings.count()).toBe(1);
  });

  it('creates the defaults first when the patch is the first thing written', async () => {
    const db = freshDb();
    const updated = await updateSettings(db, { deviceName: 'Chief mate phone' });
    expect(updated).toMatchObject({ deviceName: 'Chief mate phone', backupReminderDays: 7, theme: 'day' });
    expect((await getSettings(db)).deviceId).toBe(updated.deviceId);
  });
});

describe('records', () => {
  it('creates, updates and soft-deletes a record with the right stamps', async () => {
    const db = freshDb();
    const s1 = await getSettings(db);
    const ship = await createShip(db, 'MV OCEAN STAR', 180, new Date('2026-10-25T08:00:00Z'));
    expect((await getSettings(db)).activeShipId).toBe(ship.id);
    expect((await listForShip<ClockChange>(db, 'clockChanges', ship.id))[0])
      .toMatchObject({ toOffsetMinutes: 180, effectiveAt: '2026-10-25T08:00:00.000Z' });

    const c = await createRecord<CrewMember>(db, 'crew', { shipId: ship.id, ...draft });
    expect(c).toMatchObject({ deleted: false, scope: 'ship', updatedBy: s1.deviceId, shipId: ship.id, surname: 'Petrović' });
    expect(c.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(c.createdAt).toBe(c.updatedAt);

    vi.useFakeTimers({ now: new Date('2026-10-26T00:00:00Z'), toFake: ['Date'] });
    const u = await updateRecord<CrewMember>(db, 'crew', c.id, { nationality: 'Croatian' });
    expect(u.updatedAt).toBe('2026-10-26T00:00:00.000Z');
    expect(u.createdAt).toBe(c.createdAt);
    vi.useRealTimers();

    await softDelete(db, 'crew', c.id);
    expect(await listForShip(db, 'crew', ship.id)).toEqual([]);
    expect((await allTables(db)).crew[0].deleted).toBe(true);
  });

  it('stores what it returns', async () => {
    const db = freshDb();
    const c = await createRecord<CrewMember>(db, 'crew', { shipId: 's1', ...draft });
    const u = await updateRecord<CrewMember>(db, 'crew', c.id, { rank: 'chiefOfficer', signOffDate: '2026-09-01' });
    expect(u).toMatchObject({ rank: 'chiefOfficer', signOffDate: '2026-09-01', surname: 'Petrović' });
    expect(await db.crew.get(c.id)).toEqual(u);
  });

  it('stamps the soft delete with the time and device, and keeps the record', async () => {
    const db = freshDb();
    const { deviceId } = await getSettings(db);
    const c = await createRecord<CrewMember>(db, 'crew', { shipId: 's1', ...draft });
    vi.useFakeTimers({ now: new Date('2026-11-01T12:00:00Z'), toFake: ['Date'] });
    await softDelete(db, 'crew', c.id);
    expect(await db.crew.get(c.id)).toMatchObject({
      deleted: true, updatedAt: '2026-11-01T12:00:00.000Z', updatedBy: deviceId, createdAt: c.createdAt, surname: 'Petrović',
    });
  });

  it('never lets a patch change the id or the creation time', async () => {
    const db = freshDb();
    const c = await createRecord<CrewMember>(db, 'crew', { shipId: 's1', ...draft });
    const u = await updateRecord<CrewMember>(db, 'crew', c.id, { id: 'other', createdAt: '1999-01-01T00:00:00.000Z' });
    expect(u.id).toBe(c.id);
    expect(u.createdAt).toBe(c.createdAt);
    expect(await db.crew.count()).toBe(1);
  });

  it('never lets a patch move a record to another ship, change its side or delete it', async () => {
    const db = freshDb();
    const c = await createRecord<CrewMember>(db, 'crew', { shipId: 'ship-a', ...draft });
    const u = await updateRecord<CrewMember>(db, 'crew', c.id, {
      shipId: 'ship-b', scope: 'personal', deleted: true, nationality: 'Serbian',
    });
    expect(u).toMatchObject({ shipId: 'ship-a', scope: 'ship', deleted: false, nationality: 'Serbian' });
    expect(await db.crew.get(c.id)).toEqual(u);
  });

  it('removes a field that the patch sets to undefined, instead of storing it as undefined', async () => {
    const db = freshDb();
    const c = await createRecord<CrewMember>(db, 'crew', { shipId: 'ship-a', ...draft, rank: 'other', rankOther: 'Pumpman' });
    const u = await updateRecord<CrewMember>(db, 'crew', c.id, { rank: 'ab', rankOther: undefined });
    expect(u).not.toHaveProperty('rankOther');
    const stored = (await db.crew.get(c.id))!;
    expect(stored).not.toHaveProperty('rankOther');
    expect(stored).toEqual(u);
    expect(stored).toMatchObject({ rank: 'ab', shipId: 'ship-a', surname: 'Petrović', deleted: false });
  });

  it('still keeps the fixed fields when the same patch tries to unset them', async () => {
    const db = freshDb();
    const c = await createRecord<CrewMember>(db, 'crew', { shipId: 'ship-a', ...draft });
    const u = await updateRecord<CrewMember>(db, 'crew', c.id, {
      id: undefined, createdAt: undefined, scope: undefined, shipId: undefined, deleted: undefined, nationality: 'Serbian',
    } as unknown as Partial<CrewMember>);
    expect(u).toMatchObject({ id: c.id, createdAt: c.createdAt, scope: 'ship', shipId: 'ship-a', deleted: false, nationality: 'Serbian' });
    expect(await db.crew.get(c.id)).toEqual(u);
  });

  it('never gives a ship a ship id', async () => {
    const db = freshDb();
    const ship = await createShip(db, 'MV OCEAN STAR', 180);
    await updateRecord<ShipProfile>(db, 'ships', ship.id, { shipId: 'other' } as unknown as Partial<ShipProfile>);
    expect(await db.ships.get(ship.id)).not.toHaveProperty('shipId');
  });

  it('refuses to update a deleted record, even from a stale copy that says it is live', async () => {
    const db = freshDb();
    const c = await createRecord<CrewMember>(db, 'crew', { shipId: 's1', ...draft });
    await softDelete(db, 'crew', c.id);
    const tombstone = await db.crew.get(c.id);
    await expect(updateRecord<CrewMember>(db, 'crew', c.id, { nationality: 'x' }))
      .rejects.toThrow(`Record is deleted: crew:${c.id}`);
    await expect(updateRecord<CrewMember>(db, 'crew', c.id, { ...c, deleted: false }))
      .rejects.toThrow(`Record is deleted: crew:${c.id}`);
    expect(await db.crew.get(c.id)).toEqual(tombstone);
  });

  it('leaves a tombstone as it is when it is deleted again', async () => {
    const db = freshDb();
    const c = await createRecord<CrewMember>(db, 'crew', { shipId: 's1', ...draft });
    vi.useFakeTimers({ now: new Date('2026-11-01T12:00:00Z'), toFake: ['Date'] });
    await softDelete(db, 'crew', c.id);
    const tombstone = await db.crew.get(c.id);
    vi.setSystemTime(new Date('2026-11-09T12:00:00Z'));
    await softDelete(db, 'crew', c.id);
    expect(await db.crew.get(c.id)).toEqual(tombstone);
    expect(tombstone?.updatedAt).toBe('2026-11-01T12:00:00.000Z');
  });

  it('rejects an update or delete of a record that does not exist', async () => {
    const db = freshDb();
    await expect(updateRecord(db, 'crew', 'missing', { nationality: 'x' })).rejects.toThrow(/missing/);
    await expect(softDelete(db, 'crew', 'missing')).rejects.toThrow(/missing/);
    expect(await db.crew.count()).toBe(0);
  });

  it('lists only the live records of the asked ship', async () => {
    const db = freshDb();
    const a = await createRecord<CrewMember>(db, 'crew', { shipId: 'ship-a', ...draft, surname: 'A' });
    await createRecord<CrewMember>(db, 'crew', { shipId: 'ship-b', ...draft, surname: 'B' });
    const gone = await createRecord<CrewMember>(db, 'crew', { shipId: 'ship-a', ...draft, surname: 'Gone' });
    await softDelete(db, 'crew', gone.id);
    expect((await listForShip<CrewMember>(db, 'crew', 'ship-a')).map((m) => m.id)).toEqual([a.id]);
    expect(await listForShip(db, 'voyages', 'ship-a')).toEqual([]);
  });
});

describe('allTables, putRecords and replaceAllTables', () => {
  async function seeded() {
    const db = freshDb();
    const ship = await createShip(db, 'MV OCEAN STAR', 180);
    const crew = [
      await createRecord<CrewMember>(db, 'crew', { shipId: ship.id, ...draft, surname: 'One' }),
      await createRecord<CrewMember>(db, 'crew', { shipId: ship.id, ...draft, surname: 'Two' }),
      await createRecord<CrewMember>(db, 'crew', { shipId: ship.id, ...draft, surname: 'Three' }),
    ];
    await softDelete(db, 'crew', crew[1].id);
    return { db, ship, crew };
  }

  it('returns every syncable table, deleted records included, in primary-key order', async () => {
    const { db, ship, crew } = await seeded();
    const t = await allTables(db);
    expect(Object.keys(t).sort()).toEqual(['certificates', 'clockChanges', 'crew', 'ships', 'voyages']);
    expect(t.ships.map((r) => r.id)).toEqual([ship.id]);
    expect(t.crew.map((r) => r.id)).toEqual(crew.map((m) => m.id).sort());
    expect(t.crew.filter((r) => r.deleted)).toHaveLength(1);
    expect(t.voyages).toEqual([]);
  });

  it('writes a batch of records into their tables in one transaction', async () => {
    const { db, ship } = await seeded();
    const voyage: Voyage = {
      id: 'v-1', createdAt: '2026-10-25T00:00:00.000Z', updatedAt: '2026-10-25T00:00:00.000Z', updatedBy: 'dev-2', deleted: false,
      scope: 'ship', shipId: ship.id, active: true, voyageNo: '12', lastPort: 'Rijeka', nextPort: 'Trieste',
      etaLocal: '2026-10-27T06:00', etaOffsetMinutes: 60, cargo: 'Steel', charterers: '', agents: '',
    };
    const incoming: CrewMember = { id: 'm-9', createdAt: '2026-10-25T00:00:00.000Z', updatedAt: '2026-10-25T00:00:00.000Z', updatedBy: 'dev-2', deleted: false, scope: 'ship', shipId: ship.id, ...draft };
    await putRecords(db, [{ table: 'voyages', record: voyage }, { table: 'crew', record: incoming }]);
    expect(await db.voyages.get('v-1')).toEqual(voyage);
    expect(await db.crew.get('m-9')).toEqual(incoming);
    // Same id again replaces rather than duplicates.
    await putRecords(db, [{ table: 'crew', record: { ...incoming, surname: 'Changed' } }]);
    expect(await db.crew.count()).toBe(4);
    expect((await db.crew.get('m-9'))?.surname).toBe('Changed');
  });

  it('writes nothing from a batch when one record cannot be stored', async () => {
    const { db, ship } = await seeded();
    const good: CrewMember = { id: 'm-9', createdAt: 'x', updatedAt: 'x', updatedBy: 'x', deleted: false, scope: 'ship', shipId: ship.id, ...draft };
    const bad = { ...good, id: undefined } as unknown as SyncRecord;
    await expect(putRecords(db, [{ table: 'crew', record: good }, { table: 'crew', record: bad }])).rejects.toThrow();
    expect(await db.crew.get('m-9')).toBeUndefined();
    expect(await db.crew.count()).toBe(3);
  });

  it('does nothing for an empty batch', async () => {
    const db = freshDb();
    await expect(putRecords(db, [])).resolves.toBeUndefined();
  });

  it('replaces every syncable table and leaves settings and snapshots alone', async () => {
    const { db, ship } = await seeded();
    const before = await getSettings(db);
    await db.snapshots.put({ id: 'snap-1', createdAt: '2026-10-25T00:00:00.000Z', reason: 'manual', data: await allTables(db) });
    const incoming: Tables = {
      ships: [], voyages: [], certificates: [], clockChanges: [],
      crew: [{ id: 'm-1', createdAt: 'x', updatedAt: 'x', updatedBy: 'x', deleted: true, scope: 'ship', shipId: 'gone', ...draft } as CrewMember],
    };
    await replaceAllTables(db, incoming);
    expect(await allTables(db)).toEqual(incoming);
    expect(await getSettings(db)).toEqual(before);
    expect(before.activeShipId).toBe(ship.id);
    expect(await db.snapshots.count()).toBe(1);
  });

  it('empties a table that the replacement leaves out', async () => {
    const { db, ship } = await seeded();
    const { crew: _left, ...withoutCrew } = await allTables(db);
    await replaceAllTables(db, withoutCrew as Tables);
    expect(await db.crew.count()).toBe(0);
    expect((await db.ships.toArray()).map((s) => s.id)).toEqual([ship.id]);
  });

  it('keeps the old data when the replacement cannot be written', async () => {
    const { db } = await seeded();
    const before = await allTables(db);
    const bad = { ...before.crew[0], id: undefined } as unknown as SyncRecord;
    // `crew` is cleared before it is written, and `ships` earlier still: all of it must roll back.
    await expect(replaceAllTables(db, { ...before, ships: [], crew: [bad] })).rejects.toThrow();
    expect(await allTables(db)).toEqual(before);
  });
});

describe('storage full', () => {
  const quota = () => new DOMException('full', 'QuotaExceededError');

  it('turns a full disk into StorageFullError with the user-facing message', async () => {
    const db = freshDb();
    const ship = await createShip(db, 'MV OCEAN STAR', 180);
    const c = await createRecord<CrewMember>(db, 'crew', { shipId: ship.id, ...draft });
    vi.spyOn(db.crew, 'put').mockRejectedValueOnce(quota());
    const failure = await updateRecord(db, 'crew', c.id, { nationality: 'x' }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(StorageFullError);
    expect((failure as Error).message).toBe('Storage on this device is full. The change was not saved. Export a backup and free up space.');
    expect((failure as Error).name).toBe('StorageFullError');
    expect(await db.crew.get(c.id)).toEqual(c);
  });

  it('covers create and soft delete as well', async () => {
    const db = freshDb();
    const c = await createRecord<CrewMember>(db, 'crew', { shipId: 's1', ...draft });
    vi.spyOn(db.crew, 'put').mockRejectedValueOnce(quota()).mockRejectedValueOnce(quota());
    await expect(createRecord(db, 'crew', { shipId: 's1', ...draft })).rejects.toBeInstanceOf(StorageFullError);
    await expect(softDelete(db, 'crew', c.id)).rejects.toBeInstanceOf(StorageFullError);
    expect(await db.crew.count()).toBe(1);
    expect((await db.crew.get(c.id))?.deleted).toBe(false);
  });

  it('recognises the error when Dexie wraps it', async () => {
    const db = freshDb();
    const c = await createRecord<CrewMember>(db, 'crew', { shipId: 's1', ...draft });
    // Dexie reports a quota failure as QuotaExceededError with the browser's error in `inner`; a failed bulk write lists them.
    const dexieStyle = Object.assign(new Error('wrapped'), { name: 'AbortError', inner: quota() });
    const bulkStyle = Object.assign(new Error('bulk'), { name: 'BulkError', failures: [new Error('other'), quota()] });
    const put = vi.spyOn(db.crew, 'put');
    put.mockRejectedValueOnce(dexieStyle).mockRejectedValueOnce(bulkStyle);
    await expect(updateRecord(db, 'crew', c.id, { nationality: 'x' })).rejects.toBeInstanceOf(StorageFullError);
    await expect(updateRecord(db, 'crew', c.id, { nationality: 'x' })).rejects.toBeInstanceOf(StorageFullError);
  });

  it('rethrows any other error unchanged', async () => {
    const db = freshDb();
    const c = await createRecord<CrewMember>(db, 'crew', { shipId: 's1', ...draft });
    const other = new Error('disk on fire');
    vi.spyOn(db.crew, 'put').mockRejectedValueOnce(other);
    await expect(updateRecord(db, 'crew', c.id, { nationality: 'x' })).rejects.toBe(other);
  });

  it('covers a full replace, a batch put and a settings write', async () => {
    const db = freshDb();
    const settings = await getSettings(db);
    const t = await allTables(db);
    vi.spyOn(db.crew, 'bulkPut').mockRejectedValueOnce(quota());
    await expect(replaceAllTables(db, t)).rejects.toBeInstanceOf(StorageFullError);
    vi.spyOn(db.voyages, 'put').mockRejectedValueOnce(quota());
    await expect(putRecords(db, [{ table: 'voyages', record: { id: 'v' } as unknown as SyncRecord }])).rejects.toBeInstanceOf(StorageFullError);
    vi.spyOn(db.settings, 'put').mockRejectedValueOnce(quota());
    await expect(updateSettings(db, { theme: 'night' })).rejects.toBeInstanceOf(StorageFullError);
    expect(await getSettings(db)).toEqual(settings);
  });
});

describe('requestPersistentStorage', () => {
  it('reports unsupported when the browser has no storage manager', async () => {
    vi.stubGlobal('navigator', {});
    expect(await requestPersistentStorage()).toBe('unsupported');
  });

  it.each([[true, 'granted'], [false, 'denied']] as const)('reports the browser answer %s as %s', async (answer, expected) => {
    const persist = vi.fn().mockResolvedValue(answer);
    vi.stubGlobal('navigator', { storage: { persist } });
    expect(await requestPersistentStorage()).toBe(expected);
    expect(persist).toHaveBeenCalledOnce();
  });
});

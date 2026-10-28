import Dexie from 'dexie';
import type { Table } from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isQuotaExceeded } from './storage';
import { TABLE_NAMES } from '../domain/types';
import type { CrewDocument, ShipProfile, Snapshot } from '../domain/types';
import { allTables, createRecord, listForShip } from './records';
import { MasterpieceDB, openDb } from './schema';
import { getSettings } from './settings';
import { listSnapshots, restoreSnapshot } from './snapshots';

/** The database as version 1 of the app left it: the stores of version 1 and nothing else. Only this test knows it. */
class V1Database extends Dexie {
  declare ships: Table<ShipProfile, string>;
  declare snapshots: Table<Snapshot, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      ships: 'id',
      crew: 'id, shipId',
      voyages: 'id, shipId',
      certificates: 'id, shipId',
      clockChanges: 'id, shipId',
      settings: 'key',
      snapshots: 'id, createdAt',
    });
  }
}

const ship = (id: string): ShipProfile => ({
  id, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', updatedBy: 'dev-1', deleted: false, scope: 'ship',
  particulars: {
    name: 'MV OCEAN STAR', imo: '', callSign: '', mmsi: '', flag: '', portOfRegistry: '', owners: '', managers: '', pandi: '', classSociety: '',
  },
});

/** A version-1 database holding one ship, one crew member and one setting, closed again. */
async function version1WithData(): Promise<string> {
  const name = 'v1-' + crypto.randomUUID();
  const v1 = new V1Database(name);
  await v1.ships.put(ship('ship-1'));
  await v1.table('crew').put({ id: 'crew-1', shipId: 'ship-1', deleted: false, surname: 'Petrović' });
  await v1.table('settings').put({ key: 'device', deviceId: 'dev-1', deviceName: 'Laptop', backupReminderDays: 7, lastSync: {}, theme: 'day' });
  expect(v1.backendDB().version).toBe(10); // Dexie multiplies the version it is given by 10 for IndexedDB
  v1.close();
  return name;
}

/** The version IndexedDB itself has installed (not the one a Dexie object declares), read through a plain connection. */
function installedVersion(name: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const { version } = request.result;
      request.result.close();
      resolve(version);
    };
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-25T09:00:00Z') }); // fake-indexeddb needs the real timers
});

afterEach(() => {
  vi.useRealTimers();
});

describe('upgrading a version-1 database to version 2', () => {
  it('saves a before-update snapshot of everything that was there, with no crew documents yet', async () => {
    const name = await version1WithData();
    const v2 = openDb(name);
    const snapshots = await listSnapshots(v2);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ reason: 'before-update', createdAt: '2026-10-25T09:00:00.000Z' });
    expect(snapshots[0].counts.ships).toBe(1);
    expect(snapshots[0].counts).toEqual({ ships: 1, crew: 1, voyages: 0, certificates: 0, clockChanges: 0, crewDocuments: 0 });
    const stored = (await v2.snapshots.get(snapshots[0].id)) as Snapshot;
    expect(Object.keys(stored.data)).toEqual([...TABLE_NAMES]);
    expect(stored.data.ships.map((s) => s.id)).toEqual(['ship-1']);
    v2.close();
  });

  it('keeps every record and the settings of version 1', async () => {
    const name = await version1WithData();
    const v2 = openDb(name);
    expect((await allTables(v2)).ships.map((s) => s.id)).toEqual(['ship-1']);
    expect(v2.backendDB().version).toBe(20); // installed: version 2 of the app, as IndexedDB counts it
    expect(await v2.crew.get('crew-1')).toMatchObject({ surname: 'Petrović' });
    expect((await getSettings(v2)).deviceId).toBe('dev-1');
    v2.close();
  });

  it('adds a crew documents table, indexed by ship and contract, that takes records', async () => {
    const name = await version1WithData();
    const v2 = openDb(name);
    await v2.open();
    expect(v2.crewDocuments.schema.idxByName).toHaveProperty('shipId');
    expect(v2.crewDocuments.schema.idxByName).toHaveProperty('crewId');
    await createRecord<CrewDocument>(v2, 'crewDocuments', {
      shipId: 'ship-1', crewId: 'c1', type: 'medical', grade: '', number: 'M-1', issuedBy: '', issueDate: '2025-01-01',
      expiryDate: '2027-01-01', remarks: '',
    });
    expect(await listForShip(v2, 'crewDocuments', 'ship-1')).toHaveLength(1);
    v2.close();
  });

  it('can be restored from the snapshot it took, which brings the version-1 data back', async () => {
    const name = await version1WithData();
    const v2 = openDb(name);
    await createRecord<CrewDocument>(v2, 'crewDocuments', {
      shipId: 'ship-1', crewId: 'crew-1', type: 'bst', grade: '', number: 'B-1', issuedBy: '', issueDate: '2025-01-01', remarks: '',
    });
    vi.setSystemTime(new Date('2026-10-25T10:00:00Z'));
    const [beforeUpdate] = (await listSnapshots(v2)).filter((s) => s.reason === 'before-update');
    await restoreSnapshot(v2, beforeUpdate.id);
    const restored = await allTables(v2);
    expect(restored.ships.map((s) => s.id)).toEqual(['ship-1']);
    expect(restored.crewDocuments).toEqual([]);
    v2.close();
  });

  it('opens a fresh database at version 2 without a snapshot', async () => {
    const v2 = openDb('fresh-' + crypto.randomUUID());
    expect(await listSnapshots(v2)).toEqual([]);
    expect(v2 instanceof MasterpieceDB).toBe(true);
    await v2.open();
    expect(v2.backendDB().version).toBe(20);
    v2.close();
  });

  it('installs version 2 once the upgrade has run, and not before', async () => {
    const name = await version1WithData();
    expect(await installedVersion(name)).toBe(10);
    const v2 = openDb(name);
    await v2.open();
    expect(await installedVersion(name)).toBe(20);
    v2.close();
  });
});

describe('an upgrade that fails', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('leaves the version-1 data and the installed version as they were, and no table of version 2', async () => {
    const name = await version1WithData();
    // The disk fills up while the upgrade saves its snapshot: the first write of the upgrade fails.
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('The disk is full.', 'QuotaExceededError');
    });
    const failing = openDb(name);
    const error = await failing.open().then(() => undefined, (err: unknown) => err);
    expect(isQuotaExceeded(error)).toBe(true);
    expect(failing.isOpen()).toBe(false);
    vi.restoreAllMocks();

    expect(await installedVersion(name)).toBe(10);
    const v1 = new V1Database(name);
    expect((await v1.ships.toArray()).map((s) => s.id)).toEqual(['ship-1']);
    expect(await v1.table('crew').get('crew-1')).toMatchObject({ surname: 'Petrović' });
    expect(await v1.table('settings').get('device')).toMatchObject({ deviceId: 'dev-1' });
    expect(await v1.snapshots.count()).toBe(0);
    expect(v1.backendDB().objectStoreNames.contains('crewDocuments')).toBe(false);
    v1.close();
  });

  it('can be tried again: the upgrade then runs, with its snapshot, over the same data', async () => {
    const name = await version1WithData();
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('The disk is full.', 'QuotaExceededError');
    });
    await openDb(name).open().catch(() => undefined);
    vi.restoreAllMocks();

    const v2 = openDb(name);
    await v2.open();
    expect(v2.backendDB().version).toBe(20);
    const snapshots = await listSnapshots(v2);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].counts).toMatchObject({ ships: 1, crew: 1 });
    v2.close();
  });
});

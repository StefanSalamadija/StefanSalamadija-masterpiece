import Dexie from 'dexie';
import type { Table } from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  v1.close();
  return name;
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
    expect(v2.verno).toBe(2);
    expect((await allTables(v2)).ships.map((s) => s.id)).toEqual(['ship-1']);
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
    expect(v2.verno).toBe(2);
    v2.close();
  });
});

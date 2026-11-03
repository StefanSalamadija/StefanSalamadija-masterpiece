import Dexie from 'dexie';
import type { Table } from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TABLE_NAMES } from '../domain/types';
import type { CrewDocument, FormDraft, ShipProfile, Snapshot } from '../domain/types';
import { saveTemplate } from './forms';
import { allTables, createRecord, listForShip } from './records';
import { openDb } from './schema';
import { getSettings } from './settings';
import { listSnapshots, restoreSnapshot } from './snapshots';
import { isQuotaExceeded } from './storage';

/** The database as version 2 of the app left it: the stores of versions 1 and 2 and nothing else. Only this test knows it. */
class V2Database extends Dexie {
  declare ships: Table<ShipProfile, string>;
  declare crewDocuments: Table<CrewDocument, string>;
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
    this.version(2).stores({ crewDocuments: 'id, shipId, crewId' });
  }
}

const stamp = { createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', updatedBy: 'dev-1', deleted: false, scope: 'ship' as const };

const ship = (id: string): ShipProfile => ({
  id, ...stamp,
  particulars: {
    name: 'MV OCEAN STAR', imo: '', callSign: '', mmsi: '', flag: '', portOfRegistry: '', owners: '', managers: '', pandi: '', classSociety: '',
  },
});

const document: CrewDocument = {
  id: 'doc-1', ...stamp, shipId: 'ship-1', crewId: 'crew-1', type: 'medical', grade: '', number: 'M-1', issuedBy: '', issueDate: '2025-01-01', remarks: '',
};

/** A version-2 database holding a ship, a crew member, a crew document and the settings, closed again. */
async function version2WithData(): Promise<string> {
  const name = 'v2-' + crypto.randomUUID();
  const v2 = new V2Database(name);
  await v2.ships.put(ship('ship-1'));
  await v2.table('crew').put({ id: 'crew-1', ...stamp, shipId: 'ship-1', surname: 'Petrović' });
  await v2.crewDocuments.put(document);
  await v2.table('settings').put({ key: 'device', deviceId: 'dev-1', deviceName: 'Laptop', backupReminderDays: 7, lastSync: {}, theme: 'day' });
  expect(v2.backendDB().version).toBe(20); // Dexie multiplies the version it is given by 10 for IndexedDB
  v2.close();
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
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-28T09:00:00Z') }); // fake-indexeddb needs the real timers
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('upgrading a version-2 database to version 3', () => {
  it('saves one before-update snapshot of everything that was there, with no forms yet', async () => {
    const name = await version2WithData();
    const v3 = openDb(name);
    const snapshots = await listSnapshots(v3);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ reason: 'before-update', createdAt: '2026-10-28T09:00:00.000Z' });
    expect(snapshots[0].counts).toEqual({
      ships: 1, crew: 1, voyages: 0, certificates: 0, clockChanges: 0, crewDocuments: 1,
      formTemplates: 0, formDrafts: 0, formLastValues: 0, formPhotos: 0,
    });
    const stored = (await v3.snapshots.get(snapshots[0].id)) as Snapshot;
    expect(Object.keys(stored.data)).toEqual([...TABLE_NAMES]);
    expect(stored.data.crewDocuments).toEqual([document]);
    v3.close();
  });

  it('keeps every record and the settings of version 2, unchanged', async () => {
    const name = await version2WithData();
    const v3 = openDb(name);
    const tables = await allTables(v3);
    expect(tables.ships).toEqual([ship('ship-1')]);
    expect(tables.crew).toEqual([{ id: 'crew-1', ...stamp, shipId: 'ship-1', surname: 'Petrović' }]);
    expect(tables.crewDocuments).toEqual([document]);
    expect(tables).toMatchObject({ voyages: [], certificates: [], clockChanges: [], formTemplates: [], formDrafts: [], formLastValues: [], formPhotos: [] });
    expect((await getSettings(v3)).deviceId).toBe('dev-1');
    expect(v3.backendDB().version).toBe(30); // installed: version 3 of the app, as IndexedDB counts it
    v3.close();
  });

  it('adds the four forms tables with their indexes, which take records', async () => {
    const name = await version2WithData();
    const v3 = openDb(name);
    await v3.open();
    expect(Object.keys(v3.formTemplates.schema.idxByName)).toEqual(['code']);
    expect(Object.keys(v3.formDrafts.schema.idxByName).sort()).toEqual(['shipId', 'templateId']);
    expect(Object.keys(v3.formLastValues.schema.idxByName).sort()).toEqual(['code', 'shipId']);
    expect(Object.keys(v3.formPhotos.schema.idxByName).sort()).toEqual(['draftId', 'shipId']);
    const template = await saveTemplate(v3, {
      fileName: 'toolbox.docx', bytes: new Uint8Array([1, 2, 3]), kind: 'docx',
      schema: { kind: 'docx', identity: { code: 'TST-01', title: 'Toolbox Talk', revision: '00' }, fields: [], rowGroups: [], unsupported: [] },
      setup: { links: {}, leftEmpty: [], helpers: { pickCrew: [], allOk: [], todayRow: [], startFromLast: [], jobLog: [], thresholds: [], now: [] }, okWord: 'Satisfactory', notFinished: '' },
    });
    expect(await v3.formTemplates.where('code').equals('TST-01').first()).toEqual(template);
    await createRecord<FormDraft>(v3, 'formDrafts', {
      shipId: 'ship-1', templateId: template.id, code: 'TST-01', period: '2026-10-28', values: { fields: {}, rows: {} }, photoIds: [],
    });
    expect(await listForShip(v3, 'formDrafts', 'ship-1')).toHaveLength(1);
    v3.close();
  });

  it('can be restored from the snapshot it took, which brings the version-2 data back without forms', async () => {
    const name = await version2WithData();
    const v3 = openDb(name);
    await createRecord<FormDraft>(v3, 'formDrafts', {
      shipId: 'ship-1', templateId: 't1', code: 'TST-01', period: '2026-10-28', values: { fields: {}, rows: {} }, photoIds: [],
    });
    vi.setSystemTime(new Date('2026-10-28T10:00:00Z'));
    const [beforeUpdate] = (await listSnapshots(v3)).filter((s) => s.reason === 'before-update');
    await restoreSnapshot(v3, beforeUpdate.id);
    const restored = await allTables(v3);
    expect(restored.crewDocuments).toEqual([document]);
    expect(restored.formDrafts).toEqual([]);
    v3.close();
  });

  it('opens a fresh database at version 3 without a snapshot', async () => {
    const v3 = openDb('fresh-' + crypto.randomUUID());
    expect(await listSnapshots(v3)).toEqual([]);
    expect(v3.backendDB().version).toBe(30);
    v3.close();
  });

  it('takes one snapshot, not one per version, when a version-1 database is upgraded straight to version 3', async () => {
    const name = 'v1-' + crypto.randomUUID();
    const v1 = new Dexie(name);
    v1.version(1).stores({ ships: 'id', crew: 'id, shipId', voyages: 'id, shipId', certificates: 'id, shipId', clockChanges: 'id, shipId', settings: 'key', snapshots: 'id, createdAt' });
    await v1.table('ships').put(ship('ship-1'));
    v1.close();
    const v3 = openDb(name);
    const snapshots = await listSnapshots(v3);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].counts).toMatchObject({ ships: 1, crewDocuments: 0, formTemplates: 0 });
    expect(v3.backendDB().version).toBe(30);
    v3.close();
  });
});

describe('an upgrade to version 3 that fails', () => {
  it('leaves the version-2 data and the installed version as they were, and no forms table', async () => {
    const name = await version2WithData();
    // The disk fills up while the upgrade saves its snapshot: the first write of the upgrade fails.
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('The disk is full.', 'QuotaExceededError');
    });
    const failing = openDb(name);
    const error = await failing.open().then(() => undefined, (err: unknown) => err);
    expect(isQuotaExceeded(error)).toBe(true);
    expect(failing.isOpen()).toBe(false);
    vi.restoreAllMocks();

    expect(await installedVersion(name)).toBe(20);
    const v2 = new V2Database(name);
    expect(await v2.ships.toArray()).toEqual([ship('ship-1')]);
    expect(await v2.crewDocuments.toArray()).toEqual([document]);
    expect(await v2.table('settings').get('device')).toMatchObject({ deviceId: 'dev-1' });
    expect(await v2.snapshots.count()).toBe(0);
    for (const table of ['formTemplates', 'formDrafts', 'formLastValues', 'formPhotos']) {
      expect(v2.backendDB().objectStoreNames.contains(table), table).toBe(false);
    }
    v2.close();
  });

  it('can be tried again: the upgrade then runs, with its one snapshot, over the same data', async () => {
    const name = await version2WithData();
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('The disk is full.', 'QuotaExceededError');
    });
    await openDb(name).open().catch(() => undefined);
    vi.restoreAllMocks();

    const v3 = openDb(name);
    await v3.open();
    expect(v3.backendDB().version).toBe(30);
    const snapshots = await listSnapshots(v3);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].counts).toMatchObject({ ships: 1, crew: 1, crewDocuments: 1 });
    v3.close();
  });
});

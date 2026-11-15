import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShipProfile } from '../domain/types';
import { TABLE_NAMES } from '../domain/types';
import { allTables } from './records';
import { openDb } from './schema';
import { getSettings } from './settings';
import { listSnapshots, takeSnapshot } from './snapshots';
import type { Snapshot } from '../domain/types';

const stamp = { createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', updatedBy: 'dev-1', deleted: false, scope: 'ship' as const };
const ship: ShipProfile = {
  id: 'ship-1', ...stamp,
  particulars: { name: 'MV OCEAN STAR', imo: '', callSign: '', mmsi: '', flag: '', portOfRegistry: '', owners: '', managers: '', pandi: '', classSociety: '' },
};

/** The database as version 3 of the app left it. Only this test knows it. */
class V3Database extends Dexie {
  constructor(name: string) {
    super(name);
    this.version(1).stores({
      ships: 'id', crew: 'id, shipId', voyages: 'id, shipId', certificates: 'id, shipId', clockChanges: 'id, shipId', settings: 'key', snapshots: 'id, createdAt',
    });
    this.version(2).stores({ crewDocuments: 'id, shipId, crewId' });
    this.version(3).stores({ formTemplates: 'id, code', formDrafts: 'id, shipId, templateId', formLastValues: 'id, shipId, code', formPhotos: 'id, shipId, draftId' });
  }
}

async function version3WithData(): Promise<string> {
  const name = 'v3-' + crypto.randomUUID();
  const v3 = new V3Database(name);
  await v3.table('ships').put(ship);
  await v3.table('settings').put({ key: 'device', deviceId: 'dev-1', deviceName: 'Laptop', backupReminderDays: 7, lastSync: {}, theme: 'day' });
  expect(v3.backendDB().version).toBe(30);
  v3.close();
  return name;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-16T09:00:00Z') });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('upgrading a version-3 database to version 4', () => {
  it('keeps the existing data and settings, and makes empty library tables', async () => {
    const db = openDb(await version3WithData());
    const tables = await allTables(db);
    expect(tables.ships).toEqual([ship]);
    expect(tables.libraryDocs).toEqual([]);
    expect(tables.libraryFolders).toEqual([]);
    expect(await db.libraryFiles.count()).toBe(0);
    expect(await db.libraryText.count()).toBe(0);
    expect((await getSettings(db)).deviceId).toBe('dev-1');
    expect(db.backendDB().version).toBe(40);
    expect(Object.keys(db.libraryDocs.schema.idxByName).sort()).toEqual(['folderId', 'sha256']);
    expect(Object.keys(db.libraryText.schema.idxByName)).toEqual(['docId']);
    db.close();
  });

  it('saves one before-update snapshot that has the library tables, empty', async () => {
    const db = openDb(await version3WithData());
    const [summary] = await listSnapshots(db);
    expect(summary).toMatchObject({ reason: 'before-update' });
    expect(summary.counts.ships).toBe(1);
    expect(summary.counts.libraryDocs).toBe(0);
    db.close();
  });
});

describe('snapshots and the library', () => {
  it('contain the library records and never the files or the text', async () => {
    const db = openDb('snap-' + crypto.randomUUID());
    const { addDocument } = await import('./library');
    await addDocument(db, {
      title: 'T', tags: [], fileName: 'a.pdf', mimeType: 'application/pdf', kind: 'pdf', size: 1, sha256: 's', textStatus: 'indexed',
      blob: new Blob(['a']), parts: [{ part: 1, label: 'Page 1', text: 'x' }],
    });
    const taken = await takeSnapshot(db, 'manual');
    const stored = (await db.snapshots.get(taken.id)) as Snapshot;
    expect(Object.keys(stored.data)).toEqual([...TABLE_NAMES]);
    expect(stored.data.libraryDocs).toHaveLength(1);
    expect(stored.data).not.toHaveProperty('libraryFiles');
    expect(stored.data).not.toHaveProperty('libraryText');
    db.close();
  });
});

import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryFolder, ShipProfile, Snapshot } from '../domain/types';
import { TABLE_NAMES } from '../domain/types';
import { addEntry, ensureBudgetSetup } from './budget';
import { allTables } from './records';
import { openDb } from './schema';
import { getSettings } from './settings';
import { listSnapshots, takeSnapshot } from './snapshots';

const stamp = { createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', updatedBy: 'dev-1', deleted: false };
const ship: ShipProfile = {
  id: 'ship-1', ...stamp, scope: 'ship',
  particulars: { name: 'MV OCEAN STAR', imo: '', callSign: '', mmsi: '', flag: '', portOfRegistry: '', owners: '', managers: '', pandi: '', classSociety: '' },
};
const folder: LibraryFolder = { id: 'folder-1', ...stamp, scope: 'personal', name: 'Manuals' };

const BUDGET_TABLES = [
  'budgetCategories', 'budgetEntries', 'budgetMonths', 'budgetRecurring', 'budgetFunds', 'budgetFundMoves', 'budgetDebts', 'budgetGoals',
  'budgetAssets', 'budgetCorrections', 'budgetScenarios', 'budgetSettings',
] as const;

/** The database as version 4 of the app left it. Only this test knows it. */
class V4Database extends Dexie {
  constructor(name: string) {
    super(name);
    this.version(1).stores({
      ships: 'id', crew: 'id, shipId', voyages: 'id, shipId', certificates: 'id, shipId', clockChanges: 'id, shipId', settings: 'key', snapshots: 'id, createdAt',
    });
    this.version(2).stores({ crewDocuments: 'id, shipId, crewId' });
    this.version(3).stores({ formTemplates: 'id, code', formDrafts: 'id, shipId, templateId', formLastValues: 'id, shipId, code', formPhotos: 'id, shipId, draftId' });
    this.version(4).stores({ libraryDocs: 'id, folderId, sha256', libraryFolders: 'id', libraryFiles: 'docId', libraryText: 'id, docId', libraryOpened: 'docId' });
  }
}

async function version4WithData(): Promise<string> {
  const name = 'v4-' + crypto.randomUUID();
  const v4 = new V4Database(name);
  await v4.table('ships').put(ship);
  await v4.table('libraryFolders').put(folder);
  await v4.table('libraryFiles').put({ docId: 'doc-1', blob: new Blob(['a']) });
  await v4.table('settings').put({ key: 'device', deviceId: 'dev-1', deviceName: 'Laptop', backupReminderDays: 7, lastSync: {}, theme: 'day' });
  expect(v4.backendDB().version).toBe(40);
  v4.close();
  return name;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-16T09:00:00Z') });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('upgrading a version-4 database to version 5', () => {
  it('keeps the existing data and settings, and makes empty budget tables', async () => {
    const db = openDb(await version4WithData());
    const tables = await allTables(db);
    expect(tables.ships).toEqual([ship]);
    expect(tables.libraryFolders).toEqual([folder]);
    expect(await db.libraryFiles.count()).toBe(1);
    for (const name of BUDGET_TABLES) expect(tables[name]).toEqual([]);
    expect((await getSettings(db)).deviceId).toBe('dev-1');
    expect(db.backendDB().version).toBe(50);
    db.close();
  });

  it('indexes the budget tables as the budget reads them', async () => {
    const db = openDb(await version4WithData());
    const indexes = (name: (typeof BUDGET_TABLES)[number]) => Object.keys(db[name].schema.idxByName).sort();
    expect(indexes('budgetEntries')).toEqual(['categoryId', 'date', 'status']);
    expect(indexes('budgetMonths')).toEqual(['ym']);
    expect(indexes('budgetFundMoves')).toEqual(['fundId', 'ym']);
    expect(indexes('budgetCorrections')).toEqual(['account', 'ym']);
    expect(indexes('budgetSettings')).toEqual(['key']);
    for (const name of BUDGET_TABLES) expect(db[name].schema.primKey.keyPath).toBe('id');
    db.close();
  });

  it('saves one before-update snapshot that has the budget tables, empty', async () => {
    const db = openDb(await version4WithData());
    const snapshots = await listSnapshots(db);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ reason: 'before-update' });
    expect(snapshots[0].counts.ships).toBe(1);
    expect(snapshots[0].counts.libraryFolders).toBe(1);
    expect(snapshots[0].counts.budgetEntries).toBe(0);
    db.close();
  });
});

describe('the budget tables', () => {
  it('come last among the syncable tables, and are personal, not a ship\'s', async () => {
    const { PERSONAL_TABLES, SHIP_TABLES } = await import('../domain/types');
    expect(TABLE_NAMES.slice(-BUDGET_TABLES.length)).toEqual([...BUDGET_TABLES]);
    for (const name of BUDGET_TABLES) {
      expect(PERSONAL_TABLES).toContain(name);
      expect(SHIP_TABLES).not.toContain(name);
    }
  });

  it('are in a snapshot', async () => {
    const db = openDb('snap-' + crypto.randomUUID());
    await ensureBudgetSetup(db);
    await addEntry(db, { kind: 'income', date: '2026-11-10', amount: 450000, incomeSource: 'salary', status: 'actual' });
    const taken = await takeSnapshot(db, 'manual');
    const stored = (await db.snapshots.get(taken.id)) as Snapshot;
    expect(Object.keys(stored.data)).toEqual([...TABLE_NAMES]);
    expect(stored.data.budgetEntries).toHaveLength(1);
    expect(stored.data.budgetSettings).toHaveLength(1);
    db.close();
  });
});

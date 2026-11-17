import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BudgetCategory, CrewMember, ShipProfile, Snapshot } from '../domain/types';
import { PERSONAL_TABLES, SHIP_TABLES, TABLE_NAMES } from '../domain/types';
import { allTables } from './records';
import { openDb } from './schema';
import { getSettings } from './settings';
import { listSnapshots, takeSnapshot } from './snapshots';
import { saveSurvey } from './survey';

const stamp = { createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', updatedBy: 'dev-1', deleted: false };
const ship: ShipProfile = {
  id: 'ship-1', ...stamp, scope: 'ship',
  particulars: { name: 'MV OCEAN STAR', imo: '', callSign: '', mmsi: '', flag: '', portOfRegistry: '', owners: '', managers: '', pandi: '', classSociety: '' },
};
const crew: CrewMember = {
  id: 'crew-1', ...stamp, scope: 'ship', shipId: 'ship-1', surname: 'Doe', givenNames: 'Jan', rank: 'master', nationality: 'X',
  dateOfBirth: '1980-01-01', placeOfBirth: 'X', passportNo: 'P1', passportExpiry: '2030-01-01', seamansBookNo: 'S1',
  seamansBookExpiry: '2030-01-01', signOnDate: '2026-06-01', signOnPort: 'X',
};
const category: BudgetCategory = { id: 'bc-1', ...stamp, scope: 'personal', pot: 'needs', name: 'Rent', order: 0, hidden: false };

const SURVEY_TABLES = ['draftSurveyShips', 'hydroTables', 'draftSurveys', 'surveyTemplates'] as const;

/** The database as version 5 of the app left it. Only this test knows it. */
class V5Database extends Dexie {
  constructor(name: string) {
    super(name);
    this.version(1).stores({
      ships: 'id', crew: 'id, shipId', voyages: 'id, shipId', certificates: 'id, shipId', clockChanges: 'id, shipId', settings: 'key', snapshots: 'id, createdAt',
    });
    this.version(2).stores({ crewDocuments: 'id, shipId, crewId' });
    this.version(3).stores({ formTemplates: 'id, code', formDrafts: 'id, shipId, templateId', formLastValues: 'id, shipId, code', formPhotos: 'id, shipId, draftId' });
    this.version(4).stores({ libraryDocs: 'id, folderId, sha256', libraryFolders: 'id', libraryFiles: 'docId', libraryText: 'id, docId', libraryOpened: 'docId' });
    this.version(5).stores({
      budgetCategories: 'id', budgetEntries: 'id, date, categoryId, status', budgetMonths: 'id, ym', budgetRecurring: 'id', budgetFunds: 'id',
      budgetFundMoves: 'id, fundId, ym', budgetDebts: 'id', budgetGoals: 'id', budgetAssets: 'id', budgetCorrections: 'id, account, ym',
      budgetScenarios: 'id', budgetSettings: 'id, key',
    });
  }
}

async function version5WithData(): Promise<string> {
  const name = 'v5-' + crypto.randomUUID();
  const v5 = new V5Database(name);
  await v5.table('ships').put(ship);
  await v5.table('crew').put(crew);
  await v5.table('budgetCategories').put(category);
  await v5.table('settings').put({ key: 'device', deviceId: 'dev-1', deviceName: 'Laptop', backupReminderDays: 7, lastSync: {}, theme: 'day' });
  expect(v5.backendDB().version).toBe(50);
  v5.close();
  return name;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-16T09:00:00Z') });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('upgrading a version-5 database to version 6', () => {
  it('keeps the existing data and settings, and makes empty draft survey tables', async () => {
    const db = openDb(await version5WithData());
    const tables = await allTables(db);
    expect(tables.ships).toEqual([ship]);
    expect(tables.crew).toEqual([crew]);
    expect(tables.budgetCategories).toEqual([category]);
    for (const name of SURVEY_TABLES) expect(tables[name], name).toEqual([]);
    expect((await getSettings(db)).deviceId).toBe('dev-1');
    expect(db.backendDB().version).toBe(60);
    db.close();
  });

  it('indexes every draft survey table by ship, keyed by id', async () => {
    const db = openDb(await version5WithData());
    for (const name of SURVEY_TABLES) {
      expect(db[name].schema.primKey.keyPath, name).toBe('id');
      expect(db[name].schema.idxByName, name).toHaveProperty('shipId');
    }
    expect(db.draftSurveys.schema.idxByName).toHaveProperty('initialId');
    db.close();
  });

  it('saves one before-update snapshot of the data as version 5 had it', async () => {
    const db = openDb(await version5WithData());
    const snapshots = await listSnapshots(db);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ reason: 'before-update' });
    expect(snapshots[0].counts.ships).toBe(1);
    expect(snapshots[0].counts.crew).toBe(1);
    expect(snapshots[0].counts.budgetCategories).toBe(1);
    expect(snapshots[0].counts.draftSurveys).toBe(0);
    db.close();
  });
});

describe('the draft survey tables', () => {
  it('come last among the syncable tables, and belong to a ship', () => {
    expect(TABLE_NAMES.slice(-SURVEY_TABLES.length)).toEqual([...SURVEY_TABLES]);
    for (const name of SURVEY_TABLES) {
      expect(SHIP_TABLES).toContain(name);
      expect(PERSONAL_TABLES).not.toContain(name);
    }
  });

  it('are in a snapshot', async () => {
    const db = openDb('snap-' + crypto.randomUUID());
    await saveSurvey(db, 'ship-1', { kind: 'initial', operation: 'loading', drafts: { fP: 5.1 }, deductibles: {} });
    const taken = await takeSnapshot(db, 'manual');
    const stored = (await db.snapshots.get(taken.id)) as Snapshot;
    expect(Object.keys(stored.data)).toEqual([...TABLE_NAMES]);
    expect(stored.data.draftSurveys).toHaveLength(1);
    db.close();
  });
});

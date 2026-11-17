import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HydroRow } from '../domain/types';
import type { CellMap } from '../survey/workbook/types';
import { fromBase64 } from '../backup/crypto';
import { openDb } from './schema';
import type { MasterpieceDB } from './schema';
import { getSettings } from './settings';
import { createShip, deleteShip } from './ships';
import {
  deleteSurvey, getHydro, getSurveyShip, getTemplate, listSurveys, saveHydro, saveSurvey, saveSurveyImport, saveSurveyShip, saveTemplate,
} from './survey';
import type { SurveyShipFields } from './survey';

// Made-up figures only.
const shipData: SurveyShipFields = {
  lbp: 100, dF: -1.5, dM: 0.2, dA: 3.1, beam: 18, keelPlateCorr: 0, lightShip: 3000, summerDraught: 8, summerDwt: 9000,
  lcfSource: 'workbook', ranges: { initial: { dispTpcMtcFrom: 2, lcfFrom: 2 }, final: { dispTpcMtcFrom: 2, lcfFrom: 2 } },
  sourceName: 'made-up.xlsx', importedAt: '2026-11-16T09:00:00.000Z',
};
const rows: HydroRow[] = [
  { draft: 2, displacement: 3500, tpc: 15, mtc: 100, lcbMid: 1, lcfMid: 0.5 },
  { draft: 2.1, displacement: 3650, tpc: 15.1, mtc: 101, lcbMid: 1.01, lcfMid: 0.49, lcfTabledMid: 0.6 },
];
const cellMap: CellMap = { INITIAL: { port: 'C5', fP: 'C10' }, FINAL: { port: 'C5', fP: 'C10', finalOwnDA: 'F3', finalOwnLBP: 'F2' } };

let db: MasterpieceDB;
let shipId: string;

function at(iso: string): void {
  vi.setSystemTime(new Date(iso));
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  at('2026-11-16T08:00:00.000Z');
  db = openDb('survey-' + crypto.randomUUID());
  shipId = (await createShip(db, 'MV TEST', 0)).id;
});
afterEach(() => {
  db.close();
  vi.useRealTimers();
});

describe('the ship data for draft surveys', () => {
  it('is absent until saved, then one record per ship that a second save updates', async () => {
    expect(await getSurveyShip(db, shipId)).toBeUndefined();
    const first = await saveSurveyShip(db, shipId, shipData);
    expect(first).toMatchObject({ ...shipData, shipId, scope: 'ship', deleted: false });
    at('2026-11-16T09:00:00.000Z');
    const second = await saveSurveyShip(db, shipId, { ...shipData, lbp: 101, summerDwt: undefined });
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBe('2026-11-16T09:00:00.000Z');
    expect(second).not.toHaveProperty('summerDwt');
    expect(await db.draftSurveyShips.count()).toBe(1);
    expect(await getSurveyShip(db, shipId)).toEqual(second);
    expect(await getSurveyShip(db, 'other-ship')).toBeUndefined();
  });

  it('has the same id on every device, so two devices that import the same ship merge into one record', async () => {
    const other = openDb('survey-' + crypto.randomUUID());
    const mine = await saveSurveyShip(db, shipId, shipData);
    const theirs = await saveSurveyShip(other, shipId, shipData);
    expect(theirs.id).toBe(mine.id);
    other.close();
  });
});

describe('the hydrostatic table', () => {
  it('is replaced as a whole', async () => {
    expect(await getHydro(db, shipId)).toBeUndefined();
    const first = await saveHydro(db, shipId, rows);
    expect(first.rows).toEqual(rows);
    const second = await saveHydro(db, shipId, rows.slice(0, 1));
    expect(second.id).toBe(first.id);
    expect((await getHydro(db, shipId))?.rows).toEqual(rows.slice(0, 1));
    expect(await db.hydroTables.count()).toBe(1);
  });

  it('refuses rows that are not in increasing draft order, or that are not numbers', async () => {
    await expect(saveHydro(db, shipId, [rows[1], rows[0]])).rejects.toThrow(/draft/i);
    await expect(saveHydro(db, shipId, [rows[0], { ...rows[0] }])).rejects.toThrow(/draft/i);
    await expect(saveHydro(db, shipId, [{ ...rows[0], tpc: Number.NaN }])).rejects.toThrow();
    expect(await db.hydroTables.count()).toBe(0);
  });
});

describe('draft surveys', () => {
  it('are created, updated as a whole, listed for their ship and soft-deleted', async () => {
    const initial = await saveSurvey(db, shipId, {
      kind: 'initial', operation: 'loading', port: 'Port A', date: '2026-11-15', drafts: { fP: 5.12, fS: 5.14 }, density: 1.025,
      deductibles: { ballast: 1200.5 },
    });
    expect(initial).toMatchObject({ shipId, scope: 'ship', kind: 'initial', deleted: false });
    at('2026-11-16T09:00:00.000Z');
    const final = await saveSurvey(db, shipId, {
      kind: 'final', initialId: initial.id, operation: 'loading', drafts: {}, deductibles: {},
    });
    await saveSurvey(db, 'other-ship', { kind: 'constant', operation: 'discharging', drafts: {}, deductibles: {} });
    expect((await listSurveys(db, shipId)).map((s) => s.id)).toEqual([final.id, initial.id]);

    at('2026-11-16T10:00:00.000Z');
    const edited = await saveSurvey(db, shipId, { kind: 'initial', operation: 'loading', drafts: { fP: 5.2 }, deductibles: {} }, initial.id);
    expect(edited.id).toBe(initial.id);
    expect(edited.createdAt).toBe(initial.createdAt);
    expect(edited.updatedAt).toBe('2026-11-16T10:00:00.000Z');
    expect(edited).not.toHaveProperty('port');
    expect(edited.drafts).toEqual({ fP: 5.2 });

    await deleteSurvey(db, initial.id);
    expect((await listSurveys(db, shipId)).map((s) => s.id)).toEqual([final.id]);
    const tombstone = await db.draftSurveys.get(initial.id);
    expect(tombstone).toMatchObject({ deleted: true, updatedBy: (await getSettings(db)).deviceId });
    await expect(saveSurvey(db, shipId, { kind: 'initial', operation: 'loading', drafts: {}, deductibles: {} }, initial.id)).rejects.toThrow();
  });

  it('cannot be moved to another ship by an update', async () => {
    const s = await saveSurvey(db, shipId, { kind: 'initial', operation: 'loading', drafts: {}, deductibles: {} });
    await expect(saveSurvey(db, 'other-ship', { kind: 'initial', operation: 'loading', drafts: {}, deductibles: {} }, s.id)).rejects.toThrow();
  });
});

describe('the company workbook template', () => {
  it('keeps the file as base64 with its cell map, one per ship', async () => {
    expect(await getTemplate(db, shipId)).toBeUndefined();
    const bytes = new Uint8Array([80, 75, 3, 4, 1, 2, 3]);
    const saved = await saveTemplate(db, shipId, { fileName: 'survey.xlsx', bytes, cellMap });
    expect(saved).toMatchObject({ shipId, fileName: 'survey.xlsx', cellMap });
    expect(fromBase64(saved.fileBase64)).toEqual(bytes);
    const again = await saveTemplate(db, shipId, { fileName: 'survey2.xlsx', bytes, cellMap });
    expect(again.id).toBe(saved.id);
    expect((await getTemplate(db, shipId))?.fileName).toBe('survey2.xlsx');
  });
});

describe('saving an imported workbook', () => {
  const template = { fileName: 'made-up.xlsx', bytes: new Uint8Array([1, 2, 3]), cellMap };

  it('writes the table, the ship data and the template together', async () => {
    await saveSurveyImport(db, shipId, { hydro: rows, ship: shipData, template });
    expect((await getHydro(db, shipId))?.rows).toEqual(rows);
    expect(await getSurveyShip(db, shipId)).toMatchObject(shipData);
    expect((await getTemplate(db, shipId))?.fileName).toBe('made-up.xlsx');
  });

  it('is one transaction: when the template can’t be written, the table and the ship data stay as they were', async () => {
    await saveSurveyImport(db, shipId, { hydro: rows, ship: shipData, template });
    const put = vi.spyOn(db.surveyTemplates, 'put').mockRejectedValueOnce(new Error('disk full'));
    await expect(saveSurveyImport(db, shipId, { hydro: rows.slice(0, 1), ship: { ...shipData, lbp: 120 }, template })).rejects.toThrow();
    put.mockRestore();
    expect((await getHydro(db, shipId))?.rows).toEqual(rows);
    expect((await getSurveyShip(db, shipId))?.lbp).toBe(100);
  });
});

describe('deleting the ship', () => {
  it('soft-deletes its draft survey records with it', async () => {
    await saveSurveyShip(db, shipId, shipData);
    await saveHydro(db, shipId, rows);
    await saveSurvey(db, shipId, { kind: 'initial', operation: 'loading', drafts: {}, deductibles: {} });
    await saveTemplate(db, shipId, { fileName: 'survey.xlsx', bytes: new Uint8Array([1]), cellMap });
    await deleteShip(db, shipId);
    expect(await getSurveyShip(db, shipId)).toBeUndefined();
    expect(await getHydro(db, shipId)).toBeUndefined();
    expect(await listSurveys(db, shipId)).toEqual([]);
    expect(await getTemplate(db, shipId)).toBeUndefined();
    for (const table of [db.draftSurveyShips, db.hydroTables, db.draftSurveys, db.surveyTemplates]) {
      expect((await table.toArray()).every((r) => r.deleted)).toBe(true);
    }
    // The deletion reaches other devices; the workbook file does not.
    expect((await db.surveyTemplates.toArray()).map((t) => t.fileBase64)).toEqual(['']);
  });

  it('a save after the ship data was deleted makes it live again', async () => {
    const first = await saveSurveyShip(db, shipId, shipData);
    await db.draftSurveyShips.put({ ...first, deleted: true });
    const again = await saveSurveyShip(db, shipId, shipData);
    expect(again.deleted).toBe(false);
  });
});

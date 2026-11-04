import { describe, expect, it } from 'vitest';
import { importForm } from '../forms/engine';
import { allOkValues, checkReading, defaultSetup, draftPeriod, jobLogColumns, startFromLast, thresholdsOf } from '../forms/helpers';
import { conditionListXlsx, dayGridXlsx, inventoryXlsx, matrixXlsx } from '../forms/testing/excelFixtures';
import { jobsWithPhotosDotx, permitDocx, toolboxTalkDocx, weeklyJobsDotx } from '../forms/testing/wordFixtures';
import type { DraftValues, FormSchema, FormSetup } from '../forms/types';
import type { ClockChange } from '../domain/types';
import {
  allOkButtons, applyAllOk, autoDateFor, blockTitle, lastText, lastShown, newJobRow, nextFreeSlot, nowOffset, periodStart, photoSlots,
  placeRows, readingWarning, remarksRule, remarksShown, rowLimit, shownRows, withLastValues,
} from './formHelpers';

const schemaOf = (name: string, bytes: Uint8Array): FormSchema => importForm(name, bytes).schema;
const permit = schemaOf('permit.docx', permitDocx());
const toolbox = schemaOf('toolbox.docx', toolboxTalkDocx());
const weekly = schemaOf('weekly.dotx', weeklyJobsDotx());
const inventory = schemaOf('inventory.xlsx', inventoryXlsx());
const dayGrid = schemaOf('daygrid.xlsx', dayGridXlsx());
const conditions = schemaOf('conditions.xlsx', conditionListXlsx());
const matrix = schemaOf('matrix.xlsx', matrixXlsx());
const setupOf = (s: FormSchema): FormSetup => defaultSetup(s);
const EMPTY: DraftValues = { fields: {}, rows: {} };

describe('periodStart and autoDateFor (R19)', () => {
  it('gives the first day of a day, a week and a month', () => {
    expect(periodStart('2026-10-28')).toBe('2026-10-28');
    expect(periodStart('2026-W44')).toBe('2026-10-26'); // a Monday
    expect(periodStart('2026-W01')).toBe('2025-12-29');
    expect(periodStart('2026-10')).toBe('2026-10-01');
    expect(periodStart('nonsense')).toBeUndefined();
  });

  it('is the ship\'s today when it lies in the period, else the first day of the period', () => {
    expect(autoDateFor('2026-W44', '2026-10-28', '2026-W44')).toBe('2026-10-28');
    expect(autoDateFor('2026-W45', '2026-10-28', '2026-W44')).toBe('2026-11-02');
    expect(autoDateFor('2026-11', '2026-10-28', '2026-10')).toBe('2026-11-01');
    expect(autoDateFor('garbled', '2026-10-28', '2026-10')).toBe('2026-10-28');
    // With the real period rule.
    const setup = setupOf(weekly);
    expect(autoDateFor('2026-W45', '2026-10-28', draftPeriod(setup, '2026-10-28'))).toBe('2026-11-02');
  });
});

describe('start from last', () => {
  const last: DraftValues = {
    fields: { 'Demo matrix!B7': 'Pump', 'Demo matrix!B17': 'Ann Master' },
    rows: { 'Demo inventory!g1': [{ 'Demo inventory!g1.E': '5' }] },
  };

  it('keeps to the groups and blocks the setup lists', () => {
    const inv = setupOf(inventory);
    expect(inv.helpers.startFromLast).toEqual(['Demo inventory!g1']);
    const started = withLastValues(undefined, inventory, inv, startFromLast(inventory, last));
    expect(started.rows['Demo inventory!g1'][0]['Demo inventory!g1.E']).toBe('5');
    const off = { ...inv, helpers: { ...inv.helpers, startFromLast: [] } };
    expect(withLastValues(undefined, inventory, off, startFromLast(inventory, last))).toEqual(EMPTY);
    const mat = setupOf(matrix);
    expect(withLastValues(undefined, matrix, mat, startFromLast(matrix, last)).fields).toEqual({ 'Demo matrix!B7': 'Pump' });
  });

  it('never overwrites what the draft holds', () => {
    const inv = setupOf(inventory);
    const existing: DraftValues = { fields: {}, rows: { 'Demo inventory!g1': [{ 'Demo inventory!g1.E': '9' }] } };
    expect(withLastValues(existing, inventory, inv, startFromLast(inventory, last))).toEqual(existing);
    const withField: DraftValues = { fields: { 'Demo matrix!B7': 'Fan' }, rows: {} };
    expect(withLastValues(withField, matrix, setupOf(matrix), startFromLast(matrix, last)).fields['Demo matrix!B7']).toBe('Fan');
  });

  it('shows Last: <value> only where the value differs from the last one', () => {
    expect(lastText('5')).toBe('5');
    expect(lastText(' ')).toBeUndefined();
    expect(lastText(null)).toBeUndefined();
    expect(lastText(true)).toBe('Yes');
    expect(lastText(false)).toBe('No');
    expect(lastShown('5', '5')).toBeUndefined();
    expect(lastShown('8', '5')).toBe('Last: 5');
    expect(lastShown(null, '5')).toBe('Last: 5');
    expect(lastShown('8', undefined)).toBeUndefined();
    expect(lastShown(' 5 ', '5')).toBeUndefined();
  });
});

describe('All OK', () => {
  const setup = setupOf(permit);
  const buttons = allOkButtons(permit, setup, allOkValues);

  it('makes one button for each section, worded by the answer it sets', () => {
    expect(buttons.map((b) => [b.section, b.label, b.fieldIds])).toEqual([
      ['Section 1 – Checks', 'All Yes', ['f1', 'f2', 'f3', 'f4']],
      ['Section 2 – Entry', 'All Yes', ['f5', 'f6', 'f7']],
    ]);
  });

  it('words a checklist by the ok word, and groups it by its section', () => {
    const c = allOkButtons(conditions, setupOf(conditions), allOkValues);
    expect(c.map((b) => [b.label, b.groupIds])).toEqual([['All Satisfactory', ['Demo conditions!g1']]]);
    expect(allOkButtons(toolbox, setupOf(toolbox), allOkValues)).toEqual([]);
  });

  it('sets only the empty fields, and counts the answers that differ', () => {
    const start: DraftValues = { fields: { f2: 'No', f3: 'Yes' }, rows: {} };
    const first = applyAllOk(start, permit, buttons[0], setup.okWord, allOkValues, false);
    expect(first.values.fields).toEqual({ f1: 'Yes', f2: 'No', f3: 'Yes', f4: 'Yes' });
    expect(first.differing).toBe(1);
    expect(first.set).toEqual(['f1', 'f4']);
    const all = applyAllOk(start, permit, buttons[0], setup.okWord, allOkValues, true);
    expect(all.values.fields).toEqual({ f1: 'Yes', f2: 'Yes', f3: 'Yes', f4: 'Yes' });
    expect(all.set).toEqual(['f1', 'f2', 'f4']);
    expect(start.fields).toEqual({ f2: 'No', f3: 'Yes' }); // not touched
  });

  it('sets the condition of every row of a checklist, keeping a remark', () => {
    const g = conditions.rowGroups[0];
    const [condition, remarks] = g.columns;
    const c = allOkButtons(conditions, setupOf(conditions), allOkValues)[0];
    const start: DraftValues = { fields: {}, rows: { [g.id]: [{ [remarks.id]: 'Seen' }, { [condition.id]: 'Defective' }] } };
    const done = applyAllOk(start, conditions, c, 'Satisfactory', allOkValues, false);
    const rows = done.values.rows[g.id];
    expect(rows).toHaveLength(100);
    expect(rows[0]).toEqual({ [remarks.id]: 'Seen', [condition.id]: 'Satisfactory' });
    expect(rows[1][condition.id]).toBe('Defective');
    expect(done.differing).toBe(1);
    expect(rows[2]).toEqual({ [condition.id]: 'Satisfactory' });
    expect(applyAllOk(start, conditions, c, 'Satisfactory', allOkValues, true).values.rows[g.id][1][condition.id]).toBe('Satisfactory');
  });

  it('sets nothing in a cell that continues a vertical merge (R22)', () => {
    const g = { ...conditions.rowGroups[0], closed: { [conditions.rowGroups[0].columns[0].id]: [1] } };
    const condition = g.columns[0];
    const schema = { ...conditions, rowGroups: [g] };
    const c = allOkButtons(schema, setupOf(schema), allOkValues)[0];
    const rows = applyAllOk(EMPTY, schema, c, 'Satisfactory', allOkValues, true).values.rows[g.id];
    expect([rows[0][condition.id], rows[1][condition.id], rows[2][condition.id]]).toEqual(['Satisfactory', undefined, 'Satisfactory']);
  });
});

describe('Remarks under a row that is not OK', () => {
  const g = conditions.rowGroups[0];
  const rule = remarksRule(g, allOkValues(g, 'Satisfactory'))!;

  it('finds the answer column and the remarks column', () => {
    expect(rule).toEqual({ status: g.columns[0].id, remarks: g.columns[1].id, ok: 'Satisfactory' });
    expect(remarksRule(inventory.rowGroups[0], {})).toBeUndefined();
    expect(remarksRule(g, {})).toBeUndefined();
  });

  it('shows the remarks for an answer that is not OK, or when it already has a text', () => {
    expect(remarksShown(rule, undefined)).toBe(false);
    expect(remarksShown(rule, { [rule.status]: 'Satisfactory' })).toBe(false);
    expect(remarksShown(rule, { [rule.status]: 'satisfactory ' })).toBe(false);
    expect(remarksShown(rule, { [rule.status]: 'Defective' })).toBe(true);
    expect(remarksShown(rule, { [rule.status]: 'Satisfactory', [rule.remarks]: 'Paint' })).toBe(true);
  });
});

describe('rows from the crew', () => {
  const g = toolbox.rowGroups[0];
  const [name, rank] = g.columns;
  const people = [{ [name.id]: 'A', [rank.id]: 'Bosun' }, { [name.id]: 'B', [rank.id]: 'AB' }, { [name.id]: 'C', [rank.id]: 'OS' }];

  it('fills the free rows first, then adds rows', () => {
    const start: DraftValues = { fields: {}, rows: { [g.id]: [{ [name.id]: 'X' }, {}, { [name.id]: 'Y' }] } };
    const placed = placeRows(start, g, people, Infinity);
    expect(placed.placed).toBe(3);
    expect(placed.values.rows[g.id].map((r) => r[name.id])).toEqual(['X', 'A', 'Y', 'B', 'C']);
    expect(start.rows[g.id]).toHaveLength(3);
  });

  it('puts each person only in a row whose cells are open, passing rows whose Name cell continues a merge (R22)', () => {
    const merged = { ...g, closed: { [name.id]: [1, 2] } };
    const placed = placeRows(EMPTY, merged, people, Infinity);
    expect(placed.placed).toBe(3);
    expect(placed.values.rows[g.id].map((r) => r[name.id])).toEqual(['A', undefined, undefined, 'B', 'C']);
    // When the template's last row is closed, the rows added after it are too: no room is made up.
    const last = { ...g, closed: { [name.id]: [g.capacity - 1] } };
    const full: DraftValues = { fields: {}, rows: { [g.id]: Array.from({ length: g.capacity - 1 }, () => ({ [name.id]: 'X' })) } };
    expect(placeRows(full, last, people, Infinity).placed).toBe(0);
  });

  it('stops at the form\'s room', () => {
    const placed = placeRows(EMPTY, g, people, 2);
    expect(placed.placed).toBe(2);
    expect(placed.values.rows[g.id]).toHaveLength(2);
  });

  it('knows the room of a table', () => {
    expect(rowLimit(g, 'docx')).toBe(Infinity); // Word rows are cloned
    expect(rowLimit(g, 'xlsx')).toBe(g.capacity);
    expect(rowLimit({ ...g, growable: false }, 'docx')).toBe(g.capacity);
  });
});

describe('the job log', () => {
  const jobs = weekly.rowGroups[0];

  it('starts a job with the ship\'s today and the not-finished status', () => {
    const cols = jobLogColumns(jobs)!;
    expect(newJobRow(cols, '2026-10-28', 'Pending')).toEqual({ [cols.date.id]: '2026-10-28', [cols.status.id]: 'Pending' });
    expect(newJobRow(cols, '2026-10-28', '')).toEqual({ [cols.date.id]: '2026-10-28' });
  });

  it('pairs each picture with the Photo choice after it, and finds the next free slot', () => {
    const pictures = weekly.rowGroups[1];
    const slots = photoSlots(pictures);
    expect(slots.map((s) => [s.picture.id, s.choice?.id])).toEqual([['g2.c1', 'g2.c2'], ['g2.c3', 'g2.c4'], ['g2.c5', 'g2.c6']]);
    expect(photoSlots(jobs)).toEqual([]);
    expect(nextFreeSlot(pictures, [], Infinity)).toEqual({ row: 0, slot: slots[0] });
    const rows = [{ 'g2.c1': 'p1', 'g2.c3': 'p2' }];
    expect(nextFreeSlot(pictures, rows, Infinity)).toEqual({ row: 0, slot: slots[2] });
    const full = [{ 'g2.c1': 'p1', 'g2.c3': 'p2', 'g2.c5': 'p3' }];
    expect(nextFreeSlot(pictures, full, Infinity)).toEqual({ row: 1, slot: slots[0] });
    expect(nextFreeSlot(pictures, full, 1)).toBeUndefined();
    // A picture cell that continues a merge (R22) is never offered.
    const merged = { ...pictures, closed: { 'g2.c1': [0] } };
    expect(nextFreeSlot(merged, [], Infinity)).toEqual({ row: 0, slot: slots[1] });
    expect(nextFreeSlot({ ...pictures, closed: { 'g2.c1': [0], 'g2.c3': [0], 'g2.c5': [0] } }, [], 1)).toBeUndefined();
  });
});

describe('a job log with its photos in the same table', () => {
  const mixed = schemaOf('jobs-photos.dotx', jobsWithPhotosDotx());
  const jobs = mixed.rowGroups[0];

  it('has picture columns and other columns to fill, so it is no pure photo table', () => {
    expect(photoSlots(jobs).map((s) => [s.picture.id, s.choice?.id])).toEqual([['g1.c5', 'g1.c6']]);
    expect(jobLogColumns(jobs)?.cleared.map((c) => c.id)).toEqual(['g1.c5', 'g1.c6']);
  });
});

describe('alarm warnings', () => {
  const gas = permit.rowGroups[0];
  const limits = thresholdsOf(gas);
  const o2 = limits.find((t) => t.column === 'g1.c2')!;
  const co = limits.find((t) => t.column === 'g1.c3')!;

  it('words a reading below or above its limit, and says nothing otherwise', () => {
    expect(readingWarning('O2 [Vol.%]', '18.5', o2, checkReading)).toBe('O2 18.5 — below 19.5');
    expect(readingWarning('CO [ppm]', '31', co, checkReading)).toBe('CO 31 — above 25');
    expect(readingWarning('CO [ppm]', '25', co, checkReading)).toBeUndefined();
    expect(readingWarning('CO [ppm]', '', co, checkReading)).toBeUndefined();
    expect(readingWarning('CO [ppm]', 'lots', co, checkReading)).toBeUndefined();
    expect(readingWarning('CO [ppm]', null, co, checkReading)).toBeUndefined();
    expect(readingWarning('O2 [Vol.%]', '18,5', o2, checkReading)).toBe('O2 18,5 — below 19.5');
  });
});

describe('Now', () => {
  const change = (effectiveAt: string, toOffsetMinutes: number) => ({ effectiveAt, toOffsetMinutes, deleted: false }) as ClockChange;
  const changes = [change('2026-01-01T00:00:00Z', 60), change('2026-10-28T12:00:00Z', 120)];

  it('uses the ship\'s offset, or none for a time in UTC', () => {
    const now = new Date('2026-10-28T13:00:00Z');
    expect(nowOffset({ formatHint: undefined }, changes, now)).toBe(120);
    expect(nowOffset({ formatHint: '(24:00 UTC)' }, changes, now)).toBe(0);
    expect(nowOffset({ formatHint: '(24:00 utc)' }, changes, now)).toBe(0);
    expect(nowOffset({ formatHint: 'HH:mm' }, changes, now)).toBe(120);
    expect(nowOffset({}, [], now)).toBe(0);
  });
});

describe('a day grid', () => {
  it('shows only the rows asked for', () => {
    expect(shownRows(31, undefined)).toHaveLength(31);
    expect(shownRows(31, 27)).toEqual([27]);
    expect(shownRows(31, -1)).toHaveLength(31);
    expect(shownRows(3, 5)).toEqual([0, 1, 2]);
  });
});

describe('matrix blocks (R14)', () => {
  it('titles a block by its number, with the sheet when the form has several', () => {
    expect(blockTitle('Demo matrix!m1', false)).toBe('Table 1');
    expect(blockTitle('Demo matrix!m2', true)).toBe('Demo matrix: Table 2');
    expect(blockTitle('odd', false)).toBe('odd');
  });
});

void dayGrid;

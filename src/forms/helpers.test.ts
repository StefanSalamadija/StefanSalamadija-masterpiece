import { describe, expect, it } from 'vitest';
import type { CrewMember } from '../domain/types';
import {
  allOkRows, allOkValues, checkReading, crewRows, defaultNotFinished, defaultSetup, draftPeriod, isJobLogGroup,
  isoWeekPeriod, nowValue, periodLabel, rolloverJobs, startFromLast, suggestHelpers, thresholdsOf, todayRowIndex,
} from './helpers';
import { readPackage } from './package';
import { conditionListXlsx, dayGridXlsx, inventoryXlsx, matrixXlsx } from './testing/excelFixtures';
import { permitDocx, toolboxTalkDocx, weeklyJobsDotx } from './testing/wordFixtures';
import { detectExcel } from './excel/detect';
import { detectWord } from './word/detect';
import { DEFAULT_OK_WORD } from './types';
import type { DraftValues, FieldDef, FormSetup, RowGroupDef } from './types';

const toolbox = detectWord(readPackage(toolboxTalkDocx()), 'docx', 'toolbox.docx');
const permit = detectWord(readPackage(permitDocx()), 'docx', 'permit.docx');
const weekly = detectWord(readPackage(weeklyJobsDotx()), 'dotx', 'weekly.dotx');
const inventory = detectExcel(readPackage(inventoryXlsx(20)), 'inventory.xlsx');
const dayGrid = detectExcel(readPackage(dayGridXlsx()), 'daygrid.xlsx');
const matrix = detectExcel(readPackage(matrixXlsx()), 'matrix.xlsx');
const conditions = detectExcel(readPackage(conditionListXlsx()), 'conditions.xlsx');

const base = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'test-device', deleted: false, scope: 'ship' as const, shipId: 'ship-1' };
function person(over: Partial<CrewMember>): CrewMember {
  return {
    ...base, id: 'c1', surname: 'Marin', givenNames: 'Ana', rank: 'chiefOfficer', nationality: 'Croatian', dateOfBirth: '1980-03-14',
    placeOfBirth: 'Split', passportNo: 'P1', passportExpiry: '2030-01-01', seamansBookNo: 'SB1', seamansBookExpiry: '2030-01-01',
    signOnDate: '2026-09-01', signOnPort: 'Rijeka', ...over,
  };
}
const ana = person({});
const ivo = person({ id: 'c2', surname: 'Kovac', givenNames: 'Ivo', rank: 'other', rankOther: 'Pumpman' });

const group = (s: { rowGroups: RowGroupDef[] }, id: string): RowGroupDef => s.rowGroups.find((g) => g.id === id)!;
const field = (id: string, over: Partial<FieldDef> = {}): FieldDef => ({
  id, kind: 'text', label: id, section: '', loc: id, confidence: 'high', ...over,
});
const colIds = (g: RowGroupDef, label: string) => g.columns.filter((c) => c.label === label).map((c) => c.id);

describe('suggestHelpers', () => {
  it('permit: ticks for allOk, the gas table for thresholds, time fields and columns for now', () => {
    const h = suggestHelpers(permit);
    expect(h.allOk).toEqual(['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7']);
    expect(h.thresholds).toEqual(['g1']);
    expect(h.now).toEqual(['g1.c1', 'g2.c2', 'g2.c3']);
    expect(h.pickCrew).toEqual(['g2']);
    expect(h.todayRow).toEqual([]);
    expect(h.startFromLast).toEqual([]);
    expect(h.jobLog).toEqual([]);
  });
  it('toolbox: pick from crew on the participants and Now on the time field', () => {
    const h = suggestHelpers(toolbox);
    expect(h.pickCrew).toEqual(['g1']);
    expect(h.now).toEqual(['f4']);
    expect(h.allOk).toEqual([]);
  });
  it('weekly jobs: the jobs group is the job log, the pictures group is not', () => {
    const h = suggestHelpers(weekly);
    expect(h.jobLog).toEqual(['g1']);
    expect(isJobLogGroup(group(weekly, 'g1'))).toBe(true);
    expect(isJobLogGroup(group(weekly, 'g2'))).toBe(false);
    expect(h.pickCrew).toEqual([]);
  });
  it('excel: day grid, inventory, matrix block and condition list', () => {
    expect(suggestHelpers(dayGrid).todayRow).toEqual(['Demo day grid!g1']);
    expect(suggestHelpers(dayGrid).startFromLast).toEqual([]);
    expect(suggestHelpers(inventory).startFromLast).toEqual(['Demo inventory!g1']);
    expect(suggestHelpers(matrix).startFromLast).toEqual(['Demo matrix!m1']);
    expect(suggestHelpers(conditions).allOk).toEqual(['Demo conditions!g1']);
  });
  it('a time-kind field and a text field labelled Time both get Now; a signature does not', () => {
    const schema = {
      ...toolbox,
      fields: [field('a', { kind: 'time', label: 'ETA' }), field('b', { label: 'Time' }), field('c', { kind: 'time', label: 'Sig time', leftEmpty: true }), field('d', { label: 'Remarks' })],
      rowGroups: [],
    };
    expect(suggestHelpers(schema).now).toEqual(['a', 'b']);
  });
  it('allOk skips a dropdown with no positive option', () => {
    const schema = { ...toolbox, rowGroups: [], fields: [field('a', { kind: 'choice', options: ['Pending', 'Completed'] }), field('b', { kind: 'choice', options: ['Good', 'Poor'] })] };
    expect(suggestHelpers(schema).allOk).toEqual(['b']);
  });
});

describe('crewRows', () => {
  it('fills Name and Rank and leaves the signature column out', () => {
    const g = group(toolbox, 'g1');
    expect(crewRows(g, [ana, ivo])).toEqual([
      { 'g1.c1': 'Ana Marin', 'g1.c2': 'Chief Officer' },
      { 'g1.c1': 'Ivo Kovac', 'g1.c2': 'Pumpman' },
    ]);
  });
  it('fills a combined Name / Rank column as "<name> / <rank>"', () => {
    const rows = crewRows(group(permit, 'g2'), [ana]);
    expect(rows).toEqual([{ 'g2.c1': 'Ana Marin / Chief Officer' }]);
  });
  it('never writes into a leftEmpty column, even one called Name', () => {
    const g: RowGroupDef = { ...group(toolbox, 'g1'), columns: [field('x', { label: 'Name', leftEmpty: true }), field('y', { label: 'Rank' })] };
    expect(crewRows(g, [ana])).toEqual([{ y: 'Chief Officer' }]);
  });
});

describe('allOkValues', () => {
  const yn = (id: string, options: string[]) => field(id, { kind: 'choice', options });
  it('takes the first option that reads yes, ok or good', () => {
    expect(allOkValues([yn('a', ['No', 'Yes', 'N/A']), yn('b', ['Poor', 'Good']), yn('c', ['Not OK', 'OK'])], 'Satisfactory'))
      .toEqual({ a: 'Yes', b: 'Good', c: 'OK' });
  });
  it('uses the ok word when it is one of the options, in the option\'s own spelling', () => {
    expect(allOkValues([yn('a', ['Unsatisfactory', 'SATISFACTORY'])], 'Satisfactory')).toEqual({ a: 'SATISFACTORY' });
  });
  it('writes nothing for a choice with no positive option and no ok word, and for non-choice fields', () => {
    expect(allOkValues([yn('a', ['Pending', 'Completed']), field('t'), field('k', { kind: 'checkbox' })], 'Satisfactory')).toEqual({});
  });
  it('permit ticks all become Yes', () => {
    const fields = permit.fields.filter((f) => f.kind === 'choice');
    const v = allOkValues(fields, DEFAULT_OK_WORD);
    expect(Object.keys(v)).toHaveLength(7);
    expect(new Set(Object.values(v))).toEqual(new Set(['Yes']));
  });
  it('a checklist group gets the ok word in its condition column only', () => {
    const g = group(conditions, 'Demo conditions!g1');
    expect(allOkValues(g, 'Satisfactory')).toEqual({ 'Demo conditions!g1.C': 'Satisfactory' });
    expect(allOkRows(g, 'Good', [{ 'Demo conditions!g1.D': 'leaky' }]).slice(0, 2)).toEqual([
      { 'Demo conditions!g1.D': 'leaky', 'Demo conditions!g1.C': 'Good' },
      { 'Demo conditions!g1.C': 'Good' },
    ]);
    expect(allOkRows(g, 'Good')).toHaveLength(100);
  });
  it('a non-checklist group gets the positive option of its choice columns', () => {
    const g: RowGroupDef = { ...group(weekly, 'g1'), columns: [field('c1', { label: 'Item' }), yn('c2', ['Yes', 'No'])], shape: 'rows' };
    expect(allOkValues(g, 'Satisfactory')).toEqual({ c2: 'Yes' });
  });
});

describe('todayRowIndex', () => {
  it('is the day minus one', () => {
    const g = group(dayGrid, 'Demo day grid!g1');
    expect(todayRowIndex(g, '2026-10-28')).toBe(27);
    expect(todayRowIndex(g, '2026-11-01')).toBe(0);
    expect(todayRowIndex(g, '2026-10-31')).toBe(30);
  });
  it('matches row labels numerically, and is -1 when labels exist but miss the day', () => {
    const g = group(dayGrid, 'Demo day grid!g1');
    const labelled = (labels: string[]): RowGroupDef => ({ ...g, rowLabels: labels });
    const range = (from: number, to: number, f: (n: number) => string) => Array.from({ length: to - from + 1 }, (_, i) => f(from + i));
    expect(todayRowIndex(labelled(range(2, 31, String)), '2026-10-01')).toBe(-1);
    expect(todayRowIndex(labelled(range(1, 31, (n) => String(n).padStart(2, '0'))), '2026-10-05')).toBe(4);
    expect(todayRowIndex(labelled(range(1, 31, (n) => `${n}st`)), '2026-10-12')).toBe(11);
    expect(todayRowIndex(labelled(['Mon', 'Tue']), '2026-10-02')).toBe(-1);
  });
  it('is -1 when the grid has no row for the day', () => {
    expect(todayRowIndex({ ...group(dayGrid, 'Demo day grid!g1'), capacity: 28, rowLabels: undefined }, '2026-10-30')).toBe(-1);
  });
});

describe('startFromLast', () => {
  const invG = group(inventory, 'Demo inventory!g1');
  const last: DraftValues = {
    fields: { 'Demo inventory!C6': 'MV OLD', 'Demo inventory!E6': '2026-09-01' },
    rows: { [invG.id]: [{ [`${invG.id}.C`]: 'Hose', [`${invG.id}.E`]: '4', [`${invG.id}.D`]: null }], other: [{ x: '1' }] },
  };
  it('copies the rows of a rows group with row labels, not the header fields', () => {
    expect(startFromLast(inventory, last)).toEqual({ fields: {}, rows: { [invG.id]: [{ [`${invG.id}.C`]: 'Hose', [`${invG.id}.E`]: '4' }] } });
  });
  it('copies every field of a matrix block and nothing else', () => {
    const cells = matrix.fields.filter((f) => f.block === 'Demo matrix!m1');
    const fields: Record<string, string> = { 'Demo matrix!B17': 'Somebody' };
    for (const c of cells.slice(0, 3)) fields[c.id] = 'x';
    const out = startFromLast(matrix, { fields, rows: {} });
    expect(Object.keys(out.fields)).toEqual(cells.slice(0, 3).map((c) => c.id));
  });
  it('gives an empty draft with no last values', () => {
    expect(startFromLast(inventory, undefined)).toEqual({ fields: {}, rows: {} });
  });
  it('does not copy leftEmpty or picture columns', () => {
    const g: RowGroupDef = { ...invG, columns: [field('a'), field('b', { leftEmpty: true }), field('p', { kind: 'picture' })] };
    const schema = { ...inventory, rowGroups: [g] };
    expect(startFromLast(schema, { fields: {}, rows: { [g.id]: [{ a: '1', b: 's', p: 'photo1' }] } }).rows[g.id]).toEqual([{ a: '1' }]);
  });
  it('does not copy a day grid', () => {
    const g = group(dayGrid, 'Demo day grid!g1');
    expect(startFromLast(dayGrid, { fields: {}, rows: { [g.id]: [{ a: '1' }] } }).rows).toEqual({});
  });
});

describe('periods', () => {
  const setup = (over: Partial<FormSetup['helpers']>): FormSetup => ({
    links: {}, leftEmpty: [], okWord: DEFAULT_OK_WORD, notFinished: '',
    helpers: { pickCrew: [], allOk: [], todayRow: [], startFromLast: [], jobLog: [], thresholds: [], now: [], ...over },
  });
  it('isoWeekPeriod pads the week', () => {
    expect(isoWeekPeriod('2026-10-28')).toBe('2026-W44');
    expect(isoWeekPeriod('2026-02-01')).toBe('2026-W05');
    expect(isoWeekPeriod('2027-01-01')).toBe('2026-W53');
  });
  it('draftPeriod: month for today\'s row, week for a job log, else the day', () => {
    expect(draftPeriod(setup({ todayRow: ['g1'], jobLog: ['g2'] }), '2026-10-28')).toBe('2026-10');
    expect(draftPeriod(setup({ jobLog: ['g2'] }), '2026-10-28')).toBe('2026-W44');
    expect(draftPeriod(setup({}), '2026-10-28')).toBe('2026-10-28');
  });
  it('periodLabel', () => {
    expect(periodLabel('2026-10')).toBe('October 2026');
    expect(periodLabel('2026-W44')).toBe('Week 44, 2026');
    expect(periodLabel('2026-W05')).toBe('Week 5, 2026');
    expect(periodLabel('2026-10-28')).toBe('28-OCT-2026');
    expect(periodLabel('whatever')).toBe('whatever');
  });
});

describe('job log', () => {
  it('defaultNotFinished', () => {
    expect(defaultNotFinished(['Completed', 'In progress'])).toBe('In progress');
    expect(defaultNotFinished(['Completed', 'Pending'])).toBe('Pending');
    expect(defaultNotFinished(['Done', ' open '])).toBe(' open ');
    expect(defaultNotFinished(['Completed', 'Cancelled'])).toBe('');
    expect(defaultNotFinished([])).toBe('');
  });
  const g = group(weekly, 'g1');
  const [date, resp, desc, status, remarks] = g.columns.map((c) => c.id);
  it('rolloverJobs keeps only the not-finished rows, with date, responsible, description and remarks', () => {
    const rows = [
      { [date]: '2026-10-26', [resp]: 'Ana', [desc]: 'Paint', [status]: 'Pending', [remarks]: 'wait for dry' },
      { [date]: '2026-10-27', [resp]: 'Ivo', [desc]: 'Grease', [status]: 'Completed', [remarks]: '' },
    ];
    expect(rolloverJobs(g, rows, 'Pending')).toEqual([rows[0]]);
    expect(rolloverJobs(g, rows, '')).toEqual([]);
  });
  it('clears picture columns and Photo choices, wherever the group has them', () => {
    const j: RowGroupDef = {
      ...g, columns: [...g.columns, field('pic', { kind: 'picture', label: 'Picture' }), field('ph', { kind: 'choice', label: 'Photo', options: ['Before', 'After'] })],
    };
    const row = { [date]: '2026-10-26', [status]: 'Pending', pic: 'photo-1', ph: 'Before' };
    const out = rolloverJobs(j, [row], 'Pending');
    expect(out).toEqual([{ [date]: '2026-10-26', [status]: 'Pending' }]);
    expect(row.pic).toBe('photo-1'); // input untouched
  });
  it('is nothing for a group that is not a job log (the pictures group is never carried)', () => {
    expect(rolloverJobs(group(weekly, 'g2'), [{ 'g2.c1': 'p1' }], 'Pending')).toEqual([]);
  });
});

describe('thresholds', () => {
  const g = group(permit, 'g1');
  it('maps the permit alarm rows to the gas columns (the first cell is the label column)', () => {
    expect(thresholdsOf(g, { fields: {}, rows: {} })).toEqual([
      { column: 'g1.c2', low: 19.5, high: 23 },
      { column: 'g1.c3', high: 25 },
      { column: 'g1.c4', high: 5 },
    ]);
  });
  it('cells that do not repeat the label map straight onto the columns (Excel)', () => {
    const x: RowGroupDef = {
      ...g, columns: [field('a', { label: 'O2' }), field('b', { label: 'H2S' })],
      fixedRows: [{ label: 'Pre-alarm', cells: ['20,5', '5'] }, { label: 'Main alarm', cells: ['19', '10'] }, { label: 'Note', cells: ['x', 'y'] }],
    };
    expect(thresholdsOf(x, { fields: {}, rows: {} })).toEqual([{ column: 'a', low: 19, high: 20.5 }, { column: 'b', high: 5 }]);
  });
  it('CO2 is not oxygen; a text cell is skipped', () => {
    const x: RowGroupDef = { ...g, columns: [field('a', { label: 'CO2 [%]' }), field('b', { label: 'LEL' })], fixedRows: [{ label: 'Alarm 1', cells: ['0.5', 'n/a'] }, { label: 'Alarm 2', cells: ['1', '10'] }] };
    expect(thresholdsOf(x, { fields: {}, rows: {} })).toEqual([{ column: 'a', high: 0.5 }, { column: 'b', high: 10 }]);
  });
  it('a short alarm row still lines up with its columns', () => {
    const x: RowGroupDef = { ...g, fixedRows: [{ label: 'Alarm 1', cells: ['Alarm 1', '19.5'] }] };
    expect(thresholdsOf(x, { fields: {}, rows: {} })).toEqual([{ column: 'g1.c2', high: 19.5 }]);
  });
  it('a number under a Time column gets no threshold', () => {
    const x: RowGroupDef = {
      ...g, columns: [field('t', { label: 'Time' }), field('a', { label: 'CO [ppm]', kind: 'number' })],
      fixedRows: [{ label: 'Alarm 1', cells: ['Alarm 1', '25'] }, { label: 'Alarm 2', cells: ['12', '50'] }],
    };
    expect(thresholdsOf(x, { fields: {}, rows: {} })).toEqual([{ column: 'a', high: 25 }]);
  });
  it('none for a group without alarm rows', () => {
    expect(thresholdsOf(group(toolbox, 'g1'), { fields: {}, rows: {} })).toEqual([]);
  });
  it('checkReading', () => {
    expect(checkReading('18.5', { low: 19, high: 23 })).toBe('low');
    expect(checkReading('31', { high: 30 })).toBe('high');
    expect(checkReading('20,5', { low: 19, high: 23 })).toBe('ok');
    expect(checkReading('19', { low: 19, high: 23 })).toBe('ok');
    expect(checkReading('23', { low: 19, high: 23 })).toBe('ok');
    expect(checkReading('1,000.5', { high: 5 })).toBe('invalid');
    expect(checkReading('abc', { high: 5 })).toBe('invalid');
    expect(checkReading('', { high: 5 })).toBe('ok');
    expect(checkReading('50', {})).toBe('ok');
  });
});

describe('nowValue', () => {
  it('is the ship\'s clock as HH:mm', () => {
    expect(nowValue(new Date('2026-10-28T10:05:00Z'), 120)).toBe('12:05');
    expect(nowValue(new Date('2026-10-28T23:30:00Z'), 90)).toBe('01:00');
    expect(nowValue(new Date('2026-10-28T00:10:00Z'), -330)).toBe('18:40');
    expect(nowValue(new Date('2026-10-28T09:07:59Z'), 0)).toBe('09:07');
  });
});

describe('defaultSetup', () => {
  it('weekly: links, jobLog and the Pending status', () => {
    const s = defaultSetup(weekly);
    expect(s.helpers.jobLog).toEqual(['g1']);
    expect(s.notFinished).toBe('Pending');
    expect(s.okWord).toBe(DEFAULT_OK_WORD);
    expect(s.links['f1']).toEqual({ source: 'vessel.name' });
  });
  it('toolbox: the signature column is left empty', () => {
    const s = defaultSetup(toolbox);
    expect(s.leftEmpty).toEqual(['g1.c3']);
    expect(s.notFinished).toBe('');
    expect(s.helpers.pickCrew).toEqual(['g1']);
  });
  it('excel: leftEmpty fields and matrix ids', () => {
    expect(defaultSetup(inventory).leftEmpty).toEqual(['Demo inventory!C31']);
    expect(defaultSetup(matrix).helpers.startFromLast).toEqual(['Demo matrix!m1']);
  });
});

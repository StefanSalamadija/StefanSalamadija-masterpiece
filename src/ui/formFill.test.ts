import { describe, expect, it } from 'vitest';
import { importForm, makeFile } from '../forms/engine';
import { FormWriteError, INTEGRITY_MESSAGE, IntegrityError } from '../forms/errors';
import { readPackage } from '../forms/package';
import { readWordValues } from '../forms/word/read';
import { defaultSetup, draftPeriod, isJobLogGroup, rolloverJobs } from '../forms/helpers';
import { conditionListXlsx, dayGridXlsx, inventoryXlsx } from '../forms/testing/excelFixtures';
import { permitDocx, toolboxTalkDocx, weeklyJobsDotx } from '../forms/testing/wordFixtures';
import type { DraftValues, FieldDef, FormSchema } from '../forms/types';
import {
  addRow, canAddRow, choiceControl, makeAndHandOver, fileValues, fillHeading, fillProblems, fillSections, isAuto, isFixedRows, isLongText,
  NUMBER_INVALID, numberProblem, removeRow, rolloverFor, rowCount, rowTitle, setCell, setField, shownValue, visibleColumns,
  writeErrorText,
} from './formFill';

const schemaOf = (name: string, bytes: Uint8Array): FormSchema => importForm(name, bytes).schema;
const toolbox = schemaOf('toolbox.docx', toolboxTalkDocx());
const permit = schemaOf('permit.docx', permitDocx());
const weekly = schemaOf('weekly.dotx', weeklyJobsDotx());
const inventory = schemaOf('inventory.xlsx', inventoryXlsx());
const dayGrid = schemaOf('daygrid.xlsx', dayGridXlsx());
const conditions = schemaOf('conditions.xlsx', conditionListXlsx());

const EMPTY: DraftValues = { fields: {}, rows: {} };
const NO_AUTO = { values: {}, missing: {} };
/** What the items of a section are, as `f1` for a field and `[g1]` for a row group. */
const itemsOf = (s: ReturnType<typeof fillSections>[number]) => s.items.map((i) => (i.kind === 'field' ? i.field.id : `[${i.group.id}]`));

describe('fillSections', () => {
  it('groups the fields and tables by section, in document order, with tables among the fields', () => {
    const sections = fillSections(permit);
    expect(sections.map((s) => s.title)).toEqual(['Section 1 – Checks', 'Section 2 – Entry', 'Gas readings', 'Personnel']);
    expect(sections.map(itemsOf)).toEqual([
      ['f1', 'f2', 'f3', 'f4'],
      ['f5', 'f6', 'f7'],
      ['[g1]'],
      ['[g2]', 'f8'], // the Personnel table comes before the checkbox below it
    ]);
  });

  it('starts with the fields that are under no heading, and leaves out signatures', () => {
    const sections = fillSections(toolbox);
    expect(sections.map((s) => s.title)).toEqual(['', 'Participants']);
    expect(sections.map(itemsOf)).toEqual([['f1', 'f2', 'f3', 'f4'], ['[g1]']]);
    // The inventory's C/O signature is under the table; it is left empty, so it is not asked for.
    expect(fillSections(inventory).map(itemsOf)).toEqual([['Demo inventory!C6', 'Demo inventory!E6', '[Demo inventory!g1]']]);
  });

  it('puts an Excel field after a table above it on the sheet, by row', () => {
    const sections = fillSections(dayGrid);
    expect(sections.map(itemsOf)).toEqual([['Demo day grid!B6', '[Demo day grid!g1]', 'Demo day grid!B42']]);
  });

  it('leaves out a table with nothing to fill here, and the signature and picture columns of the others', () => {
    // The weekly form's pictures table still has its Photo choices to fill.
    expect(fillSections(weekly).flatMap(itemsOf)).toEqual(['f1', 'f2', 'f3', '[g1]', '[g2]']);
    const pictures = weekly.rowGroups.find((g) => g.id === 'g2')!;
    expect(visibleColumns(pictures).map((c) => c.label)).toEqual(['Photo', 'Photo', 'Photo']);
    expect(visibleColumns(toolbox.rowGroups[0]).map((c) => c.label)).toEqual(['Name', 'Rank']);
    const onlySignatures: FormSchema = {
      ...toolbox, rowGroups: [{ ...toolbox.rowGroups[0], columns: [{ ...toolbox.rowGroups[0].columns[2] }] }],
    };
    expect(fillSections(onlySignatures).flatMap(itemsOf)).toEqual(['f1', 'f2', 'f3', 'f4']);
  });
});

describe('auto values and edits', () => {
  const auto = { values: { f1: 'MV OCEAN STAR', f3: '2026-10-25' }, missing: { f2: 'No Master onboard' } };

  it('shows the auto value, marked Auto, until the field is edited', () => {
    expect(shownValue(EMPTY, auto, 'f1')).toBe('MV OCEAN STAR');
    expect(isAuto(EMPTY, auto, 'f1')).toBe(true);
    expect(shownValue(EMPTY, auto, 'f2')).toBeNull();
    expect(isAuto(EMPTY, auto, 'f2')).toBe(false);
  });

  it('keeps an edit over the auto value, and over a later auto value too', () => {
    const edited = setField(EMPTY, 'f1', 'MV SEA BREEZE');
    expect(EMPTY.fields).toEqual({}); // not changed in place
    expect(shownValue(edited, auto, 'f1')).toBe('MV SEA BREEZE');
    expect(isAuto(edited, auto, 'f1')).toBe(false);
    const later = { values: { f1: 'MV RENAMED', f3: '2026-10-26' }, missing: {} };
    expect(shownValue(edited, later, 'f1')).toBe('MV SEA BREEZE');
    // An auto value cleared on purpose stays empty.
    const cleared = setField(edited, 'f3', '');
    expect(shownValue(cleared, later, 'f3')).toBe('');
    expect(isAuto(cleared, later, 'f3')).toBe(false);
  });

  it('writes the auto values that were not edited into the file, and the edits', () => {
    const values = setField(setField(EMPTY, 'f2', 'Fire drill'), 'f3', '2026-10-20');
    expect(fileValues(toolbox, values, auto)).toEqual({
      fields: { f1: 'MV OCEAN STAR', f2: 'Fire drill', f3: '2026-10-20' },
      rows: {},
    });
  });

  it('never writes a value for a field that is left empty or not in the form', () => {
    const values: DraftValues = { fields: { f2: 'x', gone: 'y' }, rows: {} };
    const leftEmpty: FormSchema = { ...toolbox, fields: toolbox.fields.map((f) => (f.id === 'f2' ? { ...f, leftEmpty: true } : f)) };
    expect(fileValues(leftEmpty, values, NO_AUTO).fields).toEqual({});
  });
});

describe('numbers', () => {
  it('keeps the typed text and accepts a comma or a point as the decimal mark', () => {
    expect(numberProblem('12,5')).toBeUndefined();
    expect(numberProblem('12.5')).toBeUndefined();
    expect(numberProblem('-3')).toBeUndefined(); // a temperature can be below zero
    expect(numberProblem('')).toBeUndefined();
    expect(numberProblem('  ')).toBeUndefined();
  });

  it('refuses what is not a number', () => {
    for (const text of ['abc', '1.2.3', '1,000.5', '5.', '2e3']) expect(numberProblem(text)).toBe(NUMBER_INVALID);
  });

  it('finds every number field and cell that is not a number', () => {
    const qty = inventory.rowGroups[0].columns.find((c) => c.label === 'Qty')!;
    const group = inventory.rowGroups[0].id;
    let values = setCell(EMPTY, inventory.rowGroups[0], 3, qty.id, 'seven');
    values = setCell(values, inventory.rowGroups[0], 4, qty.id, '7');
    values = setCell(values, inventory.rowGroups[0], 5, 'Demo inventory!g1.C', 'abc'); // a text column is not checked
    expect(fillProblems(inventory, values)).toEqual({ [`${group}#3#${qty.id}`]: NUMBER_INVALID });
    const numberField: FieldDef = { ...toolbox.fields[1], kind: 'number' };
    const schema: FormSchema = { ...toolbox, fields: [numberField] };
    expect(fillProblems(schema, setField(EMPTY, numberField.id, '1..2'))).toEqual({ [numberField.id]: NUMBER_INVALID });
  });
});

describe('rows', () => {
  const participants = toolbox.rowGroups[0];
  const items = inventory.rowGroups[0];

  it('lists the rows entered in a plain table, and every row of a table that names its rows', () => {
    expect(isFixedRows(participants)).toBe(false);
    expect(rowCount(participants, [])).toBe(0);
    expect(rowCount(participants, [{}, {}])).toBe(2);
    expect(isFixedRows(items)).toBe(true);
    expect(rowCount(items, [])).toBe(120);
    expect(rowTitle(items, 119)).toBe('Item 120');
    expect(rowTitle(participants, 0)).toBe('Row 1');
    expect(rowCount(dayGrid.rowGroups[0], [])).toBe(31);
    expect(rowCount(conditions.rowGroups[0], [])).toBe(100);
  });

  it('offers Add row while there is room or the table can grow, never in an Excel table', () => {
    expect(canAddRow(participants, 'docx', 0)).toBe(true);
    expect(canAddRow(participants, 'docx', 12)).toBe(true); // growable
    expect(canAddRow({ ...participants, growable: false }, 'docx', 11)).toBe(true);
    expect(canAddRow({ ...participants, growable: false }, 'docx', 12)).toBe(false);
    expect(canAddRow(items, 'xlsx', 0)).toBe(false); // it names its rows
    const plainExcel = { ...items, rowLabels: undefined, growable: true };
    expect(canAddRow(plainExcel, 'xlsx', 3)).toBe(true);
    expect(canAddRow(plainExcel, 'xlsx', 120)).toBe(false);
  });

  it('adds, fills and removes rows without changing the values it is given', () => {
    const one = addRow(EMPTY, participants.id);
    expect(one.rows[participants.id]).toEqual([{}]);
    const two = setCell(addRow(one, participants.id), participants, 1, 'g1.c1', 'Ann Lee');
    expect(two.rows[participants.id]).toEqual([{}, { 'g1.c1': 'Ann Lee' }]);
    expect(one.rows[participants.id]).toEqual([{}]);
    expect(removeRow(two, participants.id, 0).rows[participants.id]).toEqual([{ 'g1.c1': 'Ann Lee' }]);
    // A row far down a named table is reached with the rows above it left empty.
    const last = setCell(EMPTY, items, 119, 'Demo inventory!g1.E', '4');
    expect(last.rows[items.id]).toHaveLength(120);
    expect(last.rows[items.id][119]).toEqual({ 'Demo inventory!g1.E': '4' });
  });

  it('leaves trailing empty rows and signature columns out of the file', () => {
    let values = addRow(addRow(addRow(EMPTY, participants.id), participants.id), participants.id);
    values = setCell(values, participants, 1, 'g1.c1', 'Ann Lee');
    values = setCell(values, participants, 1, 'g1.c3', 'signed?');
    expect(fileValues(toolbox, values, NO_AUTO).rows).toEqual({ [participants.id]: [{}, { 'g1.c1': 'Ann Lee' }] });
  });
});

describe('controls', () => {
  const text = (label: string): FieldDef => ({ ...toolbox.fields[1], label });

  it('gives Remarks, Description and Comments several lines', () => {
    expect(isLongText(text('Remarks'))).toBe(true);
    expect(isLongText(text('Job description'))).toBe(true);
    expect(isLongText(text('Comments by the Master'))).toBe(true);
    expect(isLongText(text('Subject'))).toBe(false);
    expect(isLongText({ ...text('Remarks'), kind: 'number' })).toBe(false);
  });

  it('shows up to four options as buttons, more as a list', () => {
    expect(choiceControl({ ...text('Status'), kind: 'choice', options: ['Yes', 'No', 'N/A'] })).toBe('buttons');
    expect(choiceControl({ ...text('Status'), kind: 'choice', options: ['A', 'B', 'C', 'D'] })).toBe('buttons');
    expect(choiceControl({ ...text('Status'), kind: 'choice', options: ['A', 'B', 'C', 'D', 'E'] })).toBe('select');
  });

  it('heads the screen with the code and title', () => {
    expect(fillHeading({ code: 'TST-01', title: 'Toolbox Talk' })).toBe('TST-01 Toolbox Talk');
    expect(fillHeading({ code: '', title: 'Garbage log' })).toBe('Garbage log');
  });
});

describe('writeErrorText', () => {
  it('names the field by its label, never by its id, in plain words', () => {
    expect(writeErrorText('"Maybe" is not an option of the field f1 (Check 1.1).', permit))
      .toBe('"Check 1.1" can\'t be written into this form: the value isn\'t one of the form\'s options.');
    expect(writeErrorText('The column g1.c2 (O2 [Vol.%]) is not where it was in row 3 of the table g1.', permit))
      .toBe('"O2 [Vol.%]" can\'t be written into this form: the file no longer matches this form\'s setup. Import the form again.');
    expect(writeErrorText('The table g2 (Personnel) holds 8 rows, not 9.', { ...permit, rowGroups: permit.rowGroups.map((g) => ({ ...g, growable: false })) }))
      .toBe('"Personnel" can\'t be written into this form: the table has room for 8 rows only.');
    expect(writeErrorText('The field Demo inventory!E6 (Date) is a formula cell, which is never written.', inventory))
      .toBe('"Date" can\'t be written into this form: that cell holds a formula.');
  });

  it('still says something useful when no field is named', () => {
    expect(writeErrorText('The form has no part word/document.xml.', toolbox))
      .toBe('A value can\'t be written into this form: the file no longer matches this form\'s setup. Import the form again.');
  });
});

describe('rolloverFor', () => {
  const engine = { draftPeriod, isJobLogGroup, rolloverJobs };
  const setup = { ...defaultSetup(weekly), notFinished: 'Pending' };
  const jobs: DraftValues = {
    fields: { f1: 'MV OCEAN STAR' },
    rows: {
      g1: [
        { 'g1.c1': '2026-10-26', 'g1.c3': 'Paint hatch', 'g1.c4': 'Pending' },
        { 'g1.c1': '2026-10-27', 'g1.c3': 'Grease winch', 'g1.c4': 'Completed' },
      ],
      g2: [{ 'g2.c2': 'Before' }],
    },
  };

  it('starts next week\'s draft with the jobs that are not finished', () => {
    expect(rolloverFor(weekly, setup, jobs, '2026-W44', '2026-10-28', engine)).toEqual({
      period: '2026-W45',
      values: { fields: {}, rows: { g1: [{ 'g1.c1': '2026-10-26', 'g1.c3': 'Paint hatch', 'g1.c4': 'Pending' }] } },
    });
  });

  it('starts this week\'s draft when the file of an earlier week is made late', () => {
    expect(rolloverFor(weekly, setup, jobs, '2026-W43', '2026-10-28', engine)?.period).toBe('2026-W44');
  });

  it('starts nothing when every job is finished or the job log is off', () => {
    const done: DraftValues = { ...jobs, rows: { g1: [jobs.rows.g1[1]] } };
    expect(rolloverFor(weekly, setup, done, '2026-W44', '2026-10-28', engine)).toBeUndefined();
    const off = { ...setup, helpers: { ...setup.helpers, jobLog: [] } };
    expect(rolloverFor(weekly, off, jobs, '2026-W44', '2026-10-28', engine)).toBeUndefined();
  });
});

describe('makeAndHandOver', () => {
  const bytes = toolboxTalkDocx();
  const values: DraftValues = { fields: { f1: 'MV OCEAN STAR', f2: 'Fire drill' }, rows: { g1: [{ 'g1.c1': 'Ann Lee' }] } };
  const isIntegrityError = (err: unknown): err is Error => err instanceof IntegrityError;
  const isWriteError = (err: unknown): err is Error => err instanceof FormWriteError;
  const make = (v: DraftValues) => makeFile({ kind: 'docx', fileName: 'toolbox.docx', bytes, schema: toolbox, values: v, photos: {}, date: '2026-10-25' });

  function steps(result: 'shared' | 'downloaded' | 'cancelled', overrides: Partial<Parameters<typeof makeAndHandOver>[2]> = {}) {
    const shared: { name: string; data: Blob }[] = [];
    const closed: DraftValues[] = [];
    return {
      shared, closed,
      steps: {
        make, isIntegrityError, isWriteError,
        share: async (name: string, data: Blob) => {
          shared.push({ name, data });
          return result;
        },
        close: async (v: DraftValues) => {
          closed.push(v);
        },
        ...overrides,
      },
    };
  }

  it('hands the checked file over with its type, then closes the draft with the values written', async () => {
    for (const result of ['shared', 'downloaded'] as const) {
      const run = steps(result);
      expect(await makeAndHandOver(toolbox, values, run.steps)).toEqual({ kind: 'made', fileName: 'TST-01 Toolbox Talk 2026-10-25.docx' });
      expect(run.shared).toHaveLength(1);
      expect(run.shared[0].data.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      const back = readWordValues(readPackage(new Uint8Array(await run.shared[0].data.arrayBuffer())), toolbox);
      expect(back.fields.f2).toBe('Fire drill');
      expect(run.closed).toEqual([values]);
    }
  });

  it('keeps the draft open when the share is cancelled', async () => {
    const run = steps('cancelled');
    expect(await makeAndHandOver(toolbox, values, run.steps)).toEqual({ kind: 'cancelled' });
    expect(run.closed).toEqual([]);
  });

  it('shows the integrity message and hands nothing over when the made file fails its check', async () => {
    const run = steps('shared', { make: () => { throw new IntegrityError('word/document.xml changed'); } });
    expect(await makeAndHandOver(toolbox, values, run.steps)).toEqual({ kind: 'problem', message: INTEGRITY_MESSAGE });
    expect(run.shared).toEqual([]);
    expect(run.closed).toEqual([]);
  });

  it('says in plain words which field cannot be written, and hands nothing over', async () => {
    const run = steps('shared');
    const outcome = await makeAndHandOver(permit, { fields: { f1: 'Maybe' }, rows: {} }, {
      ...run.steps,
      make: (v) => makeFile({ kind: 'docx', fileName: 'permit.docx', bytes: permitDocx(), schema: permit, values: v, photos: {}, date: '2026-10-25' }),
    });
    expect(outcome).toEqual({ kind: 'problem', message: '"Check 1.1" can\'t be written into this form: the value isn\'t one of the form\'s options.' });
    expect(JSON.stringify(outcome)).not.toContain('f1');
    expect(run.shared).toEqual([]);
    expect(run.closed).toEqual([]);
  });

  it('lets any other failure through, with nothing closed', async () => {
    const run = steps('shared', { close: async () => { throw new Error('The disk is full.'); } });
    await expect(makeAndHandOver(toolbox, values, run.steps)).rejects.toThrow('The disk is full.');
    const broken = steps('shared', { make: () => { throw new TypeError('boom'); } });
    await expect(makeAndHandOver(toolbox, values, broken.steps)).rejects.toThrow('boom');
    expect(broken.shared).toEqual([]);
  });
});

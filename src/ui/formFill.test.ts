import { describe, expect, it } from 'vitest';
import { importForm, makeFile } from '../forms/engine';
import { FormWriteError, INTEGRITY_MESSAGE, IntegrityError } from '../forms/errors';
import { readPackage } from '../forms/package';
import { readWordValues } from '../forms/word/read';
import type { FieldContext } from '../domain/fieldDictionary';
import type { ClockChange, CrewMember, ShipProfile } from '../domain/types';
import { autoValues } from '../forms/autofill';
import { defaultSetup, draftPeriod, isJobLogGroup, rolloverJobs } from '../forms/helpers';
import { conditionListXlsx, dayGridXlsx, inventoryXlsx, matrixXlsx } from '../forms/testing/excelFixtures';
import { mergedRowsDocx, permitDocx, toolboxTalkDocx, weeklyJobsDotx } from '../forms/testing/wordFixtures';
import type { DraftValues, FieldDef, FormSchema } from '../forms/types';
import {
  addRow, autoAt, canAddRow, choiceControl, editField, fileValues, fillHeading, fillProblems, fillSections, fixedState,
  isAuto, isFixed, isFixedRows, isLongText, makeAndHandOver, NUMBER_INVALID, numberProblem, removeRow, rolloverFor, rowCount, rowTitle,
  rowColumns, setCell, setField, shipDateAt, shownValue, visibleColumns, withAutoValues, writeErrorText,
} from './formFill';

const schemaOf = (name: string, bytes: Uint8Array): FormSchema => importForm(name, bytes).schema;
const toolbox = schemaOf('toolbox.docx', toolboxTalkDocx());
const permit = schemaOf('permit.docx', permitDocx());
const weekly = schemaOf('weekly.dotx', weeklyJobsDotx());
const inventory = schemaOf('inventory.xlsx', inventoryXlsx());
const dayGrid = schemaOf('daygrid.xlsx', dayGridXlsx());
const conditions = schemaOf('conditions.xlsx', conditionListXlsx());

const EMPTY: DraftValues = { fields: {}, rows: {} };
/** What the items of a section are, as `f1` for a field and `[g1]` for a row group. */
const itemsOf = (s: ReturnType<typeof fillSections>[number]) =>
  s.items.map((i) => (i.kind === 'field' ? i.field.id : i.kind === 'group' ? `[${i.group.id}]` : `{${i.title}: ${i.fields.length}}`));

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

describe('fillSections: matrix blocks (R14) and pictures', () => {
  it('shows the fields of a matrix under one heading, where its first field is', () => {
    const sections = fillSections(schemaOf('matrix.xlsx', matrixXlsx()));
    expect(sections.map(itemsOf)).toEqual([['{Table 1: 81}', 'Demo matrix!B17', 'Demo matrix!B18']]);
    const [block] = sections[0].items;
    expect(block.kind === 'block' && block.fields[0].label).toBe('Equipment 1 · Kind'); // in the order of the sheet
  });

  it('keeps a table whose only columns are pictures, and a picture field of its own', () => {
    const pictures = weekly.rowGroups.find((g) => g.id === 'g2')!;
    const only: FormSchema = { ...weekly, rowGroups: [{ ...pictures, columns: pictures.columns.filter((c) => c.kind === 'picture') }] };
    expect(fillSections(only).flatMap(itemsOf)).toContain('[g2]');
    const photo: FieldDef = { ...weekly.fields[0], id: 'fp', kind: 'picture', label: 'Photo of the damage', loc: weekly.fields[0].loc };
    expect(fillSections({ ...weekly, fields: [...weekly.fields, photo] }).flatMap(itemsOf)).toContain('fp');
  });
});

describe('auto values and edits', () => {
  const auto = { values: { f1: 'MV OCEAN STAR', f3: '2026-10-25' }, missing: { f2: 'No Master onboard' } };

  it('shows a draft not stored yet with the auto values of now, marked Auto', () => {
    const state = fixedState(undefined, auto);
    expect(state).toEqual({ values: { fields: { f1: 'MV OCEAN STAR', f3: '2026-10-25' }, rows: {} }, autoIds: ['f1', 'f3'] });
    expect(shownValue(state.values, 'f1')).toBe('MV OCEAN STAR');
    expect(isAuto(state, 'f1')).toBe(true);
    expect(shownValue(state.values, 'f2')).toBeNull();
    expect(isAuto(state, 'f2')).toBe(false);
  });

  it('takes an edited field out of the auto ids, whatever the edit, without changing what it was given', () => {
    const state = fixedState(undefined, auto);
    const edited = editField(state, 'f1', 'MV SEA BREEZE');
    expect(state.autoIds).toEqual(['f1', 'f3']);
    expect(edited).toEqual({ values: { fields: { f1: 'MV SEA BREEZE', f3: '2026-10-25' }, rows: {} }, autoIds: ['f3'] });
    const cleared = editField(edited, 'f3', '');
    expect(shownValue(cleared.values, 'f3')).toBe('');
    expect(isAuto(cleared, 'f3')).toBe(false);
  });

  it('shows a fixed draft as it is stored: later auto values change nothing, and only its auto ids are marked', () => {
    const stored = { values: { fields: { f1: 'MV SEA BREEZE', f3: '2026-10-25' }, rows: {} }, autoIds: ['f3'] };
    const later = { values: { f1: 'MV RENAMED', f3: '2026-11-02', f4: '10:00' }, missing: {} };
    expect(isFixed(stored)).toBe(true);
    expect(fixedState(stored, later)).toEqual(stored);
  });

  it('fixes a stored draft that has none fixed yet over the values it holds (a carried-over job log)', () => {
    const rolled: { values: DraftValues; autoIds?: string[] } = { values: { fields: { f1: 'kept' }, rows: { g1: [{ 'g1.c3': 'Paint hatch' }] } } };
    expect(isFixed(rolled)).toBe(false);
    expect(withAutoValues(auto, rolled.values)).toEqual({
      values: { fields: { f1: 'kept', f3: '2026-10-25' }, rows: { g1: [{ 'g1.c3': 'Paint hatch' }] } }, autoIds: ['f3'],
    });
    expect(fixedState(rolled, auto)).toEqual(withAutoValues(auto, rolled.values));
  });

  it('writes the values as they are into the file, but never a field that is left empty or not in the form', () => {
    const values = setField(setField(fixedState(undefined, auto).values, 'f2', 'Fire drill'), 'f3', '2026-10-20');
    expect(fileValues(toolbox, values)).toEqual({ fields: { f1: 'MV OCEAN STAR', f2: 'Fire drill', f3: '2026-10-20' }, rows: {} });
    const odd: DraftValues = { fields: { f2: 'x', gone: 'y' }, rows: {} };
    const leftEmpty: FormSchema = { ...toolbox, fields: toolbox.fields.map((f) => (f.id === 'f2' ? { ...f, leftEmpty: true } : f)) };
    expect(fileValues(leftEmpty, odd).fields).toEqual({});
  });
});

describe('a draft reopened on a later day keeps the auto values of the moment it started (R18)', () => {
  const base = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'd', deleted: false, scope: 'ship' as const, shipId: 's1' };
  const ship = { ...base, id: 's1', particulars: { name: 'MV OCEAN STAR' } } as unknown as ShipProfile;
  const person = (id: string, over: Partial<CrewMember>): CrewMember => ({
    ...base, id, surname: 'X', givenNames: 'Y', rank: 'master', nationality: 'Croatian', dateOfBirth: '1980-03-14', placeOfBirth: 'Split',
    passportNo: 'P1', passportExpiry: '2030-01-01', seamansBookNo: 'SB1', seamansBookExpiry: '2030-01-01', signOnDate: '2026-09-01',
    signOnPort: 'Rijeka', ...over,
  });
  // The master is relieved on the 1st of November: on the day the draft is reopened another master is onboard.
  const crew = [
    person('m1', { surname: 'Horvat', givenNames: 'Luka', signOffDate: '2026-11-01' }),
    person('m2', { surname: 'Babić', givenNames: 'Ivo', signOnDate: '2026-11-01' }),
    person('c1', { rank: 'chiefOfficer', surname: 'Kovač', givenNames: 'Ana' }),
  ];
  const plus3: ClockChange = { ...base, id: 'cc', effectiveAt: '2026-01-01T00:00:00.000Z', toOffsetMinutes: 180 };
  const ctx: FieldContext = { ship, crew, voyages: [], certificates: [], crewDocuments: [], clockChanges: [plus3], nowUtc: new Date(0) };
  const STARTED = new Date('2026-10-28T05:00:00Z'); // Wednesday 28 October, 08:00 on the ship, ISO week 44
  const REOPENED = new Date('2026-11-02T07:30:00Z'); // Monday 2 November, 10:30, week 45

  /** Opens the form at `STARTED`, makes the first change, stores the draft; then reopens it at `REOPENED`. */
  function startAndReopen(schema: FormSchema, edit: [string, string]) {
    const setup = defaultSetup(schema);
    const first = autoAt(autoValues, schema, setup, ctx, STARTED);
    const state = editField(fixedState(undefined, first.auto), ...edit);
    const stored = { values: state.values, autoIds: state.autoIds, period: draftPeriod(setup, first.shipDate) };
    const later = autoAt(autoValues, schema, setup, ctx, REOPENED);
    return { first, stored, later, reopened: fixedState(stored, later.auto) };
  }

  it('a day-period form keeps its Date and Time', () => {
    const { stored, later, reopened } = startAndReopen(toolbox, ['f2', 'Fire drill']);
    expect(stored.period).toBe('2026-10-28');
    expect(later.auto.values).toMatchObject({ f3: '2026-11-02', f4: '10:30' }); // what it would say now
    expect(reopened.values.fields).toEqual({ f1: 'MV OCEAN STAR', f2: 'Fire drill', f3: '2026-10-28', f4: '08:00' });
    expect(reopened.autoIds).toEqual(['f1', 'f3', 'f4']);
  });

  it('a weekly job log keeps its week and its dates', () => {
    const { stored, later, reopened } = startAndReopen(weekly, ['f1', 'MV OCEAN STAR']);
    expect(stored.period).toBe('2026-W44');
    expect(later.auto.values.f2).not.toBe(reopened.values.fields.f2);
    expect(reopened.values.fields.f2).toMatch(/44/);
    expect(reopened.values.fields.f2).not.toMatch(/45/);
    expect(reopened.values.fields).toEqual(stored.values.fields);
  });

  it('a month grid keeps its month period and its date, and a Month field keeps its month', () => {
    const grid = startAndReopen(dayGrid, ['Demo day grid!B6', 'MV OCEAN STAR']);
    expect(grid.stored.period).toBe('2026-10');
    expect(grid.reopened.values.fields['Demo day grid!B42']).toBe('2026-10-28');
    const month = startAndReopen(conditions, ['Demo conditions!B6', 'MV OCEAN STAR']);
    expect(month.later.auto.values['Demo conditions!D6']).not.toBe(month.reopened.values.fields['Demo conditions!D6']);
    expect(month.reopened.values.fields).toEqual(month.stored.values.fields);
    expect(String(month.reopened.values.fields['Demo conditions!D6'])).toMatch(/oct/i);
  });

  it('keeps the crew who were onboard when it started', () => {
    const matrix = schemaOf('matrix.xlsx', matrixXlsx());
    const { later, reopened } = startAndReopen(matrix, ['Demo matrix!B7', 'Pump']);
    expect(later.auto.values['Demo matrix!B17']).toBe('Ivo Babić');
    expect(reopened.values.fields['Demo matrix!B17']).toBe('Luka Horvat');
    expect(reopened.values.fields['Demo matrix!B18']).toBe('Ana Kovač');
  });

  it('works out the ship\'s date from its clock', () => {
    expect(shipDateAt([plus3], new Date('2026-10-28T22:30:00Z'))).toBe('2026-10-29'); // 01:30 on the ship
    expect(shipDateAt([], new Date('2026-10-28T22:30:00Z'))).toBe('2026-10-28');
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
  it('asks in each row only for the cells Word shows: not one that continues a vertical merge (R22)', () => {
    const [group] = importForm('m.docx', mergedRowsDocx()).schema.rowGroups;
    expect(rowColumns(group, 0).map((c) => c.label)).toEqual(['Shift', 'Demo task', 'Hours']);
    expect(rowColumns(group, 2).map((c) => c.label)).toEqual(['Demo task', 'Hours']);
    // A row added past the template's own copies its last row, and its cells.
    expect(rowColumns(group, 7).map((c) => c.label)).toEqual(['Demo task', 'Hours']);
  });

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
    expect(fileValues(toolbox, values).rows).toEqual({ [participants.id]: [{}, { 'g1.c1': 'Ann Lee' }] });
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
  it('names the field by its label, never by its id, in plain words, from the code the writer gives', () => {
    expect(writeErrorText({ code: 'notAnOption', fieldId: 'f1' }, permit))
      .toBe('"Check 1.1" can\'t be written into this form: the value isn\'t one of the form\'s options.');
    expect(writeErrorText({ code: 'notInFile', fieldId: 'g1.c2' }, permit))
      .toBe('"O2 [Vol.%]" can\'t be written into this form: the file no longer matches this form\'s setup. Import the form again.');
    expect(writeErrorText({ code: 'tooManyRows', fieldId: 'g2' }, permit))
      .toBe('"Personnel" can\'t be written into this form: the table has room for 8 rows only.');
    expect(writeErrorText({ code: 'formula', fieldId: 'Demo inventory!E6' }, inventory))
      .toBe('"Date" can\'t be written into this form: that cell holds a formula.');
    expect(writeErrorText({ code: 'photo', fieldId: 'g2.c1' }, weekly)).toBe('"Picture" can\'t be written into this form: its photo is missing or damaged.');
    expect(writeErrorText({ code: 'wrongKind', fieldId: 'f8' }, permit))
      .toBe('"Checks completed" can\'t be written into this form: the value isn\'t the kind this field takes.');
  });

  it('still says something useful when no field is named, or the field is not in the form', () => {
    expect(writeErrorText({ code: 'notInFile' }, toolbox))
      .toBe('A value can\'t be written into this form: the file no longer matches this form\'s setup. Import the form again.');
    expect(writeErrorText({ code: 'tooManyRows', fieldId: 'gone' }, toolbox))
      .toBe('A value can\'t be written into this form: the table has no room for more rows.');
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
  const isIntegrityError = (err: unknown): err is IntegrityError => err instanceof IntegrityError;
  const isWriteError = (err: unknown): err is FormWriteError => err instanceof FormWriteError;
  const make = (v: DraftValues) => makeFile({ kind: 'docx', fileName: 'toolbox.docx', bytes, schema: toolbox, values: v, photos: {}, date: '2026-10-25' });

  function steps(result: 'shared' | 'downloaded' | 'cancelled', overrides: Partial<Parameters<typeof makeAndHandOver>[2]> = {}) {
    const shared: { name: string; data: Blob }[] = [];
    const closed: DraftValues[] = [];
    const logged: string[] = [];
    return {
      shared, closed, logged,
      steps: {
        make, isIntegrityError, isWriteError, logIntegrity: (reason: string) => logged.push(reason),
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
    expect(run.logged).toEqual(['word/document.xml changed']); // kept for diagnostics, never in what is shown
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

  it('says the file was made when the draft cannot be closed after it was handed over, so it is not made twice', async () => {
    const full = new Error('The disk is full.');
    const run = steps('downloaded', { close: async () => { throw full; } });
    expect(await makeAndHandOver(toolbox, values, run.steps))
      .toEqual({ kind: 'madeNotClosed', fileName: 'TST-01 Toolbox Talk 2026-10-25.docx', error: full });
    expect(run.shared).toHaveLength(1);
  });

  it('lets any other failure through, with nothing handed over', async () => {
    const broken = steps('shared', { make: () => { throw new TypeError('boom'); } });
    await expect(makeAndHandOver(toolbox, values, broken.steps)).rejects.toThrow('boom');
    expect(broken.shared).toEqual([]);
  });
});

describe('fixedState with values from the last file (R18)', () => {
  const auto = { values: { f3: '2026-10-28' }, missing: {} };
  const start = (held: DraftValues): DraftValues => ({ fields: held.fields, rows: { g1: [{ c: '5' }] } });

  it('puts them in with the auto values, in one state', () => {
    const state = fixedState(undefined, auto, start);
    expect(state.values).toEqual({ fields: { f3: '2026-10-28' }, rows: { g1: [{ c: '5' }] } });
    expect(state.autoIds).toEqual(['f3']);
  });

  it('shows a fixed draft as it is stored, with none of them', () => {
    const stored = { values: { fields: { f3: '2026-10-20' }, rows: {} }, autoIds: [] };
    expect(fixedState(stored, auto, start)).toEqual({ values: stored.values, autoIds: [] });
  });

  it('works the auto values out for the date it is given (R19)', () => {
    const seen: string[] = [];
    const spy = (_s: FormSchema, _l: object, _c: FieldContext, date: string) => (seen.push(date), { values: {}, missing: {} });
    const ctx = { clockChanges: [] as ClockChange[] } as FieldContext;
    const setup = defaultSetup(toolbox);
    expect(autoAt(spy, toolbox, setup, ctx, new Date('2026-10-28T10:00:00Z')).shipDate).toBe('2026-10-28');
    autoAt(spy, toolbox, setup, ctx, new Date('2026-10-28T10:00:00Z'), '2026-11-02');
    expect(seen).toEqual(['2026-10-28', '2026-11-02']);
  });
});

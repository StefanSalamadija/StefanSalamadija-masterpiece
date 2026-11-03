import { describe, expect, it } from 'vitest';
import { detectExcel } from './excel/detect';
import { defaultSetup } from './helpers';
import { readPackage } from './package';
import { mapRevision, migrateSetup, migrateValues } from './revision';
import { matrixXlsx } from './testing/excelFixtures';
import { oddLayoutsDocx, toolboxTalkDocx, weeklyJobsDotx } from './testing/wordFixtures';
import { detectWord } from './word/detect';
import type { DraftValues, FieldDef, FormSchema, FormSetup, RowGroupDef } from './types';

// Invented forms only (the Task 2 fixtures and hand-made schemas): no company form, code or wording is used here.

const toolbox = detectWord(readPackage(toolboxTalkDocx()), 'docx', 'toolbox.docx');
/** R6: the next revision renames `Subject` to `Topic` and adds a `Location` field after it. */
const toolboxRev01 = detectWord(
  readPackage(toolboxTalkDocx({ revision: '01 / 01.06.2026', renameSubjectTo: 'Topic', extraFieldLabel: 'Location' })), 'docx', 'toolbox.docx',
);
const weekly = detectWord(readPackage(weeklyJobsDotx()), 'dotx', 'weekly.dotx');
const odd = detectWord(readPackage(oddLayoutsDocx()), 'docx', 'odd.docx');
const matrix = detectExcel(readPackage(matrixXlsx()), 'matrix.xlsx');

const field = (id: string, over: Partial<FieldDef> = {}): FieldDef => ({
  id, kind: 'text', label: id, section: '', loc: id, confidence: 'high', ...over,
});
const group = (id: string, columns: FieldDef[], over: Partial<RowGroupDef> = {}): RowGroupDef => ({
  id, label: id, section: '', loc: id, columns, capacity: 5, growable: false, shape: 'rows', ...over,
});
const schemaOf = (fields: FieldDef[], rowGroups: RowGroupDef[] = []): FormSchema => ({
  kind: 'docx', identity: { code: 'TST-99', title: 'Demo', revision: '00' }, fields, rowGroups, unsupported: [],
});
const values = (fields: DraftValues['fields'], rows: DraftValues['rows'] = {}): DraftValues => ({ fields, rows });
const noHelpers = (): FormSetup['helpers'] => ({ pickCrew: [], allOk: [], todayRow: [], startFromLast: [], jobLog: [], thresholds: [], now: [] });

/** No two old ids lead to one new id. */
function expectOneToOne(map: Record<string, string>): void {
  const targets = Object.values(map);
  expect(new Set(targets).size).toBe(targets.length);
}

describe('mapRevision', () => {
  it('maps the next toolbox revision: a field renamed and one added, everything else kept', () => {
    const { map, unmatched } = mapRevision(toolbox, toolboxRev01);
    expect(toolboxRev01.fields.map((f) => f.label)).toEqual(['Vessel', 'Topic', 'Location', 'Date', 'Time']);
    expect(map).toEqual({
      f1: 'f1', // Vessel
      f2: 'f2', // Subject -> Topic, by its place between Vessel and Date
      f3: 'f4', // Date
      f4: 'f5', // Time
      g1: 'g1', 'g1.c1': 'g1.c1', 'g1.c2': 'g1.c2', 'g1.c3': 'g1.c3',
    });
    expect(unmatched).toEqual(['Location']);
  });

  it('lists the old fields that are gone', () => {
    const { removed, unmatched } = mapRevision(toolboxRev01, toolbox);
    expect(removed).toEqual(['Location']);
    expect(unmatched).toEqual([]);
  });

  it('matches labels however they are written (normaliseLabel)', () => {
    const { map, unmatched } = mapRevision(
      schemaOf([field('a', { label: 'I.M.O. No.' }), field('b', { label: 'Time (24:00 UTC)' })]),
      schemaOf([field('x', { label: 'Time  24:00 UTC' }), field('y', { label: 'i m o no:' })]),
    );
    expect(map).toEqual({ a: 'y', b: 'x' });
    expect(unmatched).toEqual([]);
  });

  it('never matches a label of a different kind', () => {
    const { map, unmatched, removed } = mapRevision(
      schemaOf([field('a', { label: 'Date', kind: 'text' })]),
      schemaOf([field('x', { label: 'Date', kind: 'date' })]),
    );
    expect(map).toEqual({});
    expect(unmatched).toEqual(['Date']);
    expect(removed).toEqual(['Date']);
  });

  it('matches a label only within its section', () => {
    const { map } = mapRevision(
      schemaOf([field('a', { label: 'Remarks', section: 'Deck' }), field('b', { label: 'Remarks', section: 'Engine' })]),
      schemaOf([field('x', { label: 'Remarks', section: 'Engine' }), field('y', { label: 'Remarks', section: 'Deck' })]),
    );
    expect(map).toEqual({ a: 'y', b: 'x' });
  });

  it('pairs by position only between the same matched neighbours, so a removed field never fills an added one', () => {
    // `Old note` is removed at the top and `New note` added at the bottom: they are not the same field.
    const { map, unmatched, removed } = mapRevision(
      schemaOf([field('a', { label: 'Old note' }), field('b', { label: 'Vessel' }), field('c', { label: 'Port' })]),
      schemaOf([field('x', { label: 'Vessel' }), field('y', { label: 'Port' }), field('z', { label: 'New note' })]),
    );
    expect(map).toEqual({ b: 'x', c: 'y' });
    expect(unmatched).toEqual(['New note']);
    expect(removed).toEqual(['Old note']);
  });

  it('pairs by position only fields of the same kind, in order', () => {
    const { map } = mapRevision(
      schemaOf([field('v', { label: 'Vessel' }), field('a', { label: 'Old text' }), field('b', { label: 'Old date', kind: 'date' })]),
      schemaOf([field('w', { label: 'Vessel' }), field('x', { label: 'New date', kind: 'date' }), field('y', { label: 'New text' })]),
    );
    expect(map).toEqual({ v: 'w', a: 'y', b: 'x' });
  });

  it('pairs repeated labels in document order and never maps two old fields to one new field', () => {
    // odd layouts: `Contact` twice. The next revision has it three times.
    const contacts = odd.fields.filter((f) => f.label === 'Contact');
    expect(contacts).toHaveLength(2);
    const third = { ...contacts[1]!, id: 'f99', loc: 'x' };
    const next: FormSchema = { ...odd, fields: [...odd.fields.slice(0, 3), third, ...odd.fields.slice(3)] };
    const { map, unmatched } = mapRevision(odd, next);
    expect(map[contacts[0]!.id]).toBe(contacts[0]!.id);
    expect(map[contacts[1]!.id]).toBe(contacts[1]!.id);
    expect(unmatched).toEqual(['Contact']);
    expectOneToOne(map);
  });

  it('pairs a group\'s repeated column labels in order (weekly pictures: Picture ×3, Photo ×3), one to one', () => {
    const pictures = weekly.rowGroups.find((g) => g.label === 'Pictures')!;
    // The next revision has room for two pictures, not three.
    const next: FormSchema = {
      ...weekly, rowGroups: weekly.rowGroups.map((g) => (g === pictures ? { ...g, columns: g.columns.slice(0, 4) } : g)),
    };
    const { map, removed } = mapRevision(weekly, next);
    for (const c of pictures.columns.slice(0, 4)) expect(map[c.id]).toBe(c.id);
    expect(map[pictures.columns[4]!.id]).toBeUndefined();
    expect(map[pictures.columns[5]!.id]).toBeUndefined();
    expect(removed).toEqual(['Pictures · Picture', 'Pictures · Photo']);
    expectOneToOne(map);
  });

  it('never matches the placeholder label of an unlabelled field by its text', () => {
    // `Field <n>` is numbered by position: in the next revision `Field 4` is another field.
    const { map } = mapRevision(
      schemaOf([
        field('f1', { label: 'Field 1', confidence: 'low' }), field('f2', { label: 'Port' }), field('f3', { label: 'Berth' }),
        field('f4', { label: 'Field 4', confidence: 'low' }),
      ]),
      schemaOf([
        field('f1', { label: 'Port' }), field('f2', { label: 'Berth' }), field('f3', { label: 'Field 3', confidence: 'low' }),
        field('f4', { label: 'Field 4', confidence: 'low' }),
      ]),
    );
    expect(map).toEqual({ f2: 'f1', f3: 'f2', f4: 'f3' });
  });

  it('maps groups by label, then by place, and their columns the same way', () => {
    const { map, unmatched, removed } = mapRevision(
      schemaOf([], [
        group('g1', [field('g1.c1', { label: 'Name' }), field('g1.c2', { label: 'Rank' })], { label: 'Participants' }),
        group('g2', [field('g2.c1', { label: 'Time' }), field('g2.c2', { label: 'O2' })], { label: 'Gas' }),
      ]),
      schemaOf([], [
        group('g1', [field('g1.c1', { label: 'Name' })], { label: 'Visitors', section: 'Visitors' }),
        group('g2', [field('g2.c1', { label: 'Rank' }), field('g2.c2', { label: 'Name' })], { label: 'Participants' }),
        group('g3', [field('g3.c1', { label: 'Time' }), field('g3.c2', { label: 'O2' }), field('g3.c3', { label: 'CO' })], { label: 'Gas readings' }),
      ]),
    );
    expect(map).toEqual({
      g1: 'g2', 'g1.c1': 'g2.c2', 'g1.c2': 'g2.c1',
      g2: 'g3', 'g2.c1': 'g3.c1', 'g2.c2': 'g3.c2',
    });
    expect(unmatched).toEqual(['Visitors', 'Gas readings · CO']);
    expect(removed).toEqual([]);
  });

  it('does not pair by place across a field linked by label: a moved field leaves its neighbours unlinked', () => {
    // `Gas` was after `Participants` and `Gas readings` is before it: nothing says they are the same group.
    const { map } = mapRevision(
      schemaOf([], [group('g1', [], { label: 'Participants' }), group('g2', [], { label: 'Gas' })]),
      schemaOf([], [group('g1', [], { label: 'Gas readings' }), group('g2', [], { label: 'Participants' })]),
    );
    expect(map).toEqual({ g1: 'g2' });
  });

  it('lists a new group, and an old one that is gone, by its label', () => {
    const { map, unmatched, removed } = mapRevision(
      schemaOf([field('v', { label: 'Vessel' })], [group('g1', [field('g1.c1', { label: 'Name' })], { label: 'Participants', section: 'A' })]),
      schemaOf([field('v', { label: 'Vessel' })], [group('g1', [field('g1.c1', { label: 'Job' })], { label: 'Jobs', section: 'B' })]),
    );
    expect(map).toEqual({ v: 'v' });
    expect(unmatched).toEqual(['Jobs']);
    expect(removed).toEqual(['Participants']);
  });

  it('maps Excel matrix fields by label within the section, and the matrix id with them (R14)', () => {
    // The next revision has a row inserted above the matrix, and another matrix before it: every id moves.
    const shift = (id: string) => id.replace(/!([A-Z]+)(\d+)$/, (_, col: string, row: string) => `!${col}${Number(row) + 1}`);
    const next: FormSchema = {
      ...matrix,
      fields: [
        field('Demo matrix!B5', { label: 'Equipment 1 · Weight', kind: 'number', block: 'Demo matrix!m1' }),
        ...matrix.fields.map((f) => ({ ...f, id: shift(f.id), loc: shift(f.loc), ...(f.block ? { block: 'Demo matrix!m2' } : {}) })),
      ],
    };
    const { map, unmatched } = mapRevision(matrix, next);
    for (const f of matrix.fields) expect(map[f.id]).toBe(shift(f.id));
    expect(map['Demo matrix!m1']).toBe('Demo matrix!m2');
    expect(unmatched).toEqual(['Equipment 1 · Weight']);
    // The two `Equipment 1 · Dimensions` rows keep their order.
    expect(map['Demo matrix!B8']).toBe('Demo matrix!B9');
    expect(map['Demo matrix!B9']).toBe('Demo matrix!B10');
  });
});

describe('migrateValues', () => {
  it('moves the values to the new ids', () => {
    const { map } = mapRevision(toolbox, toolboxRev01);
    const before = values(
      { f1: 'MV OCEAN STAR', f2: 'Working aloft', f3: '2026-10-28', f4: '08:30' },
      { g1: [{ 'g1.c1': 'Ana Marin', 'g1.c2': 'Chief Officer' }, { 'g1.c1': 'Ivo Kovac', 'g1.c2': 'Pumpman' }] },
    );
    const { values: after, dropped } = migrateValues(before, map, { from: toolbox, to: toolboxRev01 });
    expect(after).toEqual(values(
      { f1: 'MV OCEAN STAR', f2: 'Working aloft', f4: '2026-10-28', f5: '08:30' },
      { g1: [{ 'g1.c1': 'Ana Marin', 'g1.c2': 'Chief Officer' }, { 'g1.c1': 'Ivo Kovac', 'g1.c2': 'Pumpman' }] },
    ));
    expect(dropped).toEqual([]);
  });

  it('never lets a moved value overwrite another when the ids shift (Excel cells)', () => {
    const map = { 'S!B7': 'S!B8', 'S!B8': 'S!B9' };
    const { values: after } = migrateValues(values({ 'S!B7': 'first', 'S!B8': 'second' }), map);
    expect(after.fields).toEqual({ 'S!B8': 'first', 'S!B9': 'second' });
  });

  it('lists every value it cannot carry over, and nothing that was empty', () => {
    const map = { a: 'x', g1: 'g1', 'g1.c1': 'g1.c1' };
    const { values: after, dropped } = migrateValues(
      values(
        { a: 'kept', b: 'gone', c: null, d: '', e: false },
        { g1: [{ 'g1.c1': 'Ana', 'g1.c2': 'lost' }], g2: [{ 'g2.c1': 'lost too', 'g2.c2': null }, {}] },
      ),
      map,
    );
    expect(after).toEqual(values({ x: 'kept' }, { g1: [{ 'g1.c1': 'Ana' }] }));
    expect(dropped).toEqual(['b', 'g1.c2[0]', 'g2.c1[0]']);
  });

  it('drops a picture whose field is gone (the photo id), and keeps one whose field is matched', () => {
    const from = schemaOf([field('p1', { label: 'Photo', kind: 'picture' }), field('p2', { label: 'Sketch', kind: 'picture' })]);
    const to = schemaOf([field('q1', { label: 'Photo', kind: 'picture' })]);
    const { map } = mapRevision(from, to);
    const { values: after, dropped } = migrateValues(values({ p1: 'photo-1', p2: 'photo-2' }), map, { from, to });
    expect(after.fields).toEqual({ q1: 'photo-1' });
    expect(dropped).toEqual(['p2']);
  });

  it('drops a choice whose option is gone, keeps one that is still offered, in the new spelling', () => {
    const jobs = (options: string[]) => group('g1', [field('g1.c1', { label: 'Job' }), field('g1.c2', { label: 'Status', kind: 'choice', options })], { growable: true });
    const from = schemaOf([field('ok', { label: 'Result', kind: 'choice', options: ['Yes', 'No', 'N/A'] })], [jobs(['Pending', 'Completed'])]);
    const to = schemaOf([field('ok', { label: 'Result', kind: 'choice', options: ['YES', 'NO'] })], [jobs(['Open', 'Completed'])]);
    const { map } = mapRevision(from, to);
    const migrate = (v: DraftValues) => migrateValues(v, map, { from, to });
    expect(migrate(values({ ok: 'Yes' })).values.fields).toEqual({ ok: 'YES' });
    expect(migrate(values({ ok: 'N/A' }))).toEqual({ values: values({}), dropped: ['ok'] });
    const rows = migrate(values({}, { g1: [{ 'g1.c1': 'Paint', 'g1.c2': 'Pending' }, { 'g1.c1': 'Grease', 'g1.c2': 'Completed' }] }));
    expect(rows.values.rows).toEqual({ g1: [{ 'g1.c1': 'Paint' }, { 'g1.c1': 'Grease', 'g1.c2': 'Completed' }] });
    expect(rows.dropped).toEqual(['g1.c2[0]']);
  });

  it('keeps a choice value that was never an option when the options did not change (a combo box)', () => {
    const s = schemaOf([field('c', { label: 'Port', kind: 'choice', options: ['Rijeka', 'Split'] })]);
    const { map } = mapRevision(s, s);
    expect(migrateValues(values({ c: 'Koper' }), map, { from: s, to: s }).values.fields).toEqual({ c: 'Koper' });
  });

  it('drops the rows beyond the capacity of a group that cannot grow, and keeps them in one that can', () => {
    const cols = [field('g1.c1', { label: 'Name' })];
    const rows = { g1: [{ 'g1.c1': 'A' }, { 'g1.c1': 'B' }, { 'g1.c1': 'C' }] };
    const from = schemaOf([], [group('g1', cols, { capacity: 3 })]);
    const fixed = schemaOf([], [group('g1', cols, { capacity: 2 })]);
    const growable = schemaOf([], [group('g1', cols, { capacity: 2, growable: true })]);
    const toFixed = migrateValues(values({}, rows), mapRevision(from, fixed).map, { from, to: fixed });
    expect(toFixed).toEqual({ values: values({}, { g1: [{ 'g1.c1': 'A' }, { 'g1.c1': 'B' }] }), dropped: ['g1.c1[2]'] });
    const toGrowable = migrateValues(values({}, rows), mapRevision(from, growable).map, { from, to: growable });
    expect(toGrowable).toEqual({ values: values({}, rows), dropped: [] });
  });

  it('follows the row labels when both revisions have them, so an item never takes another item\'s values', () => {
    const cols = [field('S!g1.C', { label: 'Qty', kind: 'number' })];
    const from = schemaOf([], [group('S!g1', cols, { capacity: 3, rowLabels: ['Rope', 'Shackle', 'Wire'] })]);
    const to = schemaOf([], [group('S!g1', cols, { capacity: 3, rowLabels: ['Rope', 'Hook', 'Wire'] })]);
    const { values: after, dropped } = migrateValues(
      values({}, { 'S!g1': [{ 'S!g1.C': '4' }, { 'S!g1.C': '6' }, { 'S!g1.C': '2' }] }), mapRevision(from, to).map, { from, to },
    );
    expect(after.rows).toEqual({ 'S!g1': [{ 'S!g1.C': '4' }, {}, { 'S!g1.C': '2' }] });
    expect(dropped).toEqual(['S!g1.C[1]']);
  });

  it('does not change the values it is given', () => {
    const before = values({ a: 'x' }, { g1: [{ 'g1.c1': 'y' }] });
    const copy = structuredClone(before);
    migrateValues(before, { a: 'b', g1: 'g2', 'g1.c1': 'g2.c1' });
    expect(before).toEqual(copy);
  });
});

describe('migrateSetup', () => {
  it('moves the links, the left-empty list and the helper ids to the new ids, and drops the ones whose field is gone', () => {
    const from = schemaOf(
      [field('v', { label: 'Vessel' }), field('t', { label: 'Time', kind: 'time' }), field('gone', { label: 'Old note' })],
      [group('g1', [field('g1.c1', { label: 'Name' }), field('g1.c2', { label: 'Signature', leftEmpty: true })], { label: 'Participants', growable: true })],
    );
    const to = schemaOf(
      [field('t2', { label: 'Time', kind: 'time' }), field('v2', { label: 'Vessel' })],
      [group('g9', [field('g9.c1', { label: 'Name' }), field('g9.c2', { label: 'Signature', leftEmpty: true })], { label: 'Participants', growable: true })],
    );
    const setup: FormSetup = {
      links: { v: { source: 'none' }, gone: { source: 'vessel.imo' }, 'g1.c1': { source: 'crew.byRank.master', part: 'name' } },
      leftEmpty: ['g1.c2', 'gone'],
      helpers: { ...noHelpers(), pickCrew: ['g1'], now: ['t', 'gone'] },
      okWord: 'Good',
      notFinished: 'Open',
    };
    const { map } = mapRevision(from, to);
    expect(migrateSetup(setup, map, to)).toEqual({
      // `v` was unlinked by hand: it stays unlinked, the suggestion is not brought back.
      links: { v2: { source: 'none' }, 'g9.c1': { source: 'crew.byRank.master', part: 'name' } },
      leftEmpty: ['g9.c2'],
      helpers: { ...noHelpers(), pickCrew: ['g9'], now: ['t2'] },
      okWord: 'Good',
      notFinished: 'Open',
    });
  });

  it('gives a new field the setup a fresh import would give it', () => {
    const { map } = mapRevision(toolbox, toolboxRev01);
    const old = defaultSetup(toolbox);
    const fresh = defaultSetup(toolboxRev01);
    const next = migrateSetup(old, map, toolboxRev01);
    // Location is new: it gets what a fresh import suggests for it (nothing here, as for a fresh import).
    expect(next).toEqual(fresh);
  });

  it('moves a matrix id in the start-from-last helper (R14)', () => {
    const from = schemaOf([field('S!B7', { label: 'Pump · Kind', block: 'S!m1' })]);
    const to = schemaOf([field('S!B8', { label: 'Pump · Kind', block: 'S!m2' })]);
    const { map } = mapRevision(from, to);
    const setup: FormSetup = { links: {}, leftEmpty: [], helpers: { ...noHelpers(), startFromLast: ['S!m1'] }, okWord: 'OK', notFinished: '' };
    expect(migrateSetup(setup, map, to).helpers.startFromLast).toEqual(['S!m2']);
  });
});

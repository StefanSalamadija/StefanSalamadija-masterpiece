import { describe, expect, it } from 'vitest';
import { alignLeftEmpty } from '../domain/formSetup';
import type { FormDraft, FormTemplate } from '../domain/types';
import { periodLabel } from '../forms/helpers';
import { readPackage } from '../forms/package';
import { suggestLinkFor } from '../forms/autofill';
import { defaultSetup } from '../forms/helpers';
import { farLabelsDocx, guessedLabelsDocx } from '../forms/testing/wordFixtures';
import type { FieldDef, FormSchema, FormSetup, HelperKey, RowGroupDef } from '../forms/types';
import { detectWord } from '../forms/word/detect';
import {
  applyChoice, choiceOf, confirmName, draftRows, foundSummary, helperSwitches, libraryRows, libraryText, matchesSearch, replacePrompt,
  replaceTarget, revisionNotice, savedSchema, setHelper, setupHeading, setupProblems, setupSections, showsNotFinished,
  templateForDraft,
} from './formsView';

const STAMP = '2026-10-01T00:00:00.000Z';

function template(id: string, code: string, title: string, revision = '00', extra: Partial<FormTemplate> = {}): FormTemplate {
  const schema: FormSchema = { kind: 'docx', identity: { code, title, revision }, fields: [], rowGroups: [], unsupported: [] };
  return {
    id, code, title, revision, kind: 'docx', fileName: `${title}.docx`, fileBase64: '', schema, setup: emptySetup(),
    createdAt: STAMP, updatedAt: STAMP, updatedBy: 'dev', deleted: false, scope: 'personal', ...extra,
  };
}

function draft(id: string, templateId: string, code: string, period: string, extra: Partial<FormDraft> = {}): FormDraft {
  return {
    id, shipId: 's1', templateId, code, period, values: { fields: {}, rows: {} }, photoIds: [],
    createdAt: STAMP, updatedAt: STAMP, updatedBy: 'dev', deleted: false, scope: 'ship', ...extra,
  };
}

const NO_HELPERS: Record<HelperKey, string[]> = { pickCrew: [], allOk: [], todayRow: [], startFromLast: [], jobLog: [], thresholds: [], now: [] };

function emptySetup(extra: Partial<FormSetup> = {}): FormSetup {
  return { links: {}, leftEmpty: [], helpers: { ...NO_HELPERS }, okWord: 'Satisfactory', notFinished: '', ...extra };
}

describe('the library', () => {
  it('lists a form as code · title · revision, leaving out what it has not got', () => {
    expect(libraryText(template('a', 'TST-01', 'Toolbox Talk', '00 / 01.01.2026'))).toBe('TST-01 · Toolbox Talk · Rev 00 / 01.01.2026');
    expect(libraryText(template('a', '', 'Garbage log', '03'))).toBe('Garbage log · Rev 03');
    expect(libraryText(template('a', 'TST-09', 'Drill', ''))).toBe('TST-09 · Drill');
  });

  it('sorts by code (numbers in order, case ignored), then title; forms without a code come last', () => {
    const rows = libraryRows([
      template('1', 'TST-10', 'B'), template('2', '', 'Alpha'), template('3', 'tst-2', 'Z'), template('4', 'TST-2', 'A'),
      template('5', '', 'Able'), template('6', 'ABC-1', 'Q'),
    ], '');
    expect(rows.map((t) => t.id)).toEqual(['6', '4', '3', '1', '5', '2']);
  });

  it('searches code, title and revision, every word, case ignored', () => {
    const t = template('a', 'TST-01', 'Toolbox Talk', '00 / 01.01.2026');
    for (const query of ['', '  ', 'tst', 'TOOLBOX', 'talk tst-01', '01.01.2026', 'box 00']) expect(matchesSearch(t, query), query).toBe(true);
    for (const query of ['permit', 'toolbox permit', 'Rev']) expect(matchesSearch(t, query), query).toBe(false);
    const rows = libraryRows([t, template('b', 'TST-02', 'Demo Permit', '01')], 'permit');
    expect(rows.map((r) => r.id)).toEqual(['b']);
  });
});

describe('the drafts in progress', () => {
  const toolbox = template('t1', 'TST-01', 'Toolbox Talk');
  const weekly = template('t3', 'TST-03', 'Demo Weekly Jobs');

  it('finds a draft its template by id, else the live one with the same code (the newest), else none', () => {
    const older = template('t1b', 'TST-01', 'Toolbox Talk (old copy)', '00', { updatedAt: '2026-09-01T00:00:00.000Z' });
    const newer = template('t1c', 'TST-01', 'Toolbox Talk (new copy)', '00', { updatedAt: '2026-10-20T00:00:00.000Z' });
    expect(templateForDraft(draft('d', 't3', 'TST-03', '2026-10-28'), [toolbox, weekly])).toBe(weekly);
    expect(templateForDraft(draft('d', 'elsewhere', 'TST-01', '2026-10-28'), [older, newer])).toBe(newer);
    expect(templateForDraft(draft('d', 'elsewhere', 'TST-99', '2026-10-28'), [toolbox])).toBeUndefined();
    // An empty code says nothing: a code-less draft from elsewhere is matched to no code-less form.
    expect(templateForDraft(draft('d', 'elsewhere', '', '2026-10-28'), [template('x', '', 'Log')])).toBeUndefined();
  });

  it('says `<code> <title> — <period>`, or that the form must be imported, sorted like the library', () => {
    const rows = draftRows([
      draft('d1', 't3', 'TST-03', '2026-W44'),
      draft('d2', 'gone', 'TST-77', '2026-10-28'),
      draft('d3', 't1', 'TST-01', '2026-10-28'),
      draft('d4', 'gone', '', '2026-10'),
      draft('d5', 'x', 'TST-01', '2026-10', { templateId: 't1' }),
    ], [toolbox, weekly], periodLabel);
    expect(rows.map((r) => [r.draft.id, r.text, r.template?.id])).toEqual([
      ['d5', 'TST-01 Toolbox Talk — October 2026', 't1'],
      ['d3', 'TST-01 Toolbox Talk — 28-OCT-2026', 't1'],
      ['d1', 'TST-03 Demo Weekly Jobs — Week 44, 2026', 't3'],
      ['d2', 'TST-77 — import this form to continue', undefined],
      ['d4', '(no code) — import this form to continue', undefined],
    ]);
  });

  it('leaves the code out for a form that has none', () => {
    const log = template('t9', '', 'Garbage log');
    expect(draftRows([draft('d', 't9', '', '2026-10-28')], [log], periodLabel)[0].text).toBe('Garbage log — 28-OCT-2026');
  });
});

describe('a new revision', () => {
  it('replaces the newest live form with the same non-empty code', () => {
    const a = template('a', 'TST-01', 'Toolbox Talk', '00', { updatedAt: '2026-09-01T00:00:00.000Z' });
    const b = template('b', 'TST-01', 'Toolbox Talk', '00', { updatedAt: '2026-10-01T00:00:00.000Z' });
    const gone = template('c', 'TST-01', 'Toolbox Talk', '00', { updatedAt: '2026-11-01T00:00:00.000Z', deleted: true });
    expect(replaceTarget([a, b, gone], 'TST-01')?.id).toBe('b');
    expect(replaceTarget([a, b], 'TST-02')).toBeUndefined();
    expect(replaceTarget([template('x', '', 'Log')], '')).toBeUndefined();
  });

  it('asks in the exact words, and says what could not be carried over', () => {
    expect(replacePrompt('00 / 01.01.2026', '01 / 01.06.2026')).toBe('Replace Revision 00 / 01.01.2026 with Revision 01 / 01.06.2026?');
    expect(revisionNotice({ unmatched: ['Location', 'Crew · Remarks'], droppedFromDrafts: 3 })).toEqual([
      'New fields to check: Location, Crew · Remarks', '3 values in open drafts could not be carried over.',
    ]);
    expect(revisionNotice({ unmatched: [], droppedFromDrafts: 1 })).toEqual(['1 value in open drafts could not be carried over.']);
    expect(revisionNotice({ unmatched: [], droppedFromDrafts: 0 })).toEqual([]);
  });
});

function field(id: string, label: string, extra: Partial<FieldDef> = {}): FieldDef {
  return { id, kind: 'text', label, section: '', loc: id, confidence: 'high', ...extra };
}

function group(id: string, label: string, columns: FieldDef[], extra: Partial<RowGroupDef> = {}): RowGroupDef {
  return { id, label, section: label, loc: id, columns, capacity: 12, growable: false, shape: 'rows', ...extra };
}

const SCHEMA: FormSchema = {
  kind: 'docx',
  identity: { code: 'TST-01', title: 'Toolbox Talk', revision: '00' },
  fields: [
    field('f1', 'Vessel'), field('f2', 'Subject'), field('f3', 'Field 3', { confidence: 'low' }), field('f4', 'Date', { kind: 'date' }),
    field('f5', 'Signature', { leftEmpty: true }), field('f6', 'Check 1', { kind: 'choice', options: ['Yes', 'No'], section: 'Checks' }),
    field('f7', 'Check 2', { kind: 'choice', options: ['Yes', 'No'], section: 'Checks' }),
  ],
  rowGroups: [
    group('g1', 'Participants', [field('g1.c1', 'Name'), field('g1.c2', 'Column 2', { confidence: 'low' }), field('g1.c3', 'Signature', { leftEmpty: true })]),
    group('g2', 'Jobs', [field('g2.c1', 'Date', { kind: 'date' }), field('g2.c2', 'Status', { kind: 'choice', options: ['Pending', 'Done'] })], { capacity: 3, growable: true }),
  ],
  unsupported: ['Text in a text box on page 1 is not filled in.'],
};

const SETUP = emptySetup({
  links: { f1: { source: 'vessel.name' }, f4: { source: 'time.date' }, f2: { source: 'none' }, 'g2.c1': { source: 'time.date' } },
  leftEmpty: ['f5', 'g1.c3'],
  helpers: { ...NO_HELPERS, pickCrew: ['g1'], allOk: ['f6', 'f7'] },
});

const ids = (entries: { field: FieldDef }[]) => entries.map((e) => e.field.id);

describe('the setup review', () => {
  it('heads the screen with the code, else the title', () => {
    expect(setupHeading({ code: 'TST-01', title: 'Toolbox Talk' })).toBe('Set up TST-01');
    expect(setupHeading({ code: '', title: 'Garbage log' })).toBe('Set up Garbage log');
  });

  it('says what was found', () => {
    expect(foundSummary(SCHEMA)).toBe('Found 7 fields and 2 tables of 12 and 3 rows.');
    expect(foundSummary({ ...SCHEMA, fields: SCHEMA.fields.slice(0, 1), rowGroups: SCHEMA.rowGroups.slice(0, 1) })).toBe('Found 1 field and 1 table of 12 rows.');
    expect(foundSummary({ ...SCHEMA, rowGroups: [] })).toBe('Found 7 fields.');
  });

  it('puts each field in the section its choice gives: linked, filled by you (unsure names first), or left empty', () => {
    const sections = setupSections(SCHEMA, SETUP);
    expect(ids(sections.filled)).toEqual(['f1', 'f4', 'g2.c1']);
    expect(ids(sections.you)).toEqual(['f3', 'g1.c2', 'f2', 'f6', 'f7', 'g1.c1', 'g2.c2']);
    expect(ids(sections.empty)).toEqual(['f5', 'g1.c3']);
    // A column carries its group, so that it is shown under the group's heading.
    expect(sections.filled.map((e) => e.group?.id)).toEqual([undefined, undefined, 'g2']);
    expect(sections.you.find((e) => e.field.id === 'g1.c2')?.group?.label).toBe('Participants');
  });

  it('lists a field named only by a fallback rule first, as unsure, and keeps its name when the person leaves it (R23)', () => {
    const schema = detectWord(readPackage(farLabelsDocx()), 'docx', 'far.docx');
    const you = setupSections(schema, emptySetup()).you;
    const unsure = you.filter((e) => e.field.confidence === 'low');
    // The unsure ones come first, in the form's order; a field named by a fallback rule is one, with its name.
    expect(you.slice(0, unsure.length)).toEqual(unsure);
    const found = unsure.find((e) => e.field.label === 'Demo ropes')!;
    expect(found).toBeDefined();
    // The setup review shows that name in the field to edit; kept as it is, it is valid and saved unchanged.
    const labels = { [found.field.id]: found.field.label };
    expect(setupProblems({ okWord: 'OK', labels })).toEqual({});
    expect(savedSchema(schema, emptySetup(), labels).fields.find((f) => f.id === found.field.id)?.label).toBe('Demo ropes');
  });

  it('gives the choice of each field as the select shows it', () => {
    expect(choiceOf(SETUP, 'f1')).toBe('link:vessel.name');
    expect(choiceOf(SETUP, 'f2')).toBe('you');
    expect(choiceOf(SETUP, 'f3')).toBe('you');
    expect(choiceOf(SETUP, 'f5')).toBe('empty');
  });

  it('moves a field between the sections when its choice changes, without touching the setup it was given', () => {
    const before = structuredClone(SETUP);
    const emptied = applyChoice(SETUP, 'f1', 'empty');
    expect(emptied.leftEmpty).toEqual(['f5', 'g1.c3', 'f1']);
    expect(emptied.links.f1).toEqual({ source: 'none' }); // so that nothing fills it in
    expect(ids(setupSections(SCHEMA, emptied).empty)).toEqual(['f1', 'f5', 'g1.c3']);

    const mine = applyChoice(SETUP, 'f4', 'you');
    expect(mine.links.f4).toEqual({ source: 'none' });
    expect(ids(setupSections(SCHEMA, mine).you)).toContain('f4');

    const linked = applyChoice(SETUP, 'f5', 'link:crew.byRank.master|nameRank');
    expect(linked.leftEmpty).toEqual(['g1.c3']);
    expect(linked.links.f5).toEqual({ source: 'crew.byRank.master', part: 'nameRank' });
    expect(ids(setupSections(SCHEMA, linked).filled)).toEqual(['f1', 'f4', 'f5', 'g2.c1']);

    expect(applyChoice(SETUP, 'g1.c3', 'you').leftEmpty).toEqual(['f5']);
    // A field left empty is taken out of its helpers, so nothing fills it in.
    expect(applyChoice(SETUP, 'f6', 'empty').helpers.allOk).toEqual(['f7']);
    expect(applyChoice(SETUP, 'f1', 'nonsense')).toEqual(SETUP);
    expect(SETUP).toEqual(before);
  });

  it('offers a switch for each helper that applies, one per section for All OK, on as the setup has it', () => {
    const suggested = { ...NO_HELPERS, pickCrew: ['g1'], allOk: ['f6', 'f7'], jobLog: ['g2'], now: ['f9-gone'] };
    const switches = helperSwitches(SCHEMA, SETUP, suggested);
    expect(switches.map((s) => [s.key, s.ids, s.label, s.on])).toEqual([
      ['pickCrew', ['g1'], 'Add from crew: Participants', true],
      ['allOk', ['f6', 'f7'], 'All Satisfactory: Checks', true],
      ['jobLog', ['g2'], 'Carry over unfinished jobs: Jobs', false],
    ]);
    const on = setHelper(SETUP, switches[2], true);
    expect(on.helpers.jobLog).toEqual(['g2']);
    expect(showsNotFinished(on)).toBe(true);
    expect(showsNotFinished(SETUP)).toBe(false);
    // A field the person leaves empty is no longer offered to a helper.
    const emptied = applyChoice(applyChoice(SETUP, 'f6', 'empty'), 'f7', 'empty');
    expect(helperSwitches(SCHEMA, emptied, suggested).map((s) => s.key)).toEqual(['pickCrew', 'jobLog']);
    const off = setHelper(SETUP, switches[1], false);
    expect(off.helpers.allOk).toEqual([]);
    expect(SETUP.helpers.allOk).toEqual(['f6', 'f7']);
  });

  it('asks for the OK word, for a name in every renamed field, and for the not-finished status while it is asked', () => {
    expect(setupProblems({ okWord: 'Satisfactory', labels: { f3: 'Remarks' } })).toEqual({});
    expect(setupProblems({ okWord: '  ', labels: { f3: ' ', 'g1.c2': 'Rank' } })).toEqual({
      okWord: 'Enter the OK word.', f3: 'Enter a name for this field.',
    });
    expect(setupProblems({ okWord: 'OK', labels: {}, notFinished: ' ' })).toEqual({ notFinished: 'Enter the status of a job that is not finished.' });
    expect(setupProblems({ okWord: 'OK', labels: {}, notFinished: 'Pending' })).toEqual({});
  });

  it('saves the new names and the left-empty choices into the schema, so that the file is written as set up', () => {
    const before = structuredClone(SCHEMA);
    const setup = applyChoice(applyChoice(SETUP, 'g1.c3', 'you'), 'f2', 'empty');
    const saved = savedSchema(SCHEMA, setup, { f3: '  Remarks ', 'g1.c2': 'Rank' });
    expect(saved.fields.find((f) => f.id === 'f3')?.label).toBe('Remarks');
    expect(saved.rowGroups[0].columns[1].label).toBe('Rank');
    expect(saved.fields.find((f) => f.id === 'f2')?.leftEmpty).toBe(true);
    expect(saved.fields.find((f) => f.id === 'f5')?.leftEmpty).toBe(true);
    expect('leftEmpty' in saved.rowGroups[0].columns[2]).toBe(false);
    expect('leftEmpty' in saved.fields[0]).toBe(false);
    expect(SCHEMA).toEqual(before);
    // The same rule as the store's (`alignLeftEmpty`).
    expect(savedSchema(SCHEMA, setup, {})).toEqual(alignLeftEmpty(SCHEMA, setup).schema);
  });
});

describe('confirming a guessed name in the setup review (R24)', () => {
  const schema = detectWord(readPackage(guessedLabelsDocx()), 'docx', 'guessed.docx');
  const [vessel, date] = schema.fields;
  const start = { setup: defaultSetup(schema), confirmed: {}, suggested: {} };
  const suggest = (f: FieldDef) => suggestLinkFor(f);

  it('starts with the guessed fields unlinked, among the fields you fill, unsure first', () => {
    expect([vessel.label, vessel.confidence, date.label, date.confidence]).toEqual(['Vessel', 'low', 'Date', 'low']);
    expect([choiceOf(start.setup, vessel.id), choiceOf(start.setup, date.id)]).toEqual(['you', 'you']);
    expect(ids(setupSections(schema, start.setup).you)).toEqual(['f1', 'f2', 'f3']);
  });

  it('suggests a link for the name the person confirms, which they see and can change', () => {
    const confirmed = confirmName(start, vessel, 'Vessel', suggest);
    expect(choiceOf(confirmed.setup, vessel.id)).toBe('link:vessel.name');
    expect(confirmed.confirmed).toEqual({ [vessel.id]: 'Vessel' });
    expect(ids(setupSections(schema, confirmed.setup).filled)).toEqual([vessel.id]);
    // The person changes it: confirming again keeps their choice.
    const changed = { ...confirmed, setup: applyChoice(confirmed.setup, vessel.id, 'link:vessel.imo') };
    expect(choiceOf(confirmName(changed, vessel, 'Ship', suggest).setup, vessel.id)).toBe('link:vessel.imo');
    const emptied = { ...confirmed, setup: applyChoice(confirmed.setup, vessel.id, 'empty') };
    expect(choiceOf(confirmName(emptied, vessel, 'Ship', suggest).setup, vessel.id)).toBe('empty');
    expect(start.setup.links).toEqual({}); // nothing given is changed
  });

  it('follows a rename: the link suggested before gives way to the new name\'s, or to You fill', () => {
    const renamed = confirmName(start, date, 'IMO No.', suggest);
    expect(choiceOf(renamed.setup, date.id)).toBe('link:vessel.imo');
    const again = confirmName(renamed, date, 'Notes', suggest);
    expect(choiceOf(again.setup, date.id)).toBe('you');
    expect(again.confirmed).toEqual({ [date.id]: 'Notes' });
    expect(again.suggested).toEqual({});
    // An empty name confirms nothing.
    expect(confirmName(start, date, '  ', suggest)).toBe(start);
  });

  it('saves a confirmed field at high confidence, with its name; one left unconfirmed stays unsure', () => {
    const confirmed = confirmName(start, vessel, ' Ship name ', suggest);
    const saved = savedSchema(schema, confirmed.setup, { [vessel.id]: ' Ship name ' }, new Set(Object.keys(confirmed.confirmed)));
    expect(saved.fields.map((f) => [f.label, f.confidence])).toEqual([['Ship name', 'high'], ['Date', 'low'], ['Remarks', 'high']]);
    expect(choiceOf(confirmed.setup, vessel.id)).toBe('link:vessel.name');
  });
});

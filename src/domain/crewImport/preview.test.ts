import { describe, expect, it } from 'vitest';
import type { CrewMember } from '../types';
import { guessMapping } from './mapping';
import { importPlan } from './plan';
import { buildPreview, resolveRow, type PreviewRow, type ResolveContext } from './preview';
import type { Cell } from './readSpreadsheet';
import { recheckRows } from './recheck';

let seq = 0;
function crewMember(over: Partial<CrewMember> = {}): CrewMember {
  seq += 1;
  return {
    id: `crew-${seq}`, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'test-device', deleted: false, scope: 'ship', shipId: 'ship-1',
    surname: 'PETROVIĆ', givenNames: 'Ivan', rank: 'chiefOfficer', nationality: 'Croatian',
    dateOfBirth: '1985-01-05', placeOfBirth: 'Split', passportNo: '012 345 678', passportExpiry: '2030-01-01',
    seamansBookNo: 'sb 998', seamansBookExpiry: '2030-02-02', signOnDate: '2026-06-01', signOnPort: 'Rijeka',
    ...over,
  };
}

const HEADER: Cell[] = ['Surname', 'Given names', 'Rank', 'Date of birth', 'Passport No', 'Sign on'];
const BRIEF_ROWS: Cell[][] = [
  ['MV Ocean Star crew list'],
  HEADER,
  ['PETROVIĆ', 'Ivan', 'Master', '05.01.1985', '012345678', '01.06.2026'],
  ["O'BRIEN", 'Jean-Luc', 'A/B', '31.02.1990', 'X1', ''],
  ['ŠAŠIĆ', 'Marko', 'C/O', '', 'P 77', ''],
  [],
  ['Total crew: 3'],
];

interface Options { rows: Cell[][]; headerRow?: number; existing?: CrewMember[]; dateFormat?: 'day-first' | 'year-first' }
function build({ rows, headerRow = 0, existing = [], dateFormat = 'day-first' }: Options): PreviewRow[] {
  return buildPreview({
    rows, headerRow, mapping: guessMapping(rows[headerRow]), dateFormat, existing,
    currentYear: 2026, today: '2026-10-25', defaultSignOnDate: '2026-10-25',
  });
}
const buildBrief = (existing: CrewMember[] = []): PreviewRow[] => build({ rows: BRIEF_ROWS, headerRow: 1, existing });
const table = (header: Cell[], ...data: Cell[][]): Cell[][] => [header, ...data];

describe('buildPreview', () => {
  const existing = [crewMember()];

  it('classifies new, updated and faulty rows and skips the footer and blank rows', () => {
    const rows = buildBrief(existing);
    expect(rows.map(r => r.rowNumber)).toEqual([3, 4, 5]);
    expect(rows[0]).toMatchObject({ status: 'update', existingId: existing[0].id, changes: [{ field: 'rank', from: 'chiefOfficer', to: 'master' }] });
    expect(rows[1].status).toBe('error');
    expect(rows[1].errors[0]).toMatchObject({ field: 'dateOfBirth', message: 'Enter a valid date.' });
    expect(rows[1].draft).toMatchObject({ surname: "O'BRIEN", givenNames: 'Jean-Luc', rank: 'ab', signOnDate: '2026-10-25' });
    expect(rows[2]).toMatchObject({ status: 'new', draft: { surname: 'ŠAŠIĆ', rank: 'chiefOfficer', passportNo: 'P 77' } });
    const fixed = resolveRow({ ...rows[1], overrides: { dateOfBirth: '1990-02-28' } }, { existing, today: '2026-10-25', defaultSignOnDate: '2026-10-25' });
    expect(fixed.status).toBe('new');
  });

  it('does not skip any row by default and leaves new rows without changes', () => {
    const rows = buildBrief(existing);
    expect(rows.map(r => r.skip)).toEqual([false, false, false]);
    expect(rows[2].changes).toEqual([]);
    expect(rows[2]).not.toHaveProperty('existingId');
    expect(rows[2].errors).toEqual([]);
  });

  it('keeps names and text exactly as typed, apart from trimming', () => {
    const rows = build({ rows: table(['Surname', 'Given names', 'Rank', 'Passport No', 'Nationality'], ['  Šašić ', "Jean-Luc  d'Arc", 'Master', ' P 77 ', ' Hrvatska '], ['Petrović', 'Ivan', 'Master', 'X9', null]) });
    expect(rows[0].draft).toMatchObject({ surname: 'Šašić', givenNames: "Jean-Luc  d'Arc", passportNo: 'P 77', nationality: 'Hrvatska' });
    expect(rows[1].draft.nationality).toBe('');
  });

  it('uses the default sign-on date for a new row with no sign-on date, and the file date otherwise', () => {
    const rows = buildBrief();
    expect(rows[1].draft.signOnDate).toBe('2026-10-25');
    expect(buildBrief(existing)[0].draft.signOnDate).toBe('2026-06-01');
    const noColumn = build({ rows: table(['Surname', 'Rank', 'Passport No'], ['Šašić', 'Master', 'P1']) });
    expect(noColumn[0]).toMatchObject({ status: 'new', draft: { signOnDate: '2026-10-25' } });
  });

  it('reads Excel dates and serial numbers', () => {
    const rows = build({ rows: table(HEADER, ['Šašić', 'Marko', 'Master', new Date(Date.UTC(1985, 0, 5)), 'P1', 31052]) });
    expect(rows[0].draft).toMatchObject({ dateOfBirth: '1985-01-05', signOnDate: '1985-01-05' });
  });

  it('follows the date format of the mapping', () => {
    const rows = table(HEADER, ['Šašić', 'Marko', 'Master', '1985/1/5', 'P1', '05.01.2026']);
    expect(build({ rows, dateFormat: 'year-first' })[0]).toMatchObject({ status: 'error', draft: { dateOfBirth: '1985-01-05', signOnDate: '05.01.2026' } });
    expect(build({ rows, dateFormat: 'day-first' })[0]).toMatchObject({ status: 'new', draft: { dateOfBirth: '1985-01-05', signOnDate: '2026-01-05' } });
  });

  describe('invalid dates', () => {
    it('keep the raw text in the draft and give one "Enter a valid date." error for that field', () => {
      const rows = build({ rows: table(['Surname', 'Rank', 'Passport No', 'Date of birth', 'Passport expiry', 'Sign on', 'Sign off date'], ['Šašić', 'Master', 'P1', '31.02.1990', 'n/a', 0, ' soon ']) });
      expect(rows[0].status).toBe('error');
      expect(rows[0].draft).toMatchObject({ dateOfBirth: '31.02.1990', passportExpiry: 'n/a', signOnDate: '0', signOffDate: 'soon' });
      expect(rows[0].errors).toEqual([
        { field: 'dateOfBirth', message: 'Enter a valid date.', severity: 'error' },
        { field: 'passportExpiry', message: 'Enter a valid date.', severity: 'error' },
        { field: 'signOnDate', message: 'Enter a valid date.', severity: 'error' },
        { field: 'signOffDate', message: 'Enter a valid date.', severity: 'error' },
      ]);
    });

    it('do not replace an existing date, and do not get the default sign-on date', () => {
      const rows = build({ rows: table(HEADER, ['PETROVIĆ', 'Ivan', 'Master', '', '012345678', 'ASAP']), existing });
      expect(rows[0].status).toBe('error');
      expect(rows[0].draft.signOnDate).toBe('ASAP');
      expect(rows[0].errors.filter(e => e.field === 'signOnDate')).toHaveLength(1);
      expect(rows[0].existingId).toBe(existing[0].id);
    });
  });

  describe('ranks', () => {
    it('parse the rank text, and keep an unknown rank under "other"', () => {
      const rows = build({ rows: table(['Surname', 'Rank', 'Passport No'], ['A', 'Pumpman', 'P1'], ['B', 'C/E', 'P2']) });
      expect(rows[0].draft).toMatchObject({ rank: 'other', rankOther: 'Pumpman' });
      expect(rows[0].status).toBe('new');
      expect(rows[1].draft.rank).toBe('chiefEngineer');
      expect(rows[1].draft).not.toHaveProperty('rankOther');
    });

    it('make a missing rank an error for a new row, and keep the existing rank for an updated one', () => {
      const rows = build({ rows: table(['Surname', 'Rank', 'Passport No'], ['A', '', 'P1'], ['PETROVIĆ', '', '012345678']), existing });
      expect(rows[0]).toMatchObject({ status: 'error', errors: [{ field: 'rank', message: 'Rank is required.' }] });
      expect(rows[1]).toMatchObject({ status: 'update', draft: { rank: 'chiefOfficer' }, changes: [] });
      const noColumn = build({ rows: table(['Surname', 'Passport No'], ['A', 'P1']) });
      expect(noColumn[0]).toMatchObject({ status: 'error', errors: [{ field: 'rank', message: 'Rank is required.' }] });
    });

    it('drop a stale "other" rank text when the file gives a known rank', () => {
      const pumpman = crewMember({ rank: 'other', rankOther: 'Pumpman' });
      const [row] = build({ rows: table(['Surname', 'Rank', 'Passport No'], ['PETROVIĆ', 'Fitter', '012345678']), existing: [pumpman] });
      expect(row.draft.rank).toBe('fitter');
      expect(row.draft).not.toHaveProperty('rankOther');
      expect(row.changes).toEqual([{ field: 'rank', from: 'other', to: 'fitter' }]);
    });

    it('list a changed "other" rank text, and keep it when the file has none', () => {
      const pumpman = crewMember({ rank: 'other', rankOther: 'Pumpman' });
      const changed = build({ rows: table(['Surname', 'Rank', 'Passport No'], ['PETROVIĆ', 'Pump man', '012345678']), existing: [pumpman] });
      expect(changed[0].changes).toEqual([{ field: 'rankOther', from: 'Pumpman', to: 'Pump man' }]);
      const blank = build({ rows: table(['Surname', 'Rank', 'Passport No'], ['PETROVIĆ', '', '012345678']), existing: [pumpman] });
      expect(blank[0]).toMatchObject({ status: 'update', draft: { rank: 'other', rankOther: 'Pumpman' }, changes: [] });
    });
  });

  describe('matching existing crew', () => {
    it('lists no change when the values are identical, apart from the formatting of the passport and book numbers', () => {
      const rows = table(
        ['Surname', 'Given names', 'Rank', 'Date of birth', 'Passport No', "Seaman's book", 'Sign on'],
        ['PETROVIĆ', 'Ivan', 'C/O', '05.01.1985', ' 012345678 ', 'SB998', '01.06.2026'],
      );
      const [row] = build({ rows, existing });
      expect(row).toMatchObject({ status: 'update', existingId: existing[0].id, changes: [] });
      expect(row.draft).toMatchObject({ passportNo: '012 345 678', seamansBookNo: 'sb 998' });
    });

    it('keeps the existing formatting of the passport number when only the case differs', () => {
      const rows = table(['Surname', 'Rank', 'Passport No'], ['PETROVIĆ', 'C/O', 'ab123']);
      const [row] = build({ rows, existing: [crewMember({ passportNo: 'AB 123' })] });
      expect(row.draft.passportNo).toBe('AB 123');
      expect(row.changes).toEqual([]);
    });

    it('lists every changed field in the order of the record, with its old and new value', () => {
      const rows = table(
        ['Surname', 'Given names', 'Rank', 'Nationality', 'Date of birth', 'Place of birth', 'Passport No', 'Passport expiry', "Seaman's book No", 'Seaman\'s book expiry', 'Sign on', 'Sign on port', 'Sign off date', 'Sign off port'],
        ['Petrovic', 'Ivo', 'Master', 'Serbian', '06.01.1985', 'Zadar', '012345678', '01.01.2031', 'SB-1', '03.03.2030', '02.06.2026', 'Bar', '10.10.2026', 'Koper'],
      );
      const [row] = build({ rows, existing });
      expect(row.status).toBe('update');
      expect(row.changes).toEqual([
        { field: 'surname', from: 'PETROVIĆ', to: 'Petrovic' },
        { field: 'givenNames', from: 'Ivan', to: 'Ivo' },
        { field: 'rank', from: 'chiefOfficer', to: 'master' },
        { field: 'nationality', from: 'Croatian', to: 'Serbian' },
        { field: 'dateOfBirth', from: '1985-01-05', to: '1985-01-06' },
        { field: 'placeOfBirth', from: 'Split', to: 'Zadar' },
        { field: 'passportExpiry', from: '2030-01-01', to: '2031-01-01' },
        { field: 'seamansBookNo', from: 'sb 998', to: 'SB-1' },
        { field: 'seamansBookExpiry', from: '2030-02-02', to: '2030-03-03' },
        { field: 'signOnDate', from: '2026-06-01', to: '2026-06-02' },
        { field: 'signOnPort', from: 'Rijeka', to: 'Bar' },
        { field: 'signOffDate', from: '', to: '2026-10-10' },
        { field: 'signOffPort', from: '', to: 'Koper' },
      ]);
    });

    it('never lets an empty file cell overwrite an existing value, whether the column is mapped or not', () => {
      const rows = table(
        ['Surname', 'Given names', 'Rank', 'Nationality', 'Date of birth', 'Passport No', 'Sign on'],
        ['', '', '', '', '', '012345678', ''],
      );
      const [row] = build({ rows, existing: [crewMember({ signOffDate: '2026-12-01', signOffPort: 'Koper' })] });
      expect(row).toMatchObject({ status: 'update', changes: [], errors: [] });
      expect(row.draft).toMatchObject({
        surname: 'PETROVIĆ', givenNames: 'Ivan', rank: 'chiefOfficer', nationality: 'Croatian', dateOfBirth: '1985-01-05',
        placeOfBirth: 'Split', passportExpiry: '2030-01-01', signOnDate: '2026-06-01', signOnPort: 'Rijeka', signOffDate: '2026-12-01', signOffPort: 'Koper',
      });
    });

    it('matches the passport without regard to spaces and case, and picks the latest contract', () => {
      const older = crewMember({ passportNo: 'ab 123', signOnDate: '2025-01-01', signOffDate: '2025-06-01' });
      const latest = crewMember({ passportNo: 'AB123', signOnDate: '2026-03-01' });
      const deleted = crewMember({ passportNo: 'AB 123', signOnDate: '2026-09-01', deleted: true });
      const [row] = build({ rows: table(['Surname', 'Rank', 'Passport No'], ['PETROVIĆ', 'C/O', 'Ab 1 23']), existing: [older, latest, deleted] });
      expect(row).toMatchObject({ status: 'update', existingId: latest.id });
    });

    it('treats a row without a passport number as new', () => {
      const rows = table(['Surname', 'Given names', 'Rank'], ['PETROVIĆ', 'Ivan', 'Master']);
      expect(build({ rows, existing })[0]).toMatchObject({ status: 'new', draft: { signOnDate: '2026-10-25' } });
    });
  });

  describe('which rows are crew', () => {
    it('skips rows that have no surname, given names, full name or passport number', () => {
      const rows = table(['Surname', 'Rank', 'Nationality'], ['', 'Master', 'Croatian'], [null, null, null], ['Šašić', 'Master', 'Croatian']);
      expect(build({ rows }).map(r => r.rowNumber)).toEqual([4]);
    });

    it('skips rows with a lone name and nothing else, like a total or a department heading', () => {
      const rows = table(['Surname', 'Given names', 'Rank', 'Passport No'], ['DECK DEPARTMENT'], ['Šašić', 'Marko', 'Master', 'P1'], ['', 'Total crew:'], ['Total crew: 1', null, null, null]);
      expect(build({ rows }).map(r => r.rowNumber)).toEqual([3]);
    });

    it('keeps a name with one more value, and a row that has a passport number alone', () => {
      const rows = table(['Surname', 'Rank', 'Passport No'], ['Šašić', 'Master', ''], ['', '', 'P1']);
      const result = build({ rows });
      expect(result.map(r => r.rowNumber)).toEqual([2, 3]);
      expect(result[1]).toMatchObject({ status: 'error', errors: [{ field: 'surname', message: 'Surname is required.' }, { field: 'rank', message: 'Rank is required.' }] });
    });

    it('imports a sheet that has a single mapped column', () => {
      const rows = table(['Name'], ['Ivan Petrović']);
      expect(build({ rows })[0].draft).toMatchObject({ surname: 'Petrović', givenNames: 'Ivan' });
    });

    it('starts after the header row, wherever it is, and numbers rows from the top of the sheet', () => {
      const rows: Cell[][] = [[], [], ['logo'], HEADER, ['Šašić', 'Marko', 'Master', '', 'P1', '']];
      expect(build({ rows, headerRow: 3 }).map(r => r.rowNumber)).toEqual([5]);
      expect(build({ rows: [HEADER], headerRow: 0 })).toEqual([]);
    });

    it('reads rows shorter than the header as having empty cells', () => {
      const rows = table(HEADER, ['Šašić', 'Marko', 'Master'], ['Petrović', 'Ivan']);
      const result = build({ rows });
      expect(result[0]).toMatchObject({ status: 'new', draft: { passportNo: '', dateOfBirth: '', signOnDate: '2026-10-25' } });
      expect(result[1].errors).toEqual([{ field: 'rank', message: 'Rank is required.', severity: 'error' }]);
    });
  });

  describe('a header row repeated further down the sheet', () => {
    it('is not a crew member', () => {
      const rows: Cell[][] = [
        HEADER,
        ['Šašić', 'Marko', 'Master', '', 'P1', ''],
        ['Surname', 'Given names', 'Rank', 'Date of birth', 'Passport No', 'Sign on'],
        ['Petrović', 'Ivan', 'C/O', '', 'P2', ''],
      ];
      expect(build({ rows }).map(r => r.rowNumber)).toEqual([2, 4]);
    });

    it('is recognised from any three headers, whatever the columns are mapped to', () => {
      const rows: Cell[][] = [HEADER, ['Šašić', 'Marko', 'Master', '', 'P1', ''], ['Prezime', 'Surname', 'Rank', 'Remarks', 'Passport No', null]];
      expect(build({ rows }).map(r => r.rowNumber)).toEqual([2]);
    });

    it('does not take away a person with one or two cells that read like a header', () => {
      const rows: Cell[][] = [HEADER, ['Born', 'Position', 'Master', '', 'P1', ''], ['Rank', 'Name', 'Master', '', 'P2', '']];
      expect(build({ rows }).map(r => r.rowNumber)).toEqual([2, 3]);
    });
  });

  describe('duplicate passport numbers in the file', () => {
    const duplicate = { field: 'passportNo', message: 'Duplicate passport number in this file.', severity: 'error' };

    it('make the later row an error and leave the first as it was classified', () => {
      const rows = table(HEADER, ['Šašić', 'Marko', 'Master', '', 'P 77', ''], ['Petrović', 'Ivan', 'C/O', '', 'p77', ''], ['Horvat', 'Ana', 'AB', '', 'P 78', '']);
      const result = build({ rows });
      expect(result.map(r => r.status)).toEqual(['new', 'error', 'new']);
      expect(result[0].errors).toEqual([]);
      expect(result[1].errors).toEqual([duplicate]);
      expect(result[2].errors).toEqual([]);
    });

    it('add to the other errors of the later row, and also catch two rows for the same existing crew member', () => {
      const rows = table(HEADER, ['PETROVIĆ', 'Ivan', 'Master', '', '012345678', ''], ['PETROVIĆ', 'Ivan', 'Master', 'n/a', '012 345 678', '']);
      const [first, second] = build({ rows, existing });
      expect(first).toMatchObject({ status: 'update', existingId: existing[0].id, errors: [] });
      expect(second).toMatchObject({ status: 'error', existingId: existing[0].id });
      expect(second.errors).toEqual([{ field: 'dateOfBirth', message: 'Enter a valid date.', severity: 'error' }, duplicate]);
    });

    it('count a first row that is faulty, but not skipped rows or empty passport numbers', () => {
      const rows = table(HEADER, ['Šašić', 'Marko', 'Master', '31.02.1990', 'P1', ''], ['Petrović', 'Ivan', 'C/O', '', 'P1', ''], ['A', 'B', 'AB', '', '', ''], ['C', 'D', 'AB', '', '', '']);
      expect(build({ rows }).map(r => r.status)).toEqual(['error', 'error', 'new', 'new']);
      expect(build({ rows })[1].errors).toEqual([duplicate]);
    });
  });

  describe('names', () => {
    const fullNames = table(['Name', 'Rank', 'Passport No'], ['PETROVIĆ, Ivan', 'Master', 'P1'], ['Jean-Luc Picard', 'Master', 'P2']);

    it('are split from a full name column when surname and given names are not mapped', () => {
      const rows = build({ rows: fullNames });
      expect(rows[0].draft).toMatchObject({ surname: 'PETROVIĆ', givenNames: 'Ivan' });
      expect(rows[1].draft).toMatchObject({ surname: 'Picard', givenNames: 'Jean-Luc' });
    });

    it('come from the surname and given names columns when those are mapped as well as a full name', () => {
      const rows = table(['Surname', 'Given names', 'Name', 'Rank', 'Passport No'], ['Šašić', 'Marko', 'IGNORED Name', 'Master', 'P1']);
      expect(build({ rows })[0].draft).toMatchObject({ surname: 'Šašić', givenNames: 'Marko' });
    });

    it('ignore a full name column when only one of surname and given names is mapped', () => {
      const rows = table(['Surname', 'Name', 'Rank', 'Passport No'], ['Šašić', 'IGNORED Name', 'Master', 'P1']);
      expect(build({ rows })[0].draft).toMatchObject({ surname: 'Šašić', givenNames: '' });
    });
  });

  it('numbers written as passport numbers are kept as text', () => {
    const rows = table(['Surname', 'Rank', 'Passport No'], ['Šašić', 'Master', 12345678]);
    expect(build({ rows })[0].draft.passportNo).toBe('12345678');
  });

  it('reports a date of birth that is not in the past', () => {
    const rows = table(HEADER, ['Šašić', 'Marko', 'Master', '25.10.2026', 'P1', '']);
    expect(build({ rows })[0]).toMatchObject({ status: 'error', errors: [{ field: 'dateOfBirth', message: 'Date of birth must be in the past.' }] });
  });
});

describe('resolveRow', () => {
  const existing = [crewMember()];
  const context = (over: Partial<ResolveContext> = {}): ResolveContext => ({ existing, today: '2026-10-25', defaultSignOnDate: '2026-10-25', ...over });
  /** The row with these fixes added to the ones it has, worked out again. */
  const fix = (row: PreviewRow, overrides: PreviewRow['overrides'], over: Partial<ResolveContext> = {}): PreviewRow =>
    resolveRow({ ...row, overrides: { ...row.overrides, ...overrides } }, context(over));

  it('keeps what the sheet says apart from the fixes, and starts with none', () => {
    const rows = buildBrief(existing);
    expect(rows[2].overrides).toEqual({});
    expect(rows[2].fileDraft).toMatchObject({ surname: 'ŠAŠIĆ', passportNo: 'P 77', nationality: '', signOnDate: '' });   // no default in it
    expect(rows[2].draft.signOnDate).toBe('2026-10-25');
    expect(rows[0].fileDraft).toMatchObject({ nationality: '', dateOfBirth: '1985-01-05' });                              // none of the saved contract in it
    expect(rows[0].draft.nationality).toBe('Croatian');
    const fixed = fix(rows[1], { dateOfBirth: '1990-02-28' });
    expect(fixed.fileDraft).toEqual(rows[1].fileDraft);
    expect(fixed.overrides).toEqual({ dateOfBirth: '1990-02-28' });
  });

  it('works the row out again from the file and the fixes, keeping the row number and skip flag', () => {
    const [first] = buildBrief(existing);
    const edited = resolveRow({ ...first, skip: true, overrides: { rank: 'master', nationality: 'Serbian' } }, context());
    expect(edited).toMatchObject({ rowNumber: 3, skip: true, status: 'update', existingId: existing[0].id });
    expect(edited.changes).toEqual([{ field: 'rank', from: 'chiefOfficer', to: 'master' }, { field: 'nationality', from: 'Croatian', to: 'Serbian' }]);
    const reverted = resolveRow({ ...edited, overrides: { rank: 'chiefOfficer', nationality: 'Croatian' } }, context());
    expect(reverted).toMatchObject({ status: 'update', changes: [] });
    expect(resolveRow({ ...edited, overrides: {} }, context()).changes).toEqual([{ field: 'rank', from: 'chiefOfficer', to: 'master' }]);   // without them, as the file says
  });

  it('turns a new row into an update when a fixed passport number matches, and back again, with the file filling in the rest', () => {
    const rows = buildBrief(existing);
    const matched = fix(rows[2], { passportNo: '012345678' });
    expect(matched).toMatchObject({ status: 'update', existingId: existing[0].id });
    expect(matched.draft).toMatchObject({ passportNo: '012 345 678', nationality: 'Croatian', dateOfBirth: '1985-01-05', signOnDate: '2026-06-01' });
    expect(matched.changes.map(c => c.field)).toEqual(['surname', 'givenNames']);   // what the file says; its empty cells keep the contract's values
    const unmatched = fix(matched, { passportNo: 'ZZ9' });
    expect(unmatched.status).toBe('new');
    expect(unmatched).not.toHaveProperty('existingId');
    expect(unmatched.changes).toEqual([]);
    expect(unmatched.draft).toMatchObject({ nationality: '', signOnDate: '2026-10-25' });
  });

  it('takes a fixed field as it is on an update row: a cleared field stays cleared and shows as a change', () => {
    const [first] = buildBrief(existing);
    const cleared = fix(first, { nationality: '', placeOfBirth: '' });
    expect(cleared.status).toBe('update');
    expect(cleared.draft).toMatchObject({ nationality: '', placeOfBirth: '' });
    expect(cleared.changes).toEqual([
      { field: 'rank', from: 'chiefOfficer', to: 'master' },
      { field: 'nationality', from: 'Croatian', to: '' },
      { field: 'placeOfBirth', from: 'Split', to: '' },
    ]);
  });

  it('lets an update row switch to a rank "other": it keeps "other" and asks for the text, then lists the change', () => {
    const [first] = buildBrief(existing);
    const other = fix(first, { rank: 'other' });
    expect(other).toMatchObject({ status: 'error', draft: { rank: 'other' }, errors: [{ field: 'rank', message: 'Rank is required.' }] });
    const blank = fix(other, { rankOther: '' });
    expect(blank).toMatchObject({ status: 'error', draft: { rank: 'other', rankOther: '' }, errors: [{ field: 'rank', message: 'Rank is required.' }] });
    const named = fix(other, { rankOther: 'Pumpman' });
    expect(named).toMatchObject({ status: 'update', existingId: existing[0].id, draft: { rank: 'other', rankOther: 'Pumpman' }, errors: [] });
    expect(named.changes).toEqual([{ field: 'rank', from: 'chiefOfficer', to: 'other' }, { field: 'rankOther', from: '', to: 'Pumpman' }]);
  });

  it('drops the rank text of a row whose fixed rank does not use it', () => {
    const [row] = build({ rows: table(['Surname', 'Rank', 'Passport No'], ['A', 'Pumpman', 'P1']) });
    expect(row.draft).toMatchObject({ rank: 'other', rankOther: 'Pumpman' });
    expect(fix(row, { rank: 'ab' }).draft).not.toHaveProperty('rankOther');
  });

  it('lists no change for a passport or book number that only differs in spaces or case, and keeps the record\'s formatting', () => {
    const [first] = buildBrief(existing);
    const row = fix(first, { rank: 'chiefOfficer', passportNo: '012345678', seamansBookNo: 'SB998' });
    expect(row).toMatchObject({ status: 'update', changes: [], draft: { passportNo: '012 345 678', seamansBookNo: 'sb 998' } });
  });

  it('reports the fields the user left empty, rather than replacing them with the default sign-on date', () => {
    const rows = buildBrief();
    const cleared = fix(rows[2], { surname: '  ', signOnDate: '' }, { existing: [] });
    expect(cleared.status).toBe('error');
    expect(cleared.errors.map(e => [e.field, e.message])).toEqual([['surname', 'Surname is required.'], ['signOnDate', 'Sign-on date is required.']]);
  });

  it('asks for the rank text when the rank is "other" and the text is empty', () => {
    const rows = buildBrief();
    const other = fix(rows[2], { rank: 'other', rankOther: ' ' }, { existing: [] });
    expect(other).toMatchObject({ status: 'error', errors: [{ field: 'rank', message: 'Rank is required.' }] });
    expect(fix(other, { rankOther: 'Pumpman' }, { existing: [] })).toMatchObject({ status: 'new', errors: [] });
  });

  it('does not change the row it is given', () => {
    const rows = buildBrief(existing);
    const before = structuredClone(rows[0]);
    fix(rows[0], { rank: 'ab' });
    expect(rows[0]).toEqual(before);
  });

  describe('the default sign-on date', () => {
    const [row] = build({ rows: table(['Surname', 'Rank', 'Passport No', 'Date of birth'], ['Šašić', 'Master', 'P1', '31.02.1990']) });

    it('reaches a fixed new row, unless the user fixed the sign-on date too', () => {
      const fixed = fix(row, { dateOfBirth: '1990-02-28' });
      expect(fixed).toMatchObject({ status: 'new', draft: { signOnDate: '2026-10-25' } });
      expect(fix(fixed, {}, { defaultSignOnDate: '2026-11-01' }).draft.signOnDate).toBe('2026-11-01');
      const own = fix(fixed, { signOnDate: '2026-05-05' });
      expect(fix(own, {}, { defaultSignOnDate: '2026-11-01' }).draft.signOnDate).toBe('2026-05-05');
    });

    it('is not given to a row that updates a saved contract, which keeps its own sign-on date', () => {
      const [first] = buildBrief(existing);
      expect(fix(first, { nationality: 'Serbian' }, { defaultSignOnDate: '2026-11-01' }).draft.signOnDate).toBe('2026-06-01');
    });
  });

  describe('a passport fixed to that of the latest contract of a person who has had two', () => {
    const old = crewMember({
      surname: 'HORVAT', givenNames: 'Ana', dateOfBirth: '1977-07-07', passportNo: 'P1', passportExpiry: '2026-03-01', signOnPort: 'Rijeka',
      signOnDate: '2025-01-01', signOffDate: '2025-06-30', signOffPort: 'Koper', rank: 'master',
    });
    const current = crewMember({
      surname: 'HORVAT', givenNames: 'Ana', dateOfBirth: '1977-07-07', passportNo: 'P2', passportExpiry: '2035-12-31', signOnPort: 'Santos',
      signOnDate: '2026-06-01', rank: 'master',
    });
    const crew = [old, current];
    const HEADER_WITH_SIGN_OFF = ['Surname', 'Given names', 'Rank', 'Date of birth', 'Passport No', 'Sign off'];
    const ana = (...extra: Cell[]): PreviewRow => build({ rows: table(HEADER_WITH_SIGN_OFF, ['HORVAT', 'Ana', 'Master', '07.07.1977', 'P1', ...extra]), existing: crew })[0];

    it('is an update of the latest contract, written with the file\'s and the fixes\' values only, none of the earlier contract\'s', () => {
      const row = ana('30.09.2026');
      expect(row).toMatchObject({ status: 'update', existingId: old.id });                       // the file's passport belongs to the earlier contract
      expect(row.draft).toMatchObject({ passportExpiry: '2026-03-01', signOnPort: 'Rijeka' });   // and so its values fill the draft...
      const fixed = fix(row, { passportNo: 'P2', signOnDate: '2026-06-01' }, { existing: crew });
      expect(fixed).toMatchObject({ status: 'update', existingId: current.id, errors: [] });      // ...until the passport is fixed
      expect(fixed.draft).toMatchObject({ passportNo: 'P2', passportExpiry: '2035-12-31', signOnPort: 'Santos', signOnDate: '2026-06-01', signOffDate: '2026-09-30' });
      expect(fixed.draft.signOffPort).toBeUndefined();
      expect(fixed.changes).toEqual([{ field: 'signOffDate', from: '', to: '2026-09-30' }]);     // the sign-off of the file, and nothing of the old contract
    });

    it('resolves cleanly without a sign-off in the file, though the earlier contract had one', () => {
      const row = ana();
      expect(row.draft).toMatchObject({ signOnDate: '2025-01-01', signOffDate: '2025-06-30' });
      const fixed = fix(row, { passportNo: 'P2' }, { existing: crew });
      expect(fixed).toMatchObject({ status: 'update', existingId: current.id, errors: [], changes: [] });
      expect(fixed.draft).toMatchObject({ signOnDate: '2026-06-01', passportExpiry: '2035-12-31' });
      expect(fixed.draft.signOffDate).toBeUndefined();
      // The same with the sign-on fixed as well: nothing of the earlier contract's sign-off is left to run into it.
      expect(fix(row, { passportNo: 'P2', signOnDate: '2026-06-02' }, { existing: crew })).toMatchObject({ status: 'update', errors: [] });
    });
  });
});

describe('the contract length and planned relief of a matched contract', () => {
  // The sheet has no column for them: they are set on the crew form, and an import must leave them as they are.
  const planned = { contractMonths: 9, reliefPlannedDate: '2026-11-05', reliefPlannedPort: 'Santos' };
  const saved = crewMember({ ...planned });
  const context: ResolveContext = { existing: [saved], today: '2026-10-25', defaultSignOnDate: '2026-10-25' };
  const sheet = (...data: Cell[][]): PreviewRow[] => build({ rows: table(['Surname', 'Given names', 'Rank', 'Passport No'], ...data), existing: [saved] });

  it('are kept on the draft, and are not a change, when the row changes nothing about them', () => {
    const [row] = sheet(['PETROVIĆ', 'Ivan', 'C/O', '012345678']);
    expect(row).toMatchObject({ status: 'update', changes: [], draft: planned });
    expect(importPlan([row], [saved]).updates).toEqual([]);
  });

  it('are left out of the patch of an update that changes something else', () => {
    const [row] = sheet(['PETROVIĆ', 'Ivan', 'Master', '012345678']);
    expect(row.changes).toEqual([{ field: 'rank', from: 'chiefOfficer', to: 'master' }]);
    expect(row.draft).toMatchObject(planned);
    expect(importPlan([row], [saved]).updates).toEqual([{ id: saved.id, patch: { rank: 'master' } }]);
  });

  it('are kept when the row is worked out again with a fix or after the other rows are checked', () => {
    const [row] = sheet(['PETROVIĆ', 'Ivan', 'Master', '012345678']);
    const fixed = resolveRow({ ...row, overrides: { nationality: 'Serbian' } }, context);
    expect(fixed.changes.map(c => c.field)).toEqual(['rank', 'nationality']);
    expect(fixed.draft).toMatchObject(planned);
    const [rechecked] = recheckRows([fixed], context);
    expect(rechecked.changes.map(c => c.field)).toEqual(['rank', 'nationality']);
    expect(importPlan([rechecked], [saved]).updates[0].patch).toEqual({ rank: 'master', nationality: 'Serbian' });
  });

  it('are kept when a fix moves a new row onto the contract', () => {
    const [row] = sheet(['ŠAŠIĆ', 'Marko', 'C/O', 'P 77']);
    expect(row.status).toBe('new');
    expect(row.draft).not.toHaveProperty('contractMonths');
    const matched = resolveRow({ ...row, overrides: { passportNo: '012345678' } }, context);
    expect(matched).toMatchObject({ status: 'update', existingId: saved.id, draft: planned });
    expect(matched.changes.map(c => c.field)).toEqual(['surname', 'givenNames']);
  });

  it('are not added to a contract that has none', () => {
    const plain = crewMember();
    const [row] = build({ rows: table(['Surname', 'Given names', 'Rank', 'Passport No'], ['PETROVIĆ', 'Ivan', 'Master', '012345678']), existing: [plain] });
    expect(row.draft).not.toHaveProperty('contractMonths');
    expect(row.draft).not.toHaveProperty('reliefPlannedDate');
    expect(row.draft).not.toHaveProperty('reliefPlannedPort');
    expect(row.changes).toEqual([{ field: 'rank', from: 'chiefOfficer', to: 'master' }]);
  });
});

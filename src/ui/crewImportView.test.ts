import { describe, expect, it } from 'vitest';
import type { PreviewRow } from '../domain/crewImport/preview';
import type { CrewDraft } from '../domain/types';
import { crewFormOf } from './crewForm';
import {
  applyEdits, changeText, columnLabel, errorParts, firstSheetWithData, fullNameIgnored, hasEdits, headerRowMessage,
  importCount, overridesFromForm, parseHeaderRow, previewSummary, shownColumns, sheetSettings, statusText, withColumnField,
} from './crewImportView';

const DRAFT: CrewDraft = {
  surname: 'ŠAŠIĆ', givenNames: 'Marko', rank: 'master', nationality: 'Croatian', dateOfBirth: '1990-12-12', placeOfBirth: 'Split',
  passportNo: 'P77', passportExpiry: '2030-01-01', seamansBookNo: 'S1', seamansBookExpiry: '2030-01-01', signOnDate: '2026-10-25',
  signOnPort: 'Rijeka',
};

function row(over: Partial<PreviewRow> = {}): PreviewRow {
  return { rowNumber: 5, fileDraft: DRAFT, overrides: {}, status: 'new', draft: DRAFT, changes: [], errors: [], skip: false, ...over };
}
const update = (over: Partial<PreviewRow> = {}): PreviewRow => row({ status: 'update', existingId: 'crew-1', ...over });
const error = (over: Partial<PreviewRow> = {}): PreviewRow =>
  row({ status: 'error', errors: [{ field: 'rank', message: 'Rank is required.', severity: 'error' }], ...over });
const CHANGE = { field: 'rank' as const, from: 'chiefOfficer', to: 'master' };

describe('parseHeaderRow', () => {
  it('reads a whole number from 1 to the number of rows', () => {
    expect(parseHeaderRow('4', 9)).toBe(4);
    expect(parseHeaderRow(' 1 ', 9)).toBe(1);
    expect(parseHeaderRow('9', 9)).toBe(9);
    expect(parseHeaderRow('04', 9)).toBe(4);
  });

  it('refuses anything else', () => {
    for (const text of ['', '  ', '0', '10', '-1', '2.5', '4,5', 'four', '1e1', '+3', '1 2']) {
      expect(parseHeaderRow(text, 9), text).toBeUndefined();
    }
  });

  it('reads 4.0 as 4, since it is a whole number', () => {
    expect(parseHeaderRow('4.0', 9)).toBe(4);
  });

  it('has a message that names the number of rows', () => {
    expect(headerRowMessage(9)).toBe('Enter a row number between 1 and 9.');
  });
});

describe('sheetSettings', () => {
  const rows = [['CREW LIST'], ['MV OCEAN STAR'], [], ['No.', 'Surname', 'Given names', 'Rank', 'Date of birth', 'Passport No'], ['1', 'PETROVIĆ', 'Ivan', 'Master', '05.01.1985', '012345678']];

  it('finds the header row below the title rows and maps its columns by what they are called', () => {
    expect(sheetSettings(rows, undefined)).toEqual({
      headerRow: 3, headerText: '4', mapping: { surname: 1, givenNames: 2, rank: 3, dateOfBirth: 4, passportNo: 5 },
    });
  });

  it('applies the mapping saved with the ship over the guess, by header text', () => {
    const saved = { byHeader: { no: 'seamansBookNo' as const, passportno: 'seamansBookExpiry' as const }, dateFormat: 'year-first' as const };
    expect(sheetSettings(rows, saved).mapping).toEqual({ seamansBookNo: 0, surname: 1, givenNames: 2, rank: 3, dateOfBirth: 4, seamansBookExpiry: 5 });
  });

  it('starts an empty sheet at row 1 with nothing mapped', () => {
    expect(sheetSettings([], undefined)).toEqual({ headerRow: 0, headerText: '1', mapping: {} });
  });
});

describe('withColumnField', () => {
  it('maps a field to a column, and takes it away from the column it was on', () => {
    expect(withColumnField({ surname: 0, rank: 2 }, 1, 'surname')).toEqual({ surname: 1, rank: 2 });
  });

  it('gives a column one field only: the field it had before is let go', () => {
    expect(withColumnField({ surname: 0, rank: 2 }, 0, 'rank')).toEqual({ rank: 0 });
  });

  it('ignores a column when no field is chosen, and leaves the others alone', () => {
    expect(withColumnField({ surname: 0, rank: 2 }, 2, undefined)).toEqual({ surname: 0 });
    expect(withColumnField({ surname: 0 }, 5, undefined)).toEqual({ surname: 0 });
  });

  it('does not change the mapping it is given', () => {
    const mapping = { surname: 0 };
    withColumnField(mapping, 1, 'surname');
    expect(mapping).toEqual({ surname: 0 });
  });
});

describe('fullNameIgnored', () => {
  it('is true when the full name is mapped together with the surname or the given names', () => {
    expect(fullNameIgnored({ fullName: 0, surname: 1 })).toBe(true);
    expect(fullNameIgnored({ fullName: 0, givenNames: 1 })).toBe(true);
    expect(fullNameIgnored({ fullName: 0, surname: 1, givenNames: 2 })).toBe(true);
  });

  it('is false when it is the only name column, or not mapped', () => {
    expect(fullNameIgnored({ fullName: 0 })).toBe(false);
    expect(fullNameIgnored({ surname: 1, givenNames: 2 })).toBe(false);
    expect(fullNameIgnored({})).toBe(false);
  });
});

describe('columns', () => {
  const rows = [['Crew list'], ['No.', 'Surname', null, '', 'Notes'], ['1', 'PETROVIĆ', null, null, null, 'x'], ['2', 'HORVAT']];

  it('are labelled by their header text, or by their letter when the header is empty', () => {
    expect(columnLabel(rows[1], 1)).toBe('Surname');
    expect(columnLabel(rows[1], 2)).toBe('Column C');
    expect(columnLabel(rows[1], 5)).toBe('Column F');
    expect(columnLabel(undefined, 0)).toBe('Column A');
    expect(columnLabel([...Array(26).fill(null), ''], 26)).toBe('Column AA');
  });

  it('shown are those with a header or with data below it', () => {
    expect(shownColumns(rows, 1)).toEqual([0, 1, 4, 5]);
  });

  it('shown are none for a sheet with no rows', () => {
    expect(shownColumns([], 0)).toEqual([]);
  });
});

describe('firstSheetWithData', () => {
  it('is the first sheet that has any cell with content, else the first', () => {
    expect(firstSheetWithData([{ name: 'Cover', rows: [] }, { name: 'Crew', rows: [[null, '']] }, { name: 'Crew 2', rows: [['A']] }])).toBe(2);
    expect(firstSheetWithData([{ name: 'A', rows: [['x']] }, { name: 'B', rows: [['y']] }])).toBe(0);
    expect(firstSheetWithData([{ name: 'A', rows: [] }, { name: 'B', rows: [[null]] }])).toBe(0);
  });
});

describe('statusText', () => {
  it('names the status, and an update that changes nothing as "No changes"', () => {
    expect(statusText(row())).toBe('New');
    expect(statusText(update({ changes: [CHANGE] }))).toBe('Update');
    expect(statusText(update())).toBe('No changes');
    expect(statusText(error())).toBe('Error');
  });
});

describe('changeText', () => {
  it('shows the field with the old and the new value', () => {
    expect(changeText({ field: 'passportExpiry', from: '2027-01-01', to: '2028-01-01' })).toBe('Passport expiry: 2027-01-01 → 2028-01-01');
    expect(changeText({ field: 'seamansBookNo', from: 'sb 1', to: 'SB 2' })).toBe("Seaman's book no.: sb 1 → SB 2");
  });

  it('writes a dash for an empty value', () => {
    expect(changeText({ field: 'signOffDate', from: '', to: '2026-09-30' })).toBe('Sign-off date: — → 2026-09-30');
    expect(changeText({ field: 'nationality', from: 'Croatian', to: '' })).toBe('Nationality: Croatian → —');
  });

  it('writes a rank by its label', () => {
    expect(changeText(CHANGE)).toBe('Rank: Chief Officer → Master');
    expect(changeText({ field: 'rank', from: 'other', to: 'fitter' })).toBe('Rank: Other → Fitter');
    expect(changeText({ field: 'rankOther', from: 'Pumpman', to: 'Pump man' })).toBe('Rank (other): Pumpman → Pump man');
  });
});

describe('errorParts', () => {
  const draft = { ...DRAFT, dateOfBirth: '31.02.1990' };

  it('names the field with the text that was read, so the user can find it in the sheet', () => {
    expect(errorParts({ field: 'dateOfBirth', message: 'Enter a valid date.', severity: 'error' }, draft))
      .toEqual({ label: 'Date of birth “31.02.1990”', message: 'Enter a valid date.' });
  });

  it('names the field without a value when the field is empty or the problem is not about the text', () => {
    expect(errorParts({ field: 'signOnDate', message: 'Enter a valid date.', severity: 'error' }, { ...draft, signOnDate: '' }))
      .toEqual({ label: 'Sign-on date', message: 'Enter a valid date.' });
    expect(errorParts({ field: 'passportNo', message: 'Duplicate passport number in this file.', severity: 'error' }, draft))
      .toEqual({ label: 'Passport no.', message: 'Duplicate passport number in this file.' });
  });

  it('adds no name to a message that starts with it', () => {
    expect(errorParts({ field: 'surname', message: 'Surname is required.', severity: 'error' }, draft)).toEqual({ message: 'Surname is required.' });
    expect(errorParts({ field: 'rank', message: 'Rank is required.', severity: 'error' }, draft)).toEqual({ message: 'Rank is required.' });
    expect(errorParts({ field: 'dateOfBirth', message: 'Date of birth must be in the past.', severity: 'error' }, draft))
      .toEqual({ message: 'Date of birth must be in the past.' });
  });

  it('shows a field it does not know by its key', () => {
    expect(errorParts({ field: 'colour', message: 'Odd.', severity: 'error' }, draft)).toEqual({ label: 'colour', message: 'Odd.' });
  });
});

describe('previewSummary', () => {
  it('counts the rows by what will happen to them', () => {
    const rows = [row(), row(), update({ changes: [CHANGE] }), update(), update(), error(), error(), error()];
    expect(previewSummary(rows)).toBe('2 new, 1 to update, 2 without changes, 3 errors');
  });

  it('counts a skipped row as skipped only', () => {
    expect(previewSummary([row(), error({ skip: true }), update({ skip: true })])).toBe('1 new, 2 skipped');
  });

  it('leaves out what is zero, and says "1 error" in the singular', () => {
    expect(previewSummary([error()])).toBe('1 error');
    expect(previewSummary([row()])).toBe('1 new');
    expect(previewSummary([])).toBe('');
  });
});

describe('importCount', () => {
  it('counts the new rows and the updates with changes that are not skipped and have no error', () => {
    const rows = [row(), update(), update({ changes: [CHANGE] }), error(), row({ skip: true }), update({ changes: [CHANGE], skip: true })];
    expect(importCount(rows)).toBe(2);
    expect(importCount([])).toBe(0);
  });
});

describe('hasEdits', () => {
  it('is true once a row is skipped or has a draft of its own', () => {
    expect(hasEdits({ 3: { skip: true } })).toBe(true);
    expect(hasEdits({ 3: { overrides: { surname: 'HORVAT' } } })).toBe(true);
    expect(hasEdits({ 3: { skip: false, overrides: { surname: 'HORVAT' } } })).toBe(true);
  });

  it('is false for nothing, and for a skip that was undone', () => {
    expect(hasEdits({})).toBe(false);
    expect(hasEdits({ 3: { skip: false } })).toBe(false);
    expect(hasEdits({ 3: { overrides: {} } })).toBe(false);
  });
});

describe('applyEdits', () => {
  const rows = [row({ rowNumber: 3 }), error({ rowNumber: 4 })];

  it('sets the skip flag and the fixes of the rows that were edited, by row number', () => {
    const result = applyEdits(rows, { 3: { skip: true }, 4: { overrides: { surname: 'HORVAT' } } });
    expect(result[0]).toMatchObject({ rowNumber: 3, skip: true, overrides: {}, draft: DRAFT });
    expect(result[1]).toMatchObject({ rowNumber: 4, skip: false, overrides: { surname: 'HORVAT' } });
  });

  it('returns the rows as they are when nothing was edited, and does not change them', () => {
    expect(applyEdits(rows, {})).toEqual(rows);
    applyEdits(rows, { 3: { skip: true, overrides: { surname: 'HORVAT' } } });
    expect(rows[0]).toMatchObject({ skip: false, overrides: {} });
  });

  it('lets a skip flag that was undone go back to false', () => {
    expect(applyEdits([row({ rowNumber: 3, skip: true })], { 3: { skip: false } })[0].skip).toBe(false);
  });
});

describe('overridesFromForm', () => {
  const draft = { ...DRAFT, signOffDate: '2026-12-01', signOffPort: 'Koper' };

  it('is nothing for a form that was not changed', () => {
    expect(overridesFromForm(draft, crewFormOf(draft))).toEqual({});
  });

  it('holds only the fields whose text changed, trimmed, and not the sign-off the form cannot show', () => {
    const form = { ...crewFormOf(draft), surname: ' HORVAT ', placeOfBirth: 'Zadar', nationality: 'Croatian' };
    expect(overridesFromForm(draft, form)).toEqual({ surname: 'HORVAT', placeOfBirth: 'Zadar' });   // the nationality was that already
  });

  it('does not hold a field that was changed and changed back', () => {
    const touched = { ...crewFormOf(draft), surname: 'HORVAT' };
    expect(overridesFromForm(draft, { ...touched, surname: 'ŠAŠIĆ' })).toEqual({});
  });

  it('holds an emptied field, as an empty text', () => {
    expect(overridesFromForm(draft, { ...crewFormOf(draft), nationality: '' })).toEqual({ nationality: '' });
  });

  it('holds a new rank, and the rank text only for the rank "other"', () => {
    const pumpman = { ...draft, rank: 'other' as const, rankOther: 'Pumpman' };
    expect(overridesFromForm(pumpman, { ...crewFormOf(pumpman), rank: 'ab' })).toEqual({ rank: 'ab' });
    expect(overridesFromForm(pumpman, { ...crewFormOf(pumpman), rankOther: ' Pump man ' })).toEqual({ rankOther: 'Pump man' });
    expect(overridesFromForm(draft, { ...crewFormOf(draft), rank: 'other', rankOther: 'Pumpman' })).toEqual({ rank: 'other', rankOther: 'Pumpman' });
  });

  it('does not hold the contract length and planned relief of an updated contract, which the fix form cannot change', () => {
    const planned = { ...draft, contractMonths: 9, reliefPlannedDate: '2026-11-05', reliefPlannedPort: 'Santos' };
    expect(overridesFromForm(planned, crewFormOf(planned))).toEqual({});
    expect(overridesFromForm(planned, { ...crewFormOf(planned), surname: 'HORVAT' })).toEqual({ surname: 'HORVAT' });
  });

  it('is undefined while no rank is chosen', () => {
    expect(overridesFromForm(draft, { ...crewFormOf(draft), rank: '' })).toBeUndefined();
  });
});

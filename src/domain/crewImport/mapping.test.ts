import { describe, expect, it } from 'vitest';
import type { CrewImportMapping } from '../types';
import { applySavedMapping, guessMapping, toSavedMapping } from './mapping';

describe('guessMapping', () => {
  it('maps each recognised header to its column', () => {
    expect(guessMapping(['No.', 'Surname', 'Given names', 'Rank', 'Nationality', 'Date of birth', 'Passport No', 'Passport expiry', "Seaman's book No.", 'Sign on']))
      .toEqual({ surname: 1, givenNames: 2, rank: 3, nationality: 4, dateOfBirth: 5, passportNo: 6, passportExpiry: 7, seamansBookNo: 8, signOnDate: 9 });
    expect(guessMapping(['Name', 'Rank'])).toEqual({ fullName: 0, rank: 1 });
  });

  it('never maps two columns to one field: the first matching column wins', () => {
    // "Passport issue date" starts with the synonym "passport", so matchHeader reports passportNo for it too.
    expect(guessMapping(['Passport No', 'Passport issue date'])).toEqual({ passportNo: 0 });
    expect(guessMapping(['Passport issue date', 'Passport No'])).toEqual({ passportNo: 0 });
    expect(guessMapping(['Rank', 'Position', 'Rank'])).toEqual({ rank: 0 });
  });

  it('skips blank, numeric and unrecognised header cells', () => {
    expect(guessMapping([null, 7, '', 'Remarks', new Date(Date.UTC(1985, 0, 5)), 'Rank'])).toEqual({ rank: 5 });
    expect(guessMapping([])).toEqual({});
  });

  it('treats a missing header (the row of an empty sheet) as an empty one', () => {
    expect(guessMapping(undefined)).toEqual({});
  });
});

describe('toSavedMapping', () => {
  it('stores each mapped column under its normalised header, with the date format', () => {
    expect(toSavedMapping(['Prezime', "Seaman's Book No.", 'Rank'], { surname: 0, seamansBookNo: 1, rank: 2 }, 'year-first'))
      .toEqual({ byHeader: { prezime: 'surname', seamansbookno: 'seamansBookNo', rank: 'rank' }, dateFormat: 'year-first' });
  });

  it('leaves out columns without header text and columns outside the header', () => {
    expect(toSavedMapping(['Rank', null, ''], { rank: 0, surname: 1, givenNames: 2, nationality: 9 }, 'day-first'))
      .toEqual({ byHeader: { rank: 'rank' }, dateFormat: 'day-first' });
  });
});

describe('toSavedMapping, columns that were ignored', () => {
  const header = ['No.', 'Surname', 'Given names', 'Rank', 'Date of birth', 'Passport No'];

  it('remembers a column that the header would be mapped from but was left out, by its normalised header', () => {
    const mapping = { surname: 1, givenNames: 2, rank: 3, passportNo: 5 }; // the date of birth column was set to "— ignore —"
    expect(toSavedMapping(header, mapping, 'day-first')).toEqual({
      byHeader: { surname: 'surname', givennames: 'givenNames', rank: 'rank', passportno: 'passportNo' },
      dateFormat: 'day-first',
      ignored: ['dateofbirth'],
    });
  });

  it('lists them in the order of the columns, whatever the header text looks like', () => {
    expect(toSavedMapping(['Passport No.', 'Date of Birth', "Seaman's Book No."], { dateOfBirth: 1 }, 'day-first').ignored)
      .toEqual(['passportno', 'seamansbookno']);
  });

  it('does not list a column that was never recognised, one that is mapped, or one without header text', () => {
    expect(toSavedMapping(header, { surname: 1, givenNames: 2, rank: 3, dateOfBirth: 4, passportNo: 5 }, 'day-first')).not.toHaveProperty('ignored');
    expect(toSavedMapping(['Remarks', null, '', 'Rank'], { rank: 3 }, 'day-first')).not.toHaveProperty('ignored');
  });

  it('does not list a column whose header is also the header of a column that is mapped', () => {
    expect(toSavedMapping(['Rank', 'Rank'], { rank: 1 }, 'day-first')).not.toHaveProperty('ignored');
  });

  it('counts a column whose field moved to another column as ignored', () => {
    expect(toSavedMapping(['Surname', 'Prezime'], { surname: 1 }, 'day-first'))
      .toEqual({ byHeader: { prezime: 'surname' }, dateFormat: 'day-first', ignored: ['surname'] });
  });

  it('lists a header once', () => {
    expect(toSavedMapping(['Rank', 'Passport No', 'Passport no.'], { rank: 0 }, 'day-first').ignored).toEqual(['passportno']);
  });
});

describe('applySavedMapping', () => {
  it('leaves a column unmapped when the saved mapping says it was ignored, instead of guessing it again', () => {
    const header = ['No.', 'Surname', 'Rank', 'Date of birth'];
    const saved = toSavedMapping(header, { surname: 1, rank: 2 }, 'day-first');
    expect(saved.ignored).toEqual(['dateofbirth']);
    expect(applySavedMapping(header, saved)).toEqual({ surname: 1, rank: 2 });
    expect(applySavedMapping(['Date of birth', 'Rank', 'Surname'], saved)).toEqual({ rank: 1, surname: 2 }); // the columns moved
    expect(applySavedMapping(header, { ...saved, ignored: undefined })).toEqual({ surname: 1, rank: 2, dateOfBirth: 3 });
  });

  it('lets a saved entry for the same header win over the ignored list', () => {
    const saved: CrewImportMapping = { byHeader: { rank: 'rank' }, dateFormat: 'day-first', ignored: ['rank'] };
    expect(applySavedMapping(['Rank'], saved)).toEqual({ rank: 0 });
  });

  it('ignores an ignored list that is not a list of texts', () => {
    const header = ['Surname', 'Rank'];
    for (const ignored of [null, 'rank', { rank: true }, [1, null, {}]]) {
      const saved = { byHeader: {}, dateFormat: 'day-first', ignored } as unknown as CrewImportMapping;
      expect(applySavedMapping(header, saved)).toEqual({ surname: 0, rank: 1 });
    }
  });

  it('keeps ignoring a column that is ignored twice in a row, and takes a column back when it is mapped again', () => {
    const header = ['Surname', 'Rank', 'Date of birth'];
    const first = toSavedMapping(header, { surname: 0, rank: 1 }, 'day-first');
    const second = toSavedMapping(header, applySavedMapping(header, first), 'day-first');
    expect(second).toEqual(first);
    const taken = toSavedMapping(header, { surname: 0, rank: 1, dateOfBirth: 2 }, 'day-first');
    expect(taken).not.toHaveProperty('ignored');
    expect(applySavedMapping(header, taken)).toEqual({ surname: 0, rank: 1, dateOfBirth: 2 });
  });

  it('finds the saved fields again when the columns have moved', () => {
    const saved = toSavedMapping(['Prezime', 'Rank'], { surname: 0, rank: 1 }, 'day-first');
    expect(applySavedMapping(['Rank', 'Prezime'], saved)).toEqual({ rank: 0, surname: 1 });
  });

  it('is just the guess when nothing is saved', () => {
    expect(applySavedMapping(['Surname', 'Rank'], undefined)).toEqual({ surname: 0, rank: 1 });
  });

  it('lets a saved entry override the guess, without leaving the column mapped twice', () => {
    const saved: CrewImportMapping = { byHeader: { name: 'surname' }, dateFormat: 'day-first' };
    expect(applySavedMapping(['Name', 'Rank'], saved)).toEqual({ surname: 0, rank: 1 });
  });

  it('moves a field to the saved column when the guess had picked another one', () => {
    const saved: CrewImportMapping = { byHeader: { prezime: 'surname' }, dateFormat: 'day-first' };
    expect(applySavedMapping(['Surname', 'Prezime'], saved)).toEqual({ surname: 1 });
  });

  it('maps a saved field only once, to its first column', () => {
    const saved: CrewImportMapping = { byHeader: { prezime: 'surname' }, dateFormat: 'day-first' };
    expect(applySavedMapping(['Prezime', 'Prezime'], saved)).toEqual({ surname: 0 });
  });

  it('treats a missing header as an empty one', () => {
    const saved: CrewImportMapping = { byHeader: { prezime: 'surname' }, dateFormat: 'day-first' };
    expect(applySavedMapping(undefined, saved)).toEqual({});
    expect(applySavedMapping(undefined, undefined)).toEqual({});
  });

  it('treats a saved mapping without byHeader as having no entries', () => {
    const saved = { dateFormat: 'day-first' } as unknown as CrewImportMapping;
    expect(applySavedMapping(['Surname', 'Rank'], saved)).toEqual({ surname: 0, rank: 1 });
    expect(applySavedMapping(['Surname'], { byHeader: null, dateFormat: 'day-first' } as unknown as CrewImportMapping)).toEqual({ surname: 0 });
  });

  it('ignores saved entries that are not own properties or not crew fields', () => {
    const saved = { byHeader: { rank: 'nonsense' }, dateFormat: 'day-first' } as unknown as CrewImportMapping;
    expect(applySavedMapping(['Constructor', 'ToString', 'Rank'], saved)).toEqual({ rank: 2 });
  });
});

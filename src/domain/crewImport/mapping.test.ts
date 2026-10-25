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

describe('applySavedMapping', () => {
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

  it('ignores saved entries that are not own properties or not crew fields', () => {
    const saved = { byHeader: { rank: 'nonsense' }, dateFormat: 'day-first' } as unknown as CrewImportMapping;
    expect(applySavedMapping(['Constructor', 'ToString', 'Rank'], saved)).toEqual({ rank: 2 });
  });
});

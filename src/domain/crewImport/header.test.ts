import { describe, expect, it } from 'vitest';
import type { CrewField } from '../types';
import { detectHeaderRow, HEADER_SYNONYMS, matchHeader, normaliseHeader } from './header';

describe('normaliseHeader', () => {
  it('lowercases, drops diacritics and removes everything but letters and digits', () => {
    expect(normaliseHeader("Seaman's Book No.")).toBe('seamansbookno');
    expect(normaliseHeader('Date of Birth (DD.MM.YYYY)')).toBe('dateofbirthddmmyyyy');
    expect(normaliseHeader('Državljanstvo Šašić')).toBe('drzavljanstvosasic');
  });

  it('turns non-text cells into something harmless', () => {
    expect(normaliseHeader(null)).toBe('');
    expect(normaliseHeader(7)).toBe('7');
    expect(normaliseHeader(new Date(Date.UTC(1985, 0, 5)))).toBe('');
  });
});

describe('HEADER_SYNONYMS', () => {
  const fields = Object.keys(HEADER_SYNONYMS) as CrewField[];

  it('are already normalised', () => {
    for (const field of fields) for (const synonym of HEADER_SYNONYMS[field]) expect(normaliseHeader(synonym)).toBe(synonym);
  });

  it('never claim the same header for two fields', () => {
    const all = fields.flatMap(f => HEADER_SYNONYMS[f]);
    expect(new Set(all).size).toBe(all.length);
  });

  it('map to their own field when matched exactly', () => {
    for (const field of fields) for (const synonym of HEADER_SYNONYMS[field]) expect(matchHeader(synonym)).toBe(field);
  });
});

describe('matchHeader', () => {
  it('matches a synonym ignoring case, punctuation and diacritics', () => {
    expect(matchHeader('Passport No.')).toBe('passportNo');
    expect(matchHeader('Nationality')).toBe('nationality');
    expect(matchHeader('Seaman’s Book')).toBe('seamansBookNo');
    expect(matchHeader('FAMILY NAME')).toBe('surname');
  });

  it('prefers the exact synonym over a shorter prefix', () => {
    expect(matchHeader('Passport expiry date')).toBe('passportExpiry');
    expect(matchHeader('Sign on port')).toBe('signOnPort');
    expect(matchHeader('Sign on date')).toBe('signOnDate');
  });

  it('accepts a header that starts with a synonym of at least 4 characters', () => {
    expect(matchHeader('Date of Birth (DD.MM.YYYY)')).toBe('dateOfBirth');
    expect(matchHeader('Rank on board')).toBe('rank');
    expect(matchHeader('Sign on port (UN/LOCODE)')).toBe('signOnPort');
  });

  it('does not prefix-match synonyms shorter than 4 characters', () => {
    expect(matchHeader('DOB')).toBe('dateOfBirth');
    expect(matchHeader('DOBX')).toBeUndefined();
    expect(matchHeader('CDC123')).toBeUndefined();
  });

  it('returns undefined for anything else', () => {
    expect(matchHeader('Remarks')).toBeUndefined();
    expect(matchHeader('')).toBeUndefined();
    expect(matchHeader(null)).toBeUndefined();
    expect(matchHeader(42)).toBeUndefined();
    expect(matchHeader(true)).toBeUndefined();
  });
});

describe('detectHeaderRow', () => {
  it('skips title rows above the header', () => {
    expect(detectHeaderRow([
      ['CREW LIST'],
      ['MV OCEAN STAR', null, 'IMO 9074729'],
      [],
      ['No.', 'Surname', 'Given names', 'Rank', 'Nationality', 'Passport No'],
      ['1', 'PETROVIĆ', 'Ivan', 'Master', 'Serbian', '012345678'],
    ])).toBe(3);
  });

  it('needs at least 3 recognised cells', () => {
    const rows = [['Surname', 'Rank'], ['Surname', 'Rank', 'Nationality']];
    expect(detectHeaderRow(rows)).toBe(1);
  });

  it('falls back to the first non-empty row', () => {
    expect(detectHeaderRow([[], ['foo', 'bar'], ['1', '2']])).toBe(1);
    expect(detectHeaderRow([[null, ''], ['  ', null], ['foo']])).toBe(2);
  });

  it('only looks at the first 15 rows for a header', () => {
    const filler = Array.from({ length: 15 }, () => ['x']);
    expect(detectHeaderRow([...filler, ['Surname', 'Rank', 'Nationality']])).toBe(0);
    expect(detectHeaderRow([...filler.slice(1), ['Surname', 'Rank', 'Nationality']])).toBe(14);
  });

  it('returns 0 when there is nothing to find', () => {
    expect(detectHeaderRow([])).toBe(0);
    expect(detectHeaderRow([[], [null]])).toBe(0);
  });
});

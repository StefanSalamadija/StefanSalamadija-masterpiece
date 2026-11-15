import { describe, expect, it } from 'vitest';
import { detectHeaderRow, matchHeader, normaliseHeader } from './header';
import { applySavedMapping, guessMapping, toSavedMapping } from './mapping';
import { buildPreview } from './preview';
import type { Cell } from './readSpreadsheet';
import { splitFullName } from './values';

// The layout of an IMO FAL crew list kept in Excel: a title, a ship block, numbered headings that cover two columns,
// then the crew. Every name and number here is made up.
const header: Cell[] = [null, '7. No.', '8. Family name, given names', '9.Rank or rating', '10. Nationality and Sex', null,
  '11. Date and place of birth', null, '12. Passport No. & Expiry date', null, "13. Seaman's Book No. & Expiry date", null,
  '14. Date & Place of Join', null];
const rows: Cell[][] = [
  [null, null, null, null, null, null, 'IMO CREW LIST'],
  [null, '1. Name of Ship', null, null, '2. Port of Arrival / Departure', null, null, null, '3. Date of Arrival / Departure', null, null, null, 'IMO no.'],
  [null, null, 'TEST VESSEL', null, null, null, 'SOMEPORT', null, null, null, null, null, '1234567'],
  [null, '4. Nationality of ship', null, null, '5. Port arrived from', null, null, null, '6. Port of destination', null, null, null, 'Call Sign'],
  header,
  [null, 1, 'TESTMAN ALAN BRIAN', 'Master', 'FILIPINO', 'Male', '30.07.1974', 'TESTCITY', 'P1234567A', '04.01.2028', 'A0000001', '22.10.2036', '28.10.2026', 'SINGAPORE'],
  [null, 2, 'DE TESTA CARLO', 'Chief Officer', 'MONTENEGRIN', 'Male', '11.04.1994', 'KOTOR', 'P7000002', '28.08.2034', '0000002', '23.08.2034', '13.11.2026', 'ESPERANCE'],
  [null, 3, 'DELA PRUEBA DAN EVO', 'Bosun', 'FILIPINO', 'Male', '20.06.1981', 'SAMPLE CITY', 'P0000003B', '14.02.2029', 'A0000003', '13.03.2031', '12.10.2026', 'FANGCHENG'],
];

describe('IMO FAL crew list', () => {
  it('reads numbered headings', () => {
    expect(normaliseHeader('8. Family name, given names')).toBe('familynamegivennames');
    expect(normaliseHeader('9.Rank or rating')).toBe('rankorrating');
    expect(normaliseHeader('10) Nationality')).toBe('nationality');
    expect(normaliseHeader('2026 crew')).toBe('2026crew');
    expect(matchHeader('9.Rank or rating')).toBe('rank');
  });

  it('finds the header row below the ship block', () => {
    expect(detectHeaderRow(rows)).toBe(4);
  });

  it('maps both columns of a paired heading', () => {
    expect(guessMapping(header)).toEqual({
      fullName: 2, rank: 3, nationality: 4, dateOfBirth: 6, placeOfBirth: 7, passportNo: 8, passportExpiry: 9,
      seamansBookNo: 10, seamansBookExpiry: 11, signOnDate: 12, signOnPort: 13,
    });
  });

  it('does not give the second field to a next column that has a heading of its own', () => {
    expect(guessMapping(['Date and place of birth', 'Rank', 'Name'])).toEqual({ dateOfBirth: 0, rank: 1, fullName: 2 });
  });

  it('matches short heading words exactly only (review)', () => {
    expect(matchHeader('Post code')).toBeUndefined();
    expect(matchHeader('Duty free')).toBeUndefined();
    expect(matchHeader('Post')).toBe('rank');
  });

  it('keeps the second column of an ignored paired heading ignored (review)', () => {
    const head: Cell[] = ['Name', 'Rank', 'Date and place of birth', null];
    const saved = toSavedMapping(head, { fullName: 0, rank: 1 }, 'day-first');
    expect(applySavedMapping(head, saved)).toEqual({ fullName: 0, rank: 1 });
  });

  it('knows more heading words of home-made lists', () => {
    expect(guessMapping(['Crew name', 'Duty', 'Nat.', 'Pass. No', 'Date of join', 'Place of join'])).toEqual({
      fullName: 0, rank: 1, nationality: 2, passportNo: 3, signOnDate: 4, signOnPort: 5,
    });
  });

  it('splits surname-first names after the surname, particles included', () => {
    expect(splitFullName('TESTMAN ALAN BRIAN', true)).toEqual({ surname: 'TESTMAN', givenNames: 'ALAN BRIAN' });
    expect(splitFullName('DE TESTA CARLO', true)).toEqual({ surname: 'DE TESTA', givenNames: 'CARLO' });
    expect(splitFullName('DE LA PRUEBA ANA', true)).toEqual({ surname: 'DE LA PRUEBA', givenNames: 'ANA' });
    expect(splitFullName('Testova Ana', true)).toEqual({ surname: 'Testova', givenNames: 'Ana' });
    expect(splitFullName('Testova, Ana Maria', true)).toEqual({ surname: 'Testova', givenNames: 'Ana Maria' });
    expect(splitFullName('SOLO', true)).toEqual({ surname: 'SOLO', givenNames: '' });
    // Only real particles, never the last word (review): Vietnamese and Chinese names stay as written.
    expect(splitFullName('LE VAN THANH', true)).toEqual({ surname: 'LE', givenNames: 'VAN THANH' });
    expect(splitFullName('LE THI HOA', true)).toEqual({ surname: 'LE', givenNames: 'THI HOA' });
    expect(splitFullName('DU WEI', true)).toEqual({ surname: 'DU', givenNames: 'WEI' });
    expect(splitFullName('DE LOS SANTOS JUAN', true)).toEqual({ surname: 'DE LOS SANTOS', givenNames: 'JUAN' });
    expect(splitFullName('DA SILVA JOAO', true)).toEqual({ surname: 'DA SILVA', givenNames: 'JOAO' });
    expect(splitFullName('DE TESTA', true)).toEqual({ surname: 'DE', givenNames: 'TESTA' });
    // Other headings keep the rule they had.
    expect(splitFullName('TESTMAN Alan')).toEqual({ surname: 'TESTMAN', givenNames: 'Alan' });
  });

  it('previews every person with all their fields', () => {
    const preview = buildPreview({
      rows, headerRow: 4, mapping: guessMapping(header), dateFormat: 'day-first', existing: [],
      currentYear: 2026, today: '2026-11-15', defaultSignOnDate: '2026-11-15',
    });
    expect(preview.map((r) => [r.draft.surname, r.draft.givenNames])).toEqual([
      ['TESTMAN', 'ALAN BRIAN'], ['DE TESTA', 'CARLO'], ['DELA PRUEBA', 'DAN EVO'],
    ]);
    expect(preview[1].draft).toMatchObject({
      nationality: 'MONTENEGRIN', dateOfBirth: '1994-04-11', placeOfBirth: 'KOTOR', passportNo: 'P7000002',
      passportExpiry: '2034-08-28', seamansBookNo: '0000002', seamansBookExpiry: '2034-08-23', signOnDate: '2026-11-13', signOnPort: 'ESPERANCE',
    });
  });
});

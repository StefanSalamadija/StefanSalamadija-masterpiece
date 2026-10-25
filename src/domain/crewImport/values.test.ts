import { describe, expect, it } from 'vitest';
import type { RankKey } from '../types';
import { cellText, parseDateCell, parseRank, splitFullName } from './values';

describe('parseDateCell', () => {
  it('reads day-first dates written with dots, slashes, dashes or month names', () => {
    expect(parseDateCell('05.01.1985', 'day-first', 2026)).toBe('1985-01-05');
    expect(parseDateCell('5/1/85', 'day-first', 2026)).toBe('1985-01-05');
    expect(parseDateCell('05/01/30', 'day-first', 2026)).toBe('2030-01-05');
    expect(parseDateCell('5-1-1985', 'day-first', 2026)).toBe('1985-01-05');
    expect(parseDateCell('05-JAN-1985', 'day-first', 2026)).toBe('1985-01-05');
    expect(parseDateCell('5-jan-85', 'day-first', 2026)).toBe('1985-01-05');
    expect(parseDateCell('5-Dec-2026', 'day-first', 2026)).toBe('2026-12-05');
  });

  it('reads year-first dates in both modes', () => {
    expect(parseDateCell('1985-01-05', 'day-first', 2026)).toBe('1985-01-05');
    expect(parseDateCell('1985/1/5', 'year-first', 2026)).toBe('1985-01-05');
    expect(parseDateCell('1985-01-05', 'year-first', 2026)).toBe('1985-01-05');
    expect(parseDateCell('1985/1/5', 'day-first', 2026)).toBe('1985-01-05');
    expect(parseDateCell('1985.01.05', 'year-first', 2026)).toBe('1985-01-05');
  });

  it('does not guess a day-first date in year-first mode', () => {
    expect(parseDateCell('05.01.1985', 'year-first', 2026)).toBe('invalid');
    expect(parseDateCell('5-jan-85', 'year-first', 2026)).toBe('invalid');
  });

  it('turns a two-digit year into 20yy up to 15 years past the current year, otherwise 19yy', () => {
    expect(parseDateCell('05/01/41', 'day-first', 2026)).toBe('2041-01-05');
    expect(parseDateCell('05/01/42', 'day-first', 2026)).toBe('1942-01-05');
    expect(parseDateCell('05/01/00', 'day-first', 2026)).toBe('2000-01-05');
    expect(parseDateCell('05/01/99', 'day-first', 2026)).toBe('1999-01-05');
  });

  it('reads Excel serial numbers and UTC dates', () => {
    expect(parseDateCell(31052, 'day-first', 2026)).toBe('1985-01-05');
    expect(parseDateCell(31052.75, 'day-first', 2026)).toBe('1985-01-05');
    expect(parseDateCell(new Date(Date.UTC(1985, 0, 5)), 'day-first', 2026)).toBe('1985-01-05');
    expect(parseDateCell(new Date(Date.UTC(1985, 0, 5, 23, 59)), 'year-first', 2026)).toBe('1985-01-05');
  });

  it('accepts serial numbers from 3653 (31 December 1909) to 2958465 only, so that a year typed as a number is no date', () => {
    expect(parseDateCell(3653, 'day-first', 2026)).toBe('1909-12-31');
    expect(parseDateCell(2958465, 'day-first', 2026)).toBe('9999-12-31');
    for (const v of [1985, 2026, 3652, 1, 0, -5, 2958466, Number.NaN, Number.POSITIVE_INFINITY]) expect(parseDateCell(v, 'day-first', 2026)).toBe('invalid');
  });

  it('accepts a trailing dot after day-first text', () => {
    expect(parseDateCell('05.01.1985.', 'day-first', 2026)).toBe('1985-01-05');
    expect(parseDateCell('5.1.85.', 'day-first', 2026)).toBe('1985-01-05');
    expect(parseDateCell('05/01/1985.', 'day-first', 2026)).toBe('1985-01-05');
    expect(parseDateCell('05-JAN-1985.', 'day-first', 2026)).toBe('1985-01-05');
    expect(parseDateCell('05.01.1985.', 'year-first', 2026)).toBe('invalid');
    expect(parseDateCell('31.02.1985.', 'day-first', 2026)).toBe('invalid');
    expect(parseDateCell('05.01.1985..', 'day-first', 2026)).toBe('invalid');
  });

  it('ignores a time of day after a full date', () => {
    expect(parseDateCell('2026-06-01 00:00', 'day-first', 2026)).toBe('2026-06-01');
    expect(parseDateCell('2026-06-01T00:00:00', 'year-first', 2026)).toBe('2026-06-01');
    expect(parseDateCell('2026-06-01T23:59:59.123Z', 'year-first', 2026)).toBe('2026-06-01');
    expect(parseDateCell('2026/6/1  9:05', 'year-first', 2026)).toBe('2026-06-01');
    expect(parseDateCell('05.01.1985 00:00', 'day-first', 2026)).toBe('1985-01-05');
    expect(parseDateCell('05.01.1985. 14:30:15', 'day-first', 2026)).toBe('1985-01-05');
    expect(parseDateCell('5-jan-85 14:30', 'day-first', 2026)).toBe('1985-01-05');
    expect(parseDateCell('05.01.1985 00:00', 'year-first', 2026)).toBe('invalid');
  });

  it('does not accept a time that is no time, or a time with nothing to belong to', () => {
    for (const text of ['2026-06-01 25:00', '2026-06-01 12:61', '2026-06-01 12', '2026-06-01 00:00 extra', '2026-06-01T', '00:00', '2026-02-30 00:00']) {
      expect(parseDateCell(text, 'day-first', 2026), text).toBe('invalid');
    }
  });

  it('calls impossible dates and unrecognised text invalid', () => {
    expect(parseDateCell('31.02.1985', 'day-first', 2026)).toBe('invalid');
    expect(parseDateCell('29.02.2023', 'day-first', 2026)).toBe('invalid');
    expect(parseDateCell('29.02.2024', 'day-first', 2026)).toBe('2024-02-29');
    expect(parseDateCell('00.01.1985', 'day-first', 2026)).toBe('invalid');
    expect(parseDateCell('05.13.1985', 'day-first', 2026)).toBe('invalid');
    expect(parseDateCell('1985-02-30', 'day-first', 2026)).toBe('invalid');
    expect(parseDateCell('5-abc-85', 'day-first', 2026)).toBe('invalid');
    expect(parseDateCell('05.01/1985', 'day-first', 2026)).toBe('invalid');
    expect(parseDateCell('05.01.198', 'day-first', 2026)).toBe('invalid');
    expect(parseDateCell('n/a', 'day-first', 2026)).toBe('invalid');
    expect(parseDateCell('31052', 'day-first', 2026)).toBe('invalid');
    expect(parseDateCell(true, 'day-first', 2026)).toBe('invalid');
    expect(parseDateCell(new Date(Number.NaN), 'day-first', 2026)).toBe('invalid');
  });

  it('treats empty and blank cells as empty', () => {
    expect(parseDateCell('', 'day-first', 2026)).toBeNull();
    expect(parseDateCell('    ', 'day-first', 2026)).toBeNull();
    expect(parseDateCell(null, 'day-first', 2026)).toBeNull();
  });

  it('ignores spaces around the text', () => {
    expect(parseDateCell(' 05.01.1985 ', 'day-first', 2026)).toBe('1985-01-05');
  });
});

describe('parseRank', () => {
  it('recognises ranks however they are punctuated', () => {
    expect(parseRank('CAPT.')).toEqual({ rank: 'master' });
    expect(parseRank('C/O')).toEqual({ rank: 'chiefOfficer' });
    expect(parseRank('Chief Mate')).toEqual({ rank: 'chiefOfficer' });
    expect(parseRank('2/O')).toEqual({ rank: 'secondOfficer' });
    expect(parseRank('A/B')).toEqual({ rank: 'ab' });
    expect(parseRank('C/E')).toEqual({ rank: 'chiefEngineer' });
    expect(parseRank('Electrician')).toEqual({ rank: 'eto' });
    expect(parseRank('  3rd  Mate ')).toEqual({ rank: 'thirdOfficer' });
  });

  it('recognises every synonym of the table', () => {
    const table: Record<Exclude<RankKey, 'other'>, string[]> = {
      master: ['master', 'captain', 'capt', 'mstr'],
      chiefOfficer: ['chiefofficer', 'chiefmate', 'co', 'cmate', 'choff', 'chofficer', 'firstofficer', '1stofficer', '1o'],
      secondOfficer: ['secondofficer', '2ndofficer', '2o', 'secondmate', '2ndmate'],
      thirdOfficer: ['thirdofficer', '3rdofficer', '3o', 'thirdmate', '3rdmate'],
      deckCadet: ['deckcadet', 'cadet', 'dcadet', 'deckapprentice'],
      bosun: ['bosun', 'boatswain', 'bsn'],
      ab: ['ab', 'ablebodied', 'ableseaman', 'ablebodiedseaman'],
      os: ['os', 'ordinaryseaman'],
      chiefEngineer: ['chiefengineer', 'ce', 'chiefeng', 'cheng'],
      secondEngineer: ['secondengineer', '2ndengineer', '2e'],
      thirdEngineer: ['thirdengineer', '3rdengineer', '3e'],
      fourthEngineer: ['fourthengineer', '4thengineer', '4e'],
      eto: ['eto', 'electrotechnicalofficer', 'electrician', 'elec', 'electricalofficer'],
      engineCadet: ['enginecadet', 'ecadet', 'engcadet'],
      fitter: ['fitter'],
      oiler: ['oiler', 'motorman'],
      wiper: ['wiper'],
      chiefCook: ['chiefcook', 'cook', 'chcook'],
      messman: ['messman', 'messboy'],
    };
    for (const [rank, synonyms] of Object.entries(table)) {
      for (const synonym of synonyms) {
        expect(parseRank(synonym), synonym).toEqual({ rank });
        expect(parseRank(synonym.toUpperCase()), synonym).toEqual({ rank });
      }
    }
  });

  it('keeps unknown ranks as typed (trimmed) under "other"', () => {
    expect(parseRank('Pumpman')).toEqual({ rank: 'other', rankOther: 'Pumpman' });
    expect(parseRank('  Pump man / Šef ')).toEqual({ rank: 'other', rankOther: 'Pump man / Šef' });
    expect(parseRank('???')).toEqual({ rank: 'other', rankOther: '???' });
  });

  it('gives "other" with an empty text for an empty rank', () => {
    expect(parseRank('')).toEqual({ rank: 'other', rankOther: '' });
    expect(parseRank('   ')).toEqual({ rank: 'other', rankOther: '' });
  });
});

describe('splitFullName', () => {
  it('takes the part before a comma as the surname', () => {
    expect(splitFullName('PETROVIĆ, Ivan')).toEqual({ surname: 'PETROVIĆ', givenNames: 'Ivan' });
    expect(splitFullName('Petrović , Ivan Marko')).toEqual({ surname: 'Petrović', givenNames: 'Ivan Marko' });
    expect(splitFullName("O'Brien, Jean-Luc, Jr.")).toEqual({ surname: "O'Brien", givenNames: 'Jean-Luc, Jr.' });
    expect(splitFullName('Šašić,')).toEqual({ surname: 'Šašić', givenNames: '' });
  });

  it('takes the leading words in capitals as the surname', () => {
    expect(splitFullName('PETROVIĆ Ivan Marko')).toEqual({ surname: 'PETROVIĆ', givenNames: 'Ivan Marko' });
    expect(splitFullName('VAN DER BERG Jan')).toEqual({ surname: 'VAN DER BERG', givenNames: 'Jan' });
    expect(splitFullName("O'BRIEN Jean-Luc")).toEqual({ surname: "O'BRIEN", givenNames: 'Jean-Luc' });
    expect(splitFullName('PETROVIĆ Ivan MARKO')).toEqual({ surname: 'PETROVIĆ', givenNames: 'Ivan MARKO' });
  });

  it('takes the last word as the surname when no word leads in capitals', () => {
    expect(splitFullName('Ivan Petrović')).toEqual({ surname: 'Petrović', givenNames: 'Ivan' });
    expect(splitFullName('Ivan Marko Petrović')).toEqual({ surname: 'Petrović', givenNames: 'Ivan Marko' });
    expect(splitFullName('  Ivan   Petrović  ')).toEqual({ surname: 'Petrović', givenNames: 'Ivan' });
  });

  it('keeps the spacing inside the surname and the given names as typed', () => {
    expect(splitFullName('VAN  DER BERG   Jan  Willem')).toEqual({ surname: 'VAN  DER BERG', givenNames: 'Jan  Willem' });
    expect(splitFullName('Ivan  Marko Petrović')).toEqual({ surname: 'Petrović', givenNames: 'Ivan  Marko' });
  });

  it('does not count a word without letters as capitals', () => {
    expect(splitFullName('3rd Ivan Petrović')).toEqual({ surname: 'Petrović', givenNames: '3rd Ivan' });
    expect(splitFullName('1 2 Petrović')).toEqual({ surname: 'Petrović', givenNames: '1 2' });
  });

  it('handles one word, all capitals and nothing', () => {
    expect(splitFullName('Petrović')).toEqual({ surname: 'Petrović', givenNames: '' });
    expect(splitFullName('PETROVIĆ')).toEqual({ surname: 'PETROVIĆ', givenNames: '' });
    expect(splitFullName('PETROVIĆ IVAN')).toEqual({ surname: 'PETROVIĆ IVAN', givenNames: '' });
    expect(splitFullName('  ')).toEqual({ surname: '', givenNames: '' });
  });
});

describe('cellText', () => {
  it('trims text and keeps it otherwise as typed', () => {
    expect(cellText('  Šašić  ')).toBe('Šašić');
    expect(cellText(" O'Brien  Jean-Luc ")).toBe("O'Brien  Jean-Luc");
    expect(cellText(' P 77\t')).toBe('P 77');
  });

  it('writes numbers, booleans and dates as text, and nothing as empty', () => {
    expect(cellText(null)).toBe('');
    expect(cellText(12345678)).toBe('12345678');
    expect(cellText(7.5)).toBe('7.5');
    expect(cellText(true)).toBe('true');
    expect(cellText(new Date(Date.UTC(1985, 0, 5, 23, 59)))).toBe('1985-01-05');
    expect(cellText(new Date(Number.NaN))).toBe('Invalid Date');
  });
});

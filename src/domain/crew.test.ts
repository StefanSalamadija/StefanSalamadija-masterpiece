import { describe, expect, it } from 'vitest';
import {
  fullName,
  isOnboardAt,
  latestContractByPassport,
  normalisePassport,
  onboardAt,
  rejoinDraft,
} from './crew';
import type { CrewMember } from './types';

let seq = 0;
function crewMember(over: Partial<CrewMember> = {}): CrewMember {
  seq += 1;
  return {
    id: `crew-${seq}`, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'test-device', deleted: false, scope: 'ship', shipId: 'ship-1',
    surname: 'Petrović', givenNames: 'Ivan', rank: 'master', nationality: 'Croatian',
    dateOfBirth: '1980-03-14', placeOfBirth: 'Split', passportNo: 'P1234567', passportExpiry: '2030-01-01',
    seamansBookNo: 'SB-998', seamansBookExpiry: '2030-01-01', signOnDate: '2026-06-01', signOnPort: 'Rijeka',
    ...over,
  };
}

describe('isOnboardAt', () => {
  const m = crewMember({ signOnDate: '2026-06-01' });

  it('counts the sign-on day and everything after when there is no sign-off', () => {
    expect(isOnboardAt(m, '2026-06-01')).toBe(true);
    expect(isOnboardAt(m, '2027-01-01')).toBe(true);
  });
  it('is false before sign-on', () => {
    expect(isOnboardAt(m, '2026-05-31')).toBe(false);
  });
  it('counts the sign-off day itself but not the day after', () => {
    const off = { ...m, signOffDate: '2026-10-10' };
    expect(isOnboardAt(off, '2026-10-10')).toBe(true);
    expect(isOnboardAt(off, '2026-10-11')).toBe(false);
  });
  it('treats an empty sign-off date as no sign-off', () => {
    expect(isOnboardAt({ ...m, signOffDate: '' }, '2027-01-01')).toBe(true);
  });
});

describe('onboardAt', () => {
  it('drops deleted records and people not onboard on the date', () => {
    const here = crewMember({ surname: 'Here' });
    const gone = crewMember({ surname: 'Gone', deleted: true });
    const later = crewMember({ surname: 'Later', signOnDate: '2026-12-01' });
    expect(onboardAt([here, gone, later], '2026-10-25')).toEqual([here]);
  });

  it('sorts by rank order, then sign-on date, then surname', () => {
    const ab = crewMember({ surname: 'A', rank: 'ab', signOnDate: '2026-01-01' });
    const master = crewMember({ surname: 'Z', rank: 'master', signOnDate: '2026-05-01' });
    const co = crewMember({ surname: 'M', rank: 'chiefOfficer', signOnDate: '2026-05-01' });
    const abLaterB = crewMember({ surname: 'B', rank: 'ab', signOnDate: '2026-03-01' });
    const abLaterA = crewMember({ surname: 'Adams', rank: 'ab', signOnDate: '2026-03-01' });
    const result = onboardAt([abLaterB, ab, co, abLaterA, master], '2026-10-25');
    expect(result.map((c) => c.id)).toEqual([master, co, ab, abLaterA, abLaterB].map((c) => c.id));
  });

  it('returns a new array and leaves the input order alone', () => {
    const second = crewMember({ rank: 'ab' });
    const first = crewMember({ rank: 'master' });
    const input = [second, first];
    const result = onboardAt(input, '2026-10-25');
    expect(result).not.toBe(input);
    expect(input).toEqual([second, first]);
    expect(result).toEqual([first, second]);
  });
});

describe('fullName', () => {
  it('joins given names and surname, keeping diacritics and punctuation', () => {
    expect(fullName(crewMember({ givenNames: 'Marko', surname: 'Šašić' }))).toBe('Marko Šašić');
    expect(fullName(crewMember({ givenNames: 'Jean-Luc', surname: "O'Brien" }))).toBe("Jean-Luc O'Brien");
  });
  it('trims when one part is empty', () => {
    expect(fullName(crewMember({ givenNames: '', surname: 'Petrović' }))).toBe('Petrović');
    expect(fullName(crewMember({ givenNames: 'Ivan', surname: '' }))).toBe('Ivan');
  });
});

describe('normalisePassport', () => {
  it('uppercases and removes all whitespace', () => {
    expect(normalisePassport(' 012 345 ab ')).toBe('012345AB');
    expect(normalisePassport('p12\t34\n5')).toBe('P12345');
  });
});

describe('latestContractByPassport', () => {
  it('finds the most recent non-deleted contract, ignoring spaces and case in the passport number', () => {
    const old = crewMember({ passportNo: 'P1234567', signOnDate: '2025-01-01' });
    const recent = crewMember({ passportNo: 'p 123 4567', signOnDate: '2026-02-01' });
    const deletedNewest = crewMember({ passportNo: 'P1234567', signOnDate: '2026-09-01', deleted: true });
    const other = crewMember({ passportNo: 'X999', signOnDate: '2026-10-01' });
    expect(latestContractByPassport([old, deletedNewest, recent, other], 'P1234567 ')).toBe(recent);
  });
  it('is undefined when nothing matches', () => {
    expect(latestContractByPassport([crewMember()], 'ZZ')).toBeUndefined();
    expect(latestContractByPassport([], 'P1234567')).toBeUndefined();
  });
  it('does not match blank passport numbers against each other', () => {
    expect(latestContractByPassport([crewMember({ passportNo: '' })], '  ')).toBeUndefined();
  });
});

describe('rejoinDraft', () => {
  const off = crewMember({ signOnDate: '2026-06-01', signOffDate: '2026-10-10', signOffPort: 'Santos', rank: 'other', rankOther: 'Pilot' });

  it('copies personal and document fields, sets the new sign-on and clears sign-off', () => {
    const r = rejoinDraft(off, '2027-02-01', 'Rotterdam');
    expect(r).toMatchObject({
      surname: off.surname, givenNames: off.givenNames, rank: 'other', rankOther: 'Pilot', nationality: off.nationality,
      dateOfBirth: off.dateOfBirth, placeOfBirth: off.placeOfBirth, passportNo: off.passportNo,
      passportExpiry: off.passportExpiry, seamansBookNo: off.seamansBookNo, seamansBookExpiry: off.seamansBookExpiry,
      signOnDate: '2027-02-01', signOnPort: 'Rotterdam',
    });
    expect(r.signOffDate).toBeUndefined();
    expect(r.signOffPort).toBeUndefined();
  });
  it('carries no record metadata into the draft', () => {
    const r = rejoinDraft(off, '2027-02-01', 'Rotterdam') as Record<string, unknown>;
    for (const key of ['id', 'createdAt', 'updatedAt', 'updatedBy', 'deleted', 'scope', 'shipId']) {
      expect(key in r).toBe(false);
    }
  });
});

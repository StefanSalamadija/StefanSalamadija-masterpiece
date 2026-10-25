import { describe, expect, it } from 'vitest';
import {
  fullName,
  isOnboardAt,
  latestContractByPassport,
  normalisePassport,
  onboardAt,
  overlappingContract,
  rejoinableIds,
  rejoinDraft,
  samePerson,
  visibleCrew,
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

describe('visibleCrew', () => {
  const ab = crewMember({ surname: 'B', rank: 'ab', signOnDate: '2026-03-01' });
  const master = crewMember({ surname: 'A', rank: 'master', signOnDate: '2026-05-01' });
  const off = crewMember({ surname: 'Off', rank: 'ab', signOnDate: '2025-01-01', signOffDate: '2025-06-01' });
  const gone = crewMember({ surname: 'Gone', deleted: true });

  it('Onboard is the crew onboard at the date', () => {
    expect(visibleCrew([off, ab, gone, master], 'onboard', '2026-10-25')).toEqual([master, ab]);
    expect(visibleCrew([off, ab, gone, master], 'onboard', '2025-03-01')).toEqual([off]);
  });
  it('All is every record that is not deleted, in the same order, whatever the date', () => {
    expect(visibleCrew([off, ab, gone, master], 'all', '2020-01-01')).toEqual([master, off, ab]);
    expect(visibleCrew([off, ab, gone, master], 'all', '2030-01-01')).toEqual([master, off, ab]);
  });
  it('returns a new array and leaves the input order alone', () => {
    const input = [ab, master];
    expect(visibleCrew(input, 'all', '2026-10-25')).not.toBe(input);
    expect(input).toEqual([ab, master]);
  });
});

describe('samePerson', () => {
  const ivan = (over: Partial<CrewMember> = {}) =>
    crewMember({ passportNo: 'P1', surname: 'Petrović', givenNames: 'Ivan', dateOfBirth: '1980-03-14', ...over });

  it('links two contracts with the same passport number, whatever its spaces and case and whatever the names', () => {
    expect(samePerson(ivan({ passportNo: 'p 1 ' }), ivan({ passportNo: 'P1', surname: 'Other', givenNames: 'Someone', dateOfBirth: '1999-01-01' }))).toBe(true);
    expect(samePerson(ivan({ passportNo: 'P1' }), ivan({ passportNo: 'P2', dateOfBirth: '1999-01-01' }))).toBe(false);
  });
  it('links them by name and date of birth when the passport number changed between the contracts', () => {
    expect(samePerson(ivan({ passportNo: 'P1' }), ivan({ passportNo: 'P2' }))).toBe(true);
  });
  it('links them when a passport number was added later, or lost', () => {
    expect(samePerson(ivan({ passportNo: '' }), ivan({ passportNo: 'P2' }))).toBe(true);
    expect(samePerson(ivan({ passportNo: 'P2' }), ivan({ passportNo: ' ' }))).toBe(true);
  });
  it('does not link different passport numbers when the date of birth or a name differs', () => {
    expect(samePerson(ivan({ passportNo: 'P1' }), ivan({ passportNo: 'P2', dateOfBirth: '1980-03-15' }))).toBe(false);
    expect(samePerson(ivan({ passportNo: 'P1' }), ivan({ passportNo: 'P2', givenNames: 'Ivo' }))).toBe(false);
    expect(samePerson(ivan({ passportNo: 'P1' }), ivan({ passportNo: 'P2', surname: 'Petrovac' }))).toBe(false);
  });
  it('knows a person by name and date of birth when neither contract has a passport number', () => {
    expect(samePerson(ivan({ passportNo: '' }), ivan({ passportNo: '' }))).toBe(true);
    expect(samePerson(ivan({ passportNo: '' }), ivan({ passportNo: '', dateOfBirth: '1981-01-01' }))).toBe(false);
  });
  it('does not take two blank passport numbers for the same passport', () => {
    expect(samePerson(ivan({ passportNo: '', givenNames: 'Ivan' }), ivan({ passportNo: ' ', givenNames: 'Ivo' }))).toBe(false);
  });
  it('links nothing without a passport number or a full name and date of birth', () => {
    const none = (over: Partial<CrewMember> = {}) => ivan({ passportNo: '', dateOfBirth: '', ...over });
    expect(samePerson(none(), none())).toBe(false);
    expect(samePerson(ivan({ passportNo: '', givenNames: '' }), ivan({ passportNo: '', givenNames: '' }))).toBe(false);
    expect(samePerson(ivan({ passportNo: '', surname: ' ' }), ivan({ passportNo: '', surname: ' ' }))).toBe(false);
  });
  it('ignores case, accents and the spacing of names: composed, decomposed and plain forms all match', () => {
    const composed = ivan({ passportNo: '', surname: 'PETROVIĆ' });
    const decomposed = ivan({ passportNo: '', surname: 'Petrovic\u0301' }); // c + combining acute
    const plain = ivan({ passportNo: '', surname: 'petrovic' });
    expect(decomposed.surname).not.toBe(composed.surname);
    expect(samePerson(composed, decomposed)).toBe(true);
    expect(samePerson(composed, plain)).toBe(true);
    expect(samePerson(decomposed, plain)).toBe(true);
    expect(samePerson(ivan({ passportNo: '', surname: 'Šašić', givenNames: 'Marko  Ivan' }), ivan({ passportNo: '', surname: 'SASIC', givenNames: ' marko\u00a0ivan ' }))).toBe(true);
    expect(samePerson(ivan({ passportNo: '', givenNames: 'Jean-Luc' }), ivan({ passportNo: '', givenNames: 'jean-luc' }))).toBe(true);
  });
  it('still tells different names apart', () => {
    expect(samePerson(ivan({ passportNo: '', surname: 'Petrović' }), ivan({ passportNo: '', surname: 'Petrovac' }))).toBe(false);
    expect(samePerson(ivan({ passportNo: '', surname: "O'Brien" }), ivan({ passportNo: '', surname: 'OBrien' }))).toBe(false);
  });
  it('does not take a passport number for a name, or the other way round', () => {
    expect(samePerson(ivan({ passportNo: 'IVAN', givenNames: '', surname: '' }), ivan({ passportNo: '', givenNames: 'Ivan', surname: '' }))).toBe(false);
  });
});

describe('overlappingContract', () => {
  const first = crewMember({ passportNo: 'P1', signOnDate: '2026-06-01', signOffDate: '2026-10-10' });
  const span = (signOnDate: string, signOffDate?: string, over: Partial<CrewMember> = {}) => ({
    passportNo: 'P1', surname: 'Petrović', givenNames: 'Ivan', dateOfBirth: '1980-03-14', signOnDate, signOffDate, ...over,
  });

  it('is nothing when the person has no other contract', () => {
    expect(overlappingContract(span('2026-06-01'), [])).toBeUndefined();
    expect(overlappingContract(span('2026-06-01'), [crewMember({ passportNo: 'P2', surname: 'Kovač' })])).toBeUndefined();
  });
  it('finds a contract of the same person that the dates run into', () => {
    expect(overlappingContract(span('2026-08-01', '2026-09-01'), [first])).toBe(first);
    expect(overlappingContract(span('2026-05-01', '2026-06-01'), [first])).toBe(first);
    expect(overlappingContract(span('2026-01-01', '2026-12-31'), [first])).toBe(first); // around it
    expect(overlappingContract(span('2026-07-01', '2026-07-02'), [first])).toBe(first); // inside it
  });
  it('counts both end days: a contract must start strictly after the one before it ended', () => {
    expect(overlappingContract(span('2026-10-10'), [first])).toBe(first);
    expect(overlappingContract(span('2026-10-11'), [first])).toBeUndefined();
    expect(overlappingContract(span('2026-04-01', '2026-06-01'), [first])).toBe(first);
    expect(overlappingContract(span('2026-04-01', '2026-05-31'), [first])).toBeUndefined();
  });
  it('treats a contract without a sign-off as open to the end, on either side', () => {
    const open = crewMember({ passportNo: 'P1', signOnDate: '2026-10-15' });
    expect(overlappingContract(span('2026-12-01'), [open])).toBe(open);
    expect(overlappingContract(span('2026-06-01', '2026-10-15'), [open])).toBe(open);
    expect(overlappingContract(span('2026-06-01', '2026-10-14'), [open])).toBeUndefined();
    expect(overlappingContract(span('2026-10-20', ''), [crewMember({ passportNo: 'P1', signOnDate: '2026-10-15', signOffDate: '' })])).toBeDefined();
  });
  it('never counts the contract itself, a deleted one, or another person\'s', () => {
    const other = crewMember({ passportNo: 'P2', surname: 'Kovač', signOnDate: '2026-06-01' });
    const gone = crewMember({ passportNo: 'P1', signOnDate: '2026-06-01', deleted: true });
    expect(overlappingContract({ ...span('2026-07-01'), id: first.id }, [first])).toBeUndefined();
    expect(overlappingContract(span('2026-07-01'), [other, gone])).toBeUndefined();
  });
  it('knows a person by name and date of birth when there is no passport number', () => {
    const noPassport = crewMember({ passportNo: '', signOnDate: '2026-06-01' });
    expect(overlappingContract(span('2026-07-01', undefined, { passportNo: '' }), [noPassport])).toBe(noPassport);
    expect(overlappingContract(span('2026-07-01', undefined, { passportNo: '', dateOfBirth: '1981-01-01' }), [noPassport])).toBeUndefined();
  });
  it('links nothing without a passport number or a full name and date of birth', () => {
    const anonymous = crewMember({ passportNo: '', dateOfBirth: '', signOnDate: '2026-06-01' });
    expect(overlappingContract(span('2026-07-01', undefined, { passportNo: '', dateOfBirth: '' }), [anonymous])).toBeUndefined();
  });
  it('still finds the person after the passport was renewed, by name and date of birth, and by the passport after a new name', () => {
    const open = crewMember({ passportNo: 'P2', signOnDate: '2026-10-15' });
    expect(overlappingContract(span('2026-11-01', undefined, { passportNo: 'P1' }), [open])).toBe(open); // the old passport again
    expect(overlappingContract(span('2026-11-01', undefined, { passportNo: 'P3' }), [open])).toBe(open); // a third one
    expect(overlappingContract(span('2026-11-01', undefined, { passportNo: 'P2', surname: 'Other', dateOfBirth: '1999-01-01' }), [open])).toBe(open);
    expect(overlappingContract(span('2026-11-01', undefined, { passportNo: 'P3', dateOfBirth: '1999-01-01' }), [open])).toBeUndefined();
  });
  it('finds the person whatever the accents and case of the name', () => {
    const open = crewMember({ passportNo: '', surname: 'PETROVIĆ', signOnDate: '2026-10-15' });
    expect(overlappingContract(span('2026-11-01', undefined, { passportNo: '', surname: 'Petrovic' }), [open])).toBe(open);
  });
  it('is the one that started first when several overlap', () => {
    const later = crewMember({ passportNo: 'P1', signOnDate: '2026-09-01' });
    expect(overlappingContract(span('2026-01-01'), [later, first])).toBe(first);
  });
  it('has nothing to check while the sign-on is empty or not a date', () => {
    expect(overlappingContract(span(''), [first])).toBeUndefined();
    expect(overlappingContract(span('2026-02-30'), [first])).toBeUndefined();
  });
});

describe('rejoinableIds', () => {
  const a = crewMember({ passportNo: 'P1', signOnDate: '2026-06-01', signOffDate: '2026-10-10' });
  const can = (m: CrewMember, crew: CrewMember[]) => rejoinableIds(crew).has(m.id);

  it('has a signed-off contract that is the only one of the person', () => {
    expect(can(a, [a])).toBe(true);
  });
  it('has no contract that is not signed off', () => {
    const open = crewMember({ passportNo: 'P1', signOffDate: undefined });
    expect(can(open, [open])).toBe(false);
    expect(can({ ...open, signOffDate: '' }, [{ ...open, signOffDate: '' }])).toBe(false);
  });
  it('has no contract once the person has joined again, whether or not that contract is open', () => {
    const b = crewMember({ passportNo: 'p1', signOnDate: '2026-10-15' });
    expect(can(a, [a, b])).toBe(false);
    expect(can(a, [a, { ...b, signOffDate: '2026-11-01' }])).toBe(false);
  });
  it('has the latest contract, once the later one is signed off', () => {
    const b = crewMember({ passportNo: 'P1', signOnDate: '2026-10-15', signOffDate: '2026-11-01' });
    expect(can(b, [a, b])).toBe(true);
    expect(can(a, [a, b])).toBe(false);
  });
  it('has no contract of a person who has one open', () => {
    const open = crewMember({ passportNo: 'P1', signOnDate: '2026-01-01' });
    expect(can(a, [open, a])).toBe(false);
  });
  it('does not count deleted contracts or other people, and never has a deleted contract', () => {
    const deletedLater = crewMember({ passportNo: 'P1', signOnDate: '2026-10-15', deleted: true });
    const someoneElse = crewMember({ passportNo: 'P2', surname: 'Kovač', signOnDate: '2026-10-15' });
    expect(can(a, [a, deletedLater, someoneElse])).toBe(true);
    expect(can(deletedLater, [a, { ...deletedLater, signOffDate: '2026-12-01' }])).toBe(false);
  });
  it('has a signed-off contract that cannot be linked to anyone', () => {
    const alone = crewMember({ passportNo: '', dateOfBirth: '', signOffDate: '2026-10-10' });
    expect(can(alone, [alone])).toBe(true);
  });
  it('still sees the person after the passport was renewed on the later contract', () => {
    const b = crewMember({ passportNo: 'P2', signOnDate: '2026-10-15' }); // re-joined, then the passport was renewed
    expect(can(a, [a, b])).toBe(false);
    const signedOff = { ...b, signOffDate: '2026-11-01' };
    expect(can(a, [a, signedOff])).toBe(false);
    expect(can(signedOff, [a, signedOff])).toBe(true);
  });
  it('links through a passport added later, and through the name when the passports differ', () => {
    const later = crewMember({ passportNo: '', signOnDate: '2026-10-15' });
    expect(can(a, [a, later])).toBe(false);
    expect(can(a, [a, crewMember({ passportNo: 'P3', signOnDate: '2026-10-15', surname: 'Kovač' })])).toBe(true);
  });
  it('is one set for the whole crew', () => {
    const b = crewMember({ passportNo: 'P1', signOnDate: '2026-10-15' });
    const c = crewMember({ passportNo: 'P9', surname: 'Kovač', givenNames: 'Marko', signOnDate: '2026-01-01', signOffDate: '2026-05-01' });
    expect([...rejoinableIds([a, b, c])]).toEqual([c.id]);
  });
});

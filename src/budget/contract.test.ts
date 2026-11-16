import { describe, expect, it } from 'vitest';
import type { CrewMember } from '../domain/types';
import { applyContract, contractPeriod, contractStatus, myLatestContract } from './contract';

const crew = (fields: Partial<CrewMember>): CrewMember => ({
  id: 'c1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'test', deleted: false, scope: 'ship',
  shipId: 's1', surname: 'Horvat', givenNames: 'Ivo', rank: 'master', nationality: 'HR', dateOfBirth: '1980-01-01', placeOfBirth: 'Split',
  passportNo: 'P 123', passportExpiry: '2030-01-01', seamansBookNo: '', seamansBookExpiry: '', signOnDate: '2026-06-15', signOnPort: 'Rijeka',
  contractMonths: 8, ...fields,
});

describe('contractPeriod', () => {
  it('runs from the sign-on to the day before sign-on + the contract months', () => {
    expect(contractPeriod(crew({}))).toEqual({ signOn: '2026-06-15', signOff: '2027-02-14' });
    expect(contractPeriod(crew({ signOnDate: '2026-01-31', contractMonths: 1 }))).toEqual({ signOn: '2026-01-31', signOff: '2026-02-27' });
  });

  it('takes the sign-off date once there is one, and has no period without a length or a sign-off', () => {
    expect(contractPeriod(crew({ signOffDate: '2026-12-20' }))).toEqual({ signOn: '2026-06-15', signOff: '2026-12-20' });
    expect(contractPeriod(crew({ contractMonths: undefined }))).toBeUndefined();
    expect(contractPeriod(crew({ signOnDate: 'bad' }))).toBeUndefined();
  });
});

describe('myLatestContract', () => {
  it('is the latest live contract of the person marked as me, matched by passport across ships', () => {
    const old = crew({ id: 'old', signOnDate: '2025-01-10' });
    const rejoin = crew({ id: 'new', shipId: 's2', passportNo: 'p123', signOnDate: '2026-06-15' });
    const other = crew({ id: 'x', passportNo: 'Q999', signOnDate: '2026-09-01' });
    expect(myLatestContract([old, rejoin, other], 'old')?.id).toBe('new');
    expect(myLatestContract([old, { ...rejoin, deleted: true }], 'old')?.id).toBe('old');
    expect(myLatestContract([crew({ id: 'np', passportNo: '' })], 'np')?.id).toBe('np');
    expect(myLatestContract([old], 'missing')).toBeUndefined();
    expect(myLatestContract([old], undefined)).toBeUndefined();
  });
});

describe('contractStatus and applyContract', () => {
  const period = { signOn: '2026-06-15', signOff: '2027-02-14' };

  it('is missing until copied, the same once copied, and differs when the crew record changes', () => {
    expect(contractStatus([{ signOn: '2026-06-15', signOff: '2027-02-14' }], 'c1', period)).toBe('missing');
    const copied = applyContract([], 'c1', period);
    expect(copied).toEqual([{ ...period, crewId: 'c1' }]);
    expect(contractStatus(copied, 'c1', period)).toBe('same');
    expect(contractStatus(copied, 'c1', { ...period, signOff: '2027-03-14' })).toBe('differs');
  });

  it('replaces only the period copied from that contract, and keeps the others', () => {
    const periods = [{ signOn: '2025-01-10', signOff: '2025-09-09' }, { ...period, crewId: 'c1' }, { signOn: '2024-01-01', signOff: '2024-08-31', crewId: 'c0' }];
    expect(applyContract(periods, 'c1', { signOn: '2026-06-20', signOff: '2027-02-19' })).toEqual([
      periods[0], { signOn: '2026-06-20', signOff: '2027-02-19', crewId: 'c1' }, periods[2],
    ]);
  });
});

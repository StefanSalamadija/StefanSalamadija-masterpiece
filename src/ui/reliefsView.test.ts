import { describe, expect, it } from 'vitest';
import type { CrewMember } from '../domain/types';
import { reliefDetails, reliefRows } from './reliefsView';

const TODAY = '2026-10-25';

let seq = 0;
function crew(over: Partial<CrewMember> = {}): CrewMember {
  seq += 1;
  return {
    id: `crew-${seq}`, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'test-device', deleted: false, scope: 'ship', shipId: 'ship-1',
    surname: `SURNAME${seq}`, givenNames: 'Ivan', rank: 'master', nationality: 'Croatian',
    dateOfBirth: '1980-03-14', placeOfBirth: 'Split', passportNo: `P${seq}`, passportExpiry: '2035-01-01',
    seamansBookNo: `SB${seq}`, seamansBookExpiry: '2035-01-01', signOnDate: '2026-06-01', signOnPort: 'Rijeka',
    ...over,
  };
}

const surnames = (rows: ReturnType<typeof reliefRows>) => rows.map((r) => r.member.surname);

describe('reliefRows', () => {
  it('lists the crew onboard on the date, and nobody else', () => {
    const rows = reliefRows([
      crew({ surname: 'ONBOARD' }),
      crew({ surname: 'SIGNED-OFF', signOffDate: '2026-10-24' }),
      crew({ surname: 'JOINS-TOMORROW', signOnDate: '2026-10-26' }),
      crew({ surname: 'DELETED', deleted: true }),
      crew({ surname: 'LEAVES-TODAY', signOffDate: TODAY }),
    ], TODAY, 11);
    expect(surnames(rows).sort()).toEqual(['LEAVES-TODAY', 'ONBOARD']);
  });

  it('puts the earliest contract end first and the crew with no contract length last', () => {
    const rows = reliefRows([
      crew({ surname: 'NONE' }),
      crew({ surname: 'LATE', contractMonths: 9 }),     // 2027-03-01
      crew({ surname: 'EARLY', contractMonths: 3 }),    // 2026-09-01
      crew({ surname: 'MIDDLE', contractMonths: 6 }),   // 2026-12-01
    ], TODAY, 11);
    expect(surnames(rows)).toEqual(['EARLY', 'MIDDLE', 'LATE', 'NONE']);
  });

  it('sorts by the date the contract ends, not by its length', () => {
    const rows = reliefRows([
      crew({ surname: 'LONG-BUT-EARLY', signOnDate: '2026-01-01', contractMonths: 9 }),   // 2026-10-01
      crew({ surname: 'SHORT-BUT-LATE', signOnDate: '2026-09-01', contractMonths: 2 }),   // 2026-11-01
    ], TODAY, 11);
    expect(surnames(rows)).toEqual(['LONG-BUT-EARLY', 'SHORT-BUT-LATE']);
  });

  it('puts the one who joined first first among contracts that end on the same day, and among those with no length', () => {
    const rows = reliefRows([
      crew({ surname: 'B', signOnDate: '2026-07-01', contractMonths: 5 }),    // 2026-12-01
      crew({ surname: 'A', signOnDate: '2026-06-01', contractMonths: 6 }),    // 2026-12-01
      crew({ surname: 'Y', signOnDate: '2026-08-01' }),
      crew({ surname: 'X', signOnDate: '2026-02-01' }),
    ], TODAY, 11);
    expect(surnames(rows)).toEqual(['A', 'B', 'X', 'Y']);
  });

  it('keeps the order of the crew list (rank, then surname) when nothing else tells two apart', () => {
    const rows = reliefRows([
      crew({ surname: 'BETA', rank: 'ab' }), crew({ surname: 'ALPHA', rank: 'ab' }), crew({ surname: 'CAPTAIN', rank: 'master' }),
    ], TODAY, 11);
    expect(surnames(rows)).toEqual(['CAPTAIN', 'ALPHA', 'BETA']);
  });

  it('gives each row its days onboard, contract end, and the warnings of the contract and of the limit', () => {
    const [row] = reliefRows([crew({ signOnDate: '2025-11-20', contractMonths: 9 })], TODAY, 11);
    expect(row).toMatchObject({ daysOnboard: 340, contractEnd: '2026-08-20', contractBand: 'red', limitBand: 'red' });
  });

  it("measures the limit against the ship's", () => {
    const m = crew({ signOnDate: '2026-01-25' });   // 9 months: 2026-10-25, 11 months: 2026-12-25
    expect(reliefRows([m], TODAY, 9)[0].limitBand).toBe('red');
    expect(reliefRows([m], TODAY, 11)[0].limitBand).toBe('ok');
  });

  it('has no contract end and no contract warning without a length', () => {
    const [row] = reliefRows([crew()], TODAY, 11);
    expect(row.contractEnd).toBeUndefined();
    expect(row.contractBand).toBe('none');
  });

  it('does not change its input', () => {
    const members = [crew({ surname: 'B', contractMonths: 9 }), crew({ surname: 'A', contractMonths: 3 })];
    const before = JSON.stringify(members);
    reliefRows(members, TODAY, 11);
    expect(JSON.stringify(members)).toBe(before);
  });
});

describe('reliefDetails', () => {
  const details = (over: Partial<CrewMember>) => reliefDetails(reliefRows([crew(over)], TODAY, 11)[0]);

  it('says the days onboard, the contract end and the planned relief', () => {
    expect(details({
      signOnDate: '2025-11-20', contractMonths: 9, reliefPlannedDate: '2026-11-05', reliefPlannedPort: 'Santos',
    })).toEqual(['Onboard 340 days', 'Contract ends 2026-08-20', 'Relief 2026-11-05 Santos']);
  });
  it('says there is no contract length, and leaves out a relief that is not planned', () => {
    expect(details({ signOnDate: '2026-06-01' })).toEqual(['Onboard 147 days', 'No contract length']);
  });
  it('says a single day in the singular', () => {
    expect(details({ signOnDate: TODAY })[0]).toBe('Onboard 1 day');
  });
  it('gives the date of a relief without a port, and the port of one without a date', () => {
    expect(details({ contractMonths: 6, reliefPlannedDate: '2026-11-05' })[2]).toBe('Relief 2026-11-05');
    expect(details({ contractMonths: 6, reliefPlannedPort: 'Santos' })[2]).toBe('Relief Santos');
  });
});

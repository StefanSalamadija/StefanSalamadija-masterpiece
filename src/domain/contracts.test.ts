import { describe, expect, it } from 'vitest';
import {
  contractBand, contractEndDate, DEFAULT_MAX_MONTHS_ONBOARD, daysOnboard, isValidMaxMonths, MAX_MONTHS_ONBOARD_LIMIT,
  maxMonthsOnboardOf, onboardLimitBand, onboardLimitDate, validMaxMonths,
} from './contracts';
import type { CrewMember } from './types';

let seq = 0;
function crew(over: Partial<CrewMember> = {}): CrewMember {
  seq += 1;
  return {
    id: `crew-${seq}`, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'test-device', deleted: false, scope: 'ship', shipId: 'ship-1',
    surname: 'PETROVIĆ', givenNames: 'Ivan', rank: 'master', nationality: 'Croatian',
    dateOfBirth: '1980-03-14', placeOfBirth: 'Split', passportNo: 'P1234567', passportExpiry: '2035-01-01',
    seamansBookNo: 'SB-998', seamansBookExpiry: '2035-01-01', signOnDate: '2026-06-01', signOnPort: 'Rijeka',
    ...over,
  };
}

describe('DEFAULT_MAX_MONTHS_ONBOARD', () => {
  it('is the 11 months of the Maritime Labour Convention', () => {
    expect(DEFAULT_MAX_MONTHS_ONBOARD).toBe(11);
  });
});

describe('MAX_MONTHS_ONBOARD_LIMIT', () => {
  it('is the 11 months of the Maritime Labour Convention, the most a ship can set', () => {
    expect(MAX_MONTHS_ONBOARD_LIMIT).toBe(11);
  });
});

// What a stored value can be: backup import checks only that a record has an id and a time, so a damaged or
// hand-edited ship can hold anything. A value that is not whole months from 1 to 11 is not used.
const BAD_LIMITS: unknown[] = [0, 12, 6.5, '9', Number.NaN, -3, 'abc', Number.POSITIVE_INFINITY, null, 100, true];

describe('isValidMaxMonths', () => {
  it('is true for whole months from 1 to 11 and nothing else', () => {
    for (const months of [1, 2, 9, 10, 11]) expect(isValidMaxMonths(months), String(months)).toBe(true);
    for (const months of [...BAD_LIMITS, undefined]) expect(isValidMaxMonths(months), String(months)).toBe(false);
  });
});

describe('validMaxMonths', () => {
  it('is the value when it is whole months from 1 to 11, else the default', () => {
    expect(validMaxMonths(9)).toBe(9);
    expect(validMaxMonths(1)).toBe(1);
    for (const months of [...BAD_LIMITS, undefined]) expect(validMaxMonths(months), String(months)).toBe(DEFAULT_MAX_MONTHS_ONBOARD);
  });
});

describe('maxMonthsOnboardOf', () => {
  it("is the ship's own limit when it has one, else the default", () => {
    expect(maxMonthsOnboardOf({ maxMonthsOnboard: 9 })).toBe(9);
    expect(maxMonthsOnboardOf({})).toBe(DEFAULT_MAX_MONTHS_ONBOARD);
    expect(maxMonthsOnboardOf({ maxMonthsOnboard: undefined })).toBe(11);
  });
  it('is the default for a stored limit that is not whole months from 1 to 11', () => {
    for (const months of [0, 12, 6.5, '9', Number.NaN, -3, 'abc'] as unknown[]) {
      expect(maxMonthsOnboardOf({ maxMonthsOnboard: months as number }), String(months)).toBe(11);
    }
  });
});

describe('contractEndDate', () => {
  const m = crew({ signOnDate: '2026-06-01', contractMonths: 6 });

  it('is the sign-on date plus the months of the contract', () => {
    expect(contractEndDate(m)).toBe('2026-12-01');
  });
  it('clamps to the end of a shorter month', () => {
    expect(contractEndDate(crew({ signOnDate: '2026-08-31', contractMonths: 6 }))).toBe('2027-02-28');
  });
  it('is undefined without a contract length', () => {
    expect(contractEndDate({ ...m, contractMonths: undefined })).toBeUndefined();
  });
  it('is undefined for a length that is not a whole number of months above zero, or a sign-on that is not a date', () => {
    expect(contractEndDate({ ...m, contractMonths: 0 })).toBeUndefined();
    expect(contractEndDate({ ...m, contractMonths: -3 })).toBeUndefined();
    expect(contractEndDate({ ...m, contractMonths: 6.5 })).toBeUndefined();
    expect(contractEndDate({ ...m, contractMonths: '6' as unknown as number })).toBeUndefined();
    expect(contractEndDate({ ...m, signOnDate: '' })).toBeUndefined();
    expect(contractEndDate({ ...m, signOnDate: '2026-02-30' })).toBeUndefined();
  });
});

describe('daysOnboard', () => {
  const m = crew({ signOnDate: '2026-06-01', contractMonths: 6 });

  it('counts the sign-on day as the first', () => {
    expect(daysOnboard(m, '2026-06-01')).toBe(1);
    expect(daysOnboard(m, '2026-06-02')).toBe(2);
  });
  it('counts up to the date asked about while the crew member is still onboard', () => {
    expect(daysOnboard(m, '2026-10-25')).toBe(147);
  });
  it('stops at the sign-off date', () => {
    expect(daysOnboard({ ...m, signOffDate: '2026-07-01' }, '2026-10-25')).toBe(31);
    expect(daysOnboard({ ...m, signOffDate: '2026-07-01' }, '2026-07-01')).toBe(31);
    expect(daysOnboard({ ...m, signOffDate: '2026-07-01' }, '2026-06-15')).toBe(15);
  });
  it('is 0 before the sign-on', () => {
    expect(daysOnboard(m, '2026-05-01')).toBe(0);
    expect(daysOnboard(m, '2026-05-31')).toBe(0);
  });
  it('counts across a leap day', () => {
    expect(daysOnboard(crew({ signOnDate: '2028-02-28' }), '2028-03-01')).toBe(3);
  });
  it('is never negative: a sign-off before the sign-on (a damaged record) is 0 days', () => {
    const damaged = crew({ signOnDate: '2026-06-10', signOffDate: '2026-06-01' });
    expect(daysOnboard(damaged, '2026-10-25')).toBe(0);
    expect(daysOnboard(damaged, '2026-06-10')).toBe(0);
    expect(daysOnboard(damaged, '2026-06-05')).toBe(0);
  });
  it('is 0 when a date is not a date, rather than a made-up number', () => {
    expect(daysOnboard(crew({ signOnDate: '' }), '2026-10-25')).toBe(0);
    expect(daysOnboard(m, '')).toBe(0);
  });
});

describe('contractBand', () => {
  const m = crew({ signOnDate: '2026-06-01', contractMonths: 6 }); // ends 2026-12-01

  it('is amber from 30 days before the end, up to and including the end day', () => {
    expect(contractBand(m, '2026-11-01')).toBe('amber'); // end = ref + 30
    expect(contractBand(m, '2026-12-01')).toBe('amber'); // ends today
  });
  it('is ok before that', () => {
    expect(contractBand(m, '2026-10-31')).toBe('ok');
  });
  it('is red once the contract has ended', () => {
    expect(contractBand(m, '2026-12-02')).toBe('red');
  });
  it('is none without a contract length', () => {
    expect(contractBand(crew(), '2026-12-02')).toBe('none');
  });
});

describe('onboardLimitDate', () => {
  it('is the sign-on date plus the months of the limit', () => {
    expect(onboardLimitDate(crew({ signOnDate: '2026-01-01' }), 11)).toBe('2026-12-01');
    expect(onboardLimitDate(crew({ signOnDate: '2026-01-31' }), 1)).toBe('2026-02-28');
  });
  it('uses 11 months for a limit that is not whole months from 1 to 11, and does not throw', () => {
    for (const months of BAD_LIMITS) expect(onboardLimitDate(crew({ signOnDate: '2026-01-01' }), months as number), String(months)).toBe('2026-12-01');
  });
});

describe('onboardLimitBand', () => {
  const j = crew({ signOnDate: '2026-01-01' }); // the limit is 2026-12-01 at 11 months

  it('is red from the day the limit is reached', () => {
    expect(onboardLimitBand(j, '2026-12-01', 11)).toBe('red');
    expect(onboardLimitBand(j, '2027-03-01', 11)).toBe('red');
  });
  it('is amber from 30 days before the limit', () => {
    expect(onboardLimitBand(j, '2026-11-01', 11)).toBe('amber');
    expect(onboardLimitBand(j, '2026-11-30', 11)).toBe('amber');
  });
  it('is ok before that', () => {
    expect(onboardLimitBand(j, '2026-10-31', 11)).toBe('ok');
  });
  it('measures against the limit it is given', () => {
    expect(onboardLimitBand(j, '2026-10-01', 9)).toBe('red'); // the limit is 2026-10-01
    expect(onboardLimitBand(j, '2026-09-01', 9)).toBe('amber');
  });
  it('uses 11 months when no limit is given', () => {
    expect(onboardLimitBand(j, '2026-12-01')).toBe('red');
    expect(onboardLimitBand(j, '2026-10-31')).toBe('ok');
  });
  it('is none when the sign-on is not a date', () => {
    expect(onboardLimitBand(crew({ signOnDate: '' }), '2026-12-01', 11)).toBe('none');
  });
  it('uses 11 months for a limit that is not whole months from 1 to 11, and does not throw', () => {
    for (const months of BAD_LIMITS) {
      expect(onboardLimitBand(j, '2026-12-01', months as number), String(months)).toBe('red');
      expect(onboardLimitBand(j, '2026-11-01', months as number), String(months)).toBe('amber');
      expect(onboardLimitBand(j, '2026-10-31', months as number), String(months)).toBe('ok');
    }
  });
});

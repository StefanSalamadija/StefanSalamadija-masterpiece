import { describe, expect, it } from 'vitest';
import type { RotationSettings } from '../domain/types';
import { daysInMonth, onboardDaysIn, rotationPeriods, salaryForMonth, salaryPaidIn } from './rotation';

function rot(fields: Partial<RotationSettings> = {}): RotationSettings {
  return { salaryFrom: [{ ym: '2020-01', amount: 310000 }], periods: [], patternOn: 8, patternOff: 4, paidNextMonth: false, paidAtHomePct: 0, ...fields };
}

describe('daysInMonth', () => {
  it('knows leap Februaries', () => {
    expect(daysInMonth('2028-02')).toBe(29);
    expect(daysInMonth('2027-02')).toBe(28);
    expect(daysInMonth('2100-02')).toBe(28);
    expect(daysInMonth('2000-02')).toBe(29);
    expect(daysInMonth('2027-03')).toBe(31);
    expect(daysInMonth('2027-04')).toBe(30);
  });
});

describe('salaryForMonth (the pay rule)', () => {
  it('pays 17/31 for a sign-on on 15 March', () => {
    const r = rot({ periods: [{ signOn: '2027-03-15', signOff: '2027-10-14' }] });
    expect(salaryForMonth(r, '2027-03')).toEqual({ onboardDays: 17, daysInMonth: 31, amount: 170000, onboard: 'mixed' });
  });

  it('counts a leap February by its 29 days', () => {
    const r = rot({ salaryFrom: [{ ym: '2027-01', amount: 290000 }], periods: [{ signOn: '2027-06-01', signOff: '2028-02-10' }] });
    expect(salaryForMonth(r, '2028-02')).toEqual({ onboardDays: 10, daysInMonth: 29, amount: 100000, onboard: 'mixed' });
  });

  it('counts sign-on and sign-off on the same day as 1 day', () => {
    const r = rot({ periods: [{ signOn: '2027-04-10', signOff: '2027-04-10' }] });
    expect(salaryForMonth(r, '2027-04')).toMatchObject({ onboardDays: 1, daysInMonth: 30, amount: 10333, onboard: 'mixed' });
  });

  it('pays a full month onboard, nothing at home, and prorates a mixed month (rounded to the cent)', () => {
    const r = rot({ salaryFrom: [{ ym: '2026-01', amount: 500000 }], periods: [{ signOn: '2027-01-20', signOff: '2027-03-05' }] });
    expect(salaryForMonth(r, '2027-02')).toMatchObject({ onboardDays: 28, amount: 500000, onboard: 'onboard' });
    expect(salaryForMonth(r, '2027-04')).toMatchObject({ onboardDays: 0, amount: 0, onboard: 'home' });
    // 12 of 31 days: 500000 × 12 / 31 = 193548.387 → 193548
    expect(salaryForMonth(r, '2027-01')).toMatchObject({ onboardDays: 12, amount: 193548, onboard: 'mixed' });
    // 5 of 31 days: 80645.16 → 80645
    expect(salaryForMonth(r, '2027-03')).toMatchObject({ onboardDays: 5, amount: 80645, onboard: 'mixed' });
  });

  it('pays the "paid at home" % for the home days', () => {
    const r = rot({ salaryFrom: [{ ym: '2026-01', amount: 300000 }], paidAtHomePct: 10, periods: [{ signOn: '2027-04-16', signOff: '2027-12-31' }] });
    // April: 15 onboard + 15 home at 10%: 300000 × (15 + 1.5) / 30 = 165000
    expect(salaryForMonth(r, '2027-04').amount).toBe(165000);
    // A whole month at home: 10% of 300000
    expect(salaryForMonth(r, '2027-02').amount).toBe(30000);
  });

  it('uses the salary in force from its month on', () => {
    const r = rot({ salaryFrom: [{ ym: '2027-05', amount: 400000 }, { ym: '2026-01', amount: 300000 }], periods: [{ signOn: '2027-01-01', signOff: '2027-12-31' }] });
    expect(salaryForMonth(r, '2027-04').amount).toBe(300000);
    expect(salaryForMonth(r, '2027-05').amount).toBe(400000);
  });

  it('counts overlapping periods once', () => {
    const r = rot({ periods: [{ signOn: '2027-03-01', signOff: '2027-03-20' }, { signOn: '2027-03-10', signOff: '2027-03-31' }] });
    expect(salaryForMonth(r, '2027-03').onboardDays).toBe(31);
  });
});

describe('salaryPaidIn', () => {
  const r = rot({ periods: [{ signOn: '2027-03-15', signOff: '2027-10-14' }] });
  it('lands in the same month by default', () => {
    expect(salaryPaidIn(r, '2027-03')).toBe(170000);
    expect(salaryPaidIn(r, '2027-11')).toBe(0);
  });
  it('lands in the next month when paid next month', () => {
    const next = { ...r, paidNextMonth: true };
    expect(salaryPaidIn(next, '2027-03')).toBe(0);
    expect(salaryPaidIn(next, '2027-04')).toBe(170000);
    // October: 14 of 31 days, paid in November
    expect(salaryPaidIn(next, '2027-11')).toBe(salaryForMonth(r, '2027-10').amount);
    expect(salaryForMonth(r, '2027-10').amount).toBe(140000);
  });
});

describe('rotationPeriods (the pattern after the last period)', () => {
  it('repeats 8 on / 4 off after the last entered period, across years', () => {
    const r = rot({ periods: [{ signOn: '2026-04-15', signOff: '2026-12-14' }] });
    expect(rotationPeriods(r, '2029-01')).toEqual([
      { signOn: '2026-04-15', signOff: '2026-12-14' },
      { signOn: '2027-04-15', signOff: '2027-12-14' },
      { signOn: '2028-04-15', signOff: '2028-12-14' },
    ]);
    expect(rotationPeriods(r, '2029-04')).toHaveLength(4);
    expect(rotationPeriods(r, '2029-04')[3]).toEqual({ signOn: '2029-04-15', signOff: '2029-12-14' });
  });

  it('keeps the entered periods (sorted) and starts the pattern after the latest sign-off', () => {
    const r = rot({ patternOn: 6, patternOff: 3, periods: [{ signOn: '2027-01-01', signOff: '2027-05-31' }, { signOn: '2026-01-10', signOff: '2026-06-09' }] });
    const periods = rotationPeriods(r, '2028-06');
    expect(periods.slice(0, 2)).toEqual([{ signOn: '2026-01-10', signOff: '2026-06-09' }, { signOn: '2027-01-01', signOff: '2027-05-31' }]);
    // Home June–August, on September–February, home March–May, on from June 2028.
    expect(periods[2]).toEqual({ signOn: '2027-09-01', signOff: '2028-02-29' });
    expect(periods[3]).toEqual({ signOn: '2028-06-01', signOff: '2028-11-30' });
    expect(periods).toHaveLength(4);
  });

  it('does not drift at the end of a month', () => {
    const r = rot({ patternOn: 1, patternOff: 1, periods: [{ signOn: '2027-01-01', signOff: '2027-01-30' }] });
    // Home from 31 Jan for a month, then a month on.
    const periods = rotationPeriods(r, '2027-12');
    expect(periods[1]).toEqual({ signOn: '2027-02-28', signOff: '2027-03-30' });
    expect(periods[2]).toEqual({ signOn: '2027-04-30', signOff: '2027-05-30' });
    expect(periods[3]).toEqual({ signOn: '2027-06-30', signOff: '2027-07-30' });
  });

  it('makes nothing up without an entered period, or without months on', () => {
    expect(rotationPeriods(rot(), '2030-01')).toEqual([]);
    const r = rot({ patternOn: 0, periods: [{ signOn: '2026-04-15', signOff: '2026-12-14' }] });
    expect(rotationPeriods(r, '2030-01')).toEqual([{ signOn: '2026-04-15', signOff: '2026-12-14' }]);
  });

  it('pays the generated months', () => {
    const r = rot({ periods: [{ signOn: '2026-04-15', signOff: '2026-12-14' }] });
    expect(salaryForMonth(r, '2027-02').onboard).toBe('home');
    expect(salaryForMonth(r, '2027-06').onboard).toBe('onboard');
    expect(salaryForMonth(r, '2027-04').onboardDays).toBe(16);
    expect(onboardDaysIn(rotationPeriods(r, '2027-12'), '2027-12')).toBe(14);
  });
});

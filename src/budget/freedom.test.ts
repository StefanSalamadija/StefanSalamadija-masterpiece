import { describe, expect, it } from 'vitest';
import type { Assumptions } from '../domain/types';
import { budgetData, category, correction, month, settings } from '../test/budgetRecords';
import { forecast } from './forecast';
import type { ForecastMonth, ForecastResult } from './forecast';
import { freedom } from './freedom';
import { addMonths } from './months';

const TODAY = '2026-11-15';

/** A forecast that only carries what the freedom date reads: the start of investments and each month's contribution. */
function fc(startInvestments: number, contributions: number[]): ForecastResult {
  const months = contributions.map((contribution, i) => ({ ym: addMonths('2026-11', i), contribution }) as ForecastMonth);
  return { months, warnings: [], debtFree: {}, totalInterest: 0, interestByDebt: {}, needsBankStart: false, buffer: 0, startInvestments, investmentsCorrectedNow: false,
    assumptions: { withdrawalRatePct: 4, emergencyMonths: 6, fundReminderDays: 30 } };
}
const rates = (fields: Partial<Assumptions>): Assumptions => ({ withdrawalRatePct: 4, emergencyMonths: 6, fundReminderDays: 30, ...fields });

describe('freedom', () => {
  it('finds the first month investments reach the freedom number, without inflation', () => {
    const r = freedom({ forecast: fc(59000000, Array(12).fill(200000)), yearlySpending: 2400000, assumptions: rates({ yearlyReturnPct: 0, inflationPct: 0 }), today: TODAY });
    expect(r).toMatchObject({ status: 'ok', number: 60000000, ym: '2027-03', years: 0, months: 4, numberAt: 60000000 });
  });

  it('is later with inflation: yearly spending grows by it, and so does the number', () => {
    const r = freedom({ forecast: fc(59000000, Array(12).fill(200000)), yearlySpending: 2400000, assumptions: rates({ yearlyReturnPct: 0, inflationPct: 2 }), today: TODAY });
    expect(r).toMatchObject({ status: 'ok', number: 60000000, ym: '2027-07', years: 0, months: 8, numberAt: 60797357 });
  });

  it('grows investments monthly by (1 + r)^(1/12)', () => {
    const r = freedom({ forecast: fc(1000000, []), yearlySpending: 80000, assumptions: rates({ yearlyReturnPct: 12, inflationPct: 0 }), today: TODAY });
    expect(r).toMatchObject({ status: 'ok', number: 2000000, ym: addMonths('2026-11', 73), years: 6, months: 1 });
  });

  it('carries the contributions on past the forecast horizon (their average over its last 12 months)', () => {
    const r = freedom({ forecast: fc(0, Array(24).fill(100000)), yearlySpending: 2400000, assumptions: rates({ yearlyReturnPct: 0, inflationPct: 0 }), today: TODAY });
    expect(r).toMatchObject({ status: 'ok', ym: addMonths('2026-11', 599), years: 49, months: 11 });
  });

  it('is never reached within 60 years: no date', () => {
    const r = freedom({ forecast: fc(100, Array(12).fill(0)), yearlySpending: 2400000, assumptions: rates({ yearlyReturnPct: 0, inflationPct: 2 }), today: TODAY });
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.number).toBe(60000000);
    expect(r.ym).toBeUndefined();
    expect(r.years).toBeUndefined();
    expect(r.months).toBeUndefined();
  });

  it('asks for the expected return and inflation rather than guessing them', () => {
    expect(freedom({ forecast: fc(0, []), yearlySpending: 1, assumptions: rates({ inflationPct: 2 }), today: TODAY }))
      .toEqual({ status: 'needsAssumptions', missing: ['yearlyReturnPct'] });
    expect(freedom({ forecast: fc(0, []), yearlySpending: 1, assumptions: rates({}), today: TODAY }))
      .toEqual({ status: 'needsAssumptions', missing: ['yearlyReturnPct', 'inflationPct'] });
    expect(freedom({ forecast: fc(0, []), yearlySpending: 1, assumptions: rates({ yearlyReturnPct: 5, inflationPct: 2, withdrawalRatePct: 0 }), today: TODAY }))
      .toEqual({ status: 'needsAssumptions', missing: ['withdrawalRatePct'] });
  });

  it('needs the forecast\'s bank start', () => {
    const none = { ...fc(0, []), needsBankStart: true };
    expect(freedom({ forecast: none, yearlySpending: 1, assumptions: rates({ yearlyReturnPct: 5, inflationPct: 2 }), today: TODAY })).toEqual({ status: 'needsBankStart' });
  });

  it('shows amounts in today\'s euros: value ÷ (1 + inflation)^years', () => {
    const r = freedom({ forecast: fc(0, []), yearlySpending: 2400000, assumptions: rates({ yearlyReturnPct: 0, inflationPct: 2 }), today: TODAY });
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.todayEuros(1020000, '2027-11')).toBe(1000000);
    expect(r.todayEuros(1000000, '2026-11')).toBe(1000000);
    expect(r.todayEuros(1040400, '2028-11')).toBe(1000000);
  });

  it('starts from an investments correction made this month', () => {
    const f = forecast({
      today: TODAY,
      data: budgetData({
        budgetCategories: [category('cat-etf', 'savings')],
        budgetCorrections: [correction('bank', '2026-10', 500000), correction('investments', '2026-11', 59800000)],
        budgetMonths: [month('2026-11', { potTargets: { savings: { fromOn: { kind: 'amount', value: 200000 } } } })],
      }),
      settings: settings({ horizon: 12 }),
    });
    expect(f.months[0].investments).toBe(60000000);
    const r = freedom({ forecast: f, yearlySpending: 2400000, assumptions: rates({ yearlyReturnPct: 0, inflationPct: 0 }), today: TODAY });
    expect(r).toMatchObject({ status: 'ok', ym: '2026-11', years: 0, months: 0 });
  });

  it('works from a real forecast: its planned investment contributions', () => {
    const f = forecast({
      today: TODAY,
      data: budgetData({
        budgetCategories: [category('cat-etf', 'savings')],
        budgetCorrections: [correction('bank', '2026-10', 500000), correction('investments', '2026-10', 59000000)],
        budgetMonths: [month('2026-11', { potTargets: { savings: { fromOn: { kind: 'amount', value: 200000 } } } })],
      }),
      settings: settings({ horizon: 12 }),
    });
    const r = freedom({ forecast: f, yearlySpending: 2400000, assumptions: rates({ yearlyReturnPct: 0, inflationPct: 0 }), today: TODAY });
    expect(r).toMatchObject({ status: 'ok', ym: '2027-03' });
  });
});

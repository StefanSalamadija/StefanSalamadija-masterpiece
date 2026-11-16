import { describe, expect, it } from 'vitest';
import { category, entry } from '../test/budgetRecords';
import type { BudgetGoal } from '../domain/types';
import { averageMonthlyNeeds, emergencyOutlook, goalProgress } from './goals';

const goal = (fields: Partial<BudgetGoal> = {}): BudgetGoal => ({
  id: 'goal-1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'test', deleted: false,
  scope: 'personal', name: 'Holiday', amount: 120000, targetYm: '2027-03', categoryId: 'goals', ...fields,
});

describe('goalProgress', () => {
  it('suggests the remainder over the months left, the target month included, rounded up to the cent', () => {
    const entries = [entry('2026-09-10', 20000, { categoryId: 'goals' }), entry('2026-10-02', 10000, { categoryId: 'goals' })];
    // Saved €300.00 of €1,200.00; November to March is 5 months: €900.00 ÷ 5 = €180.00.
    expect(goalProgress(goal(), entries, '2026-11', 18000)).toEqual({
      saved: 30000, remaining: 90000, progressPct: 25, monthsLeft: 5, suggestedMonthly: 18000, behind: false,
    });
    expect(goalProgress(goal({ amount: 100000 }), [], '2026-11', 0).suggestedMonthly).toBe(20000);
    expect(goalProgress(goal({ amount: 100001 }), [], '2026-11', 0).suggestedMonthly).toBe(20001);
  });

  it('counts only actual expenses in the linked category, up to the month', () => {
    const entries = [
      entry('2026-10-02', 10000, { categoryId: 'goals' }),
      entry('2026-10-03', 5000, { categoryId: 'goals', status: 'planned' }),
      entry('2026-10-04', 7000, { categoryId: 'other' }),
      entry('2026-10-05', 9000, { categoryId: 'goals', deleted: true }),
      entry('2026-12-01', 4000, { categoryId: 'goals' }),
    ];
    expect(goalProgress(goal(), entries, '2026-11', 0).saved).toBe(10000);
    expect(goalProgress(goal({ categoryId: undefined }), entries, '2026-11', 0).saved).toBe(0);
  });

  it('is behind when the plan puts aside less than suggested, or the month has passed with money missing', () => {
    expect(goalProgress(goal(), [], '2026-11', 23999).behind).toBe(true);
    expect(goalProgress(goal(), [], '2026-11', 24000).behind).toBe(false);
    expect(goalProgress(goal(), [], '2027-04', 0)).toMatchObject({ monthsLeft: 0, suggestedMonthly: 120000, behind: true });
  });

  it('needs nothing once reached, at 100% at most', () => {
    const entries = [entry('2026-10-02', 150000, { categoryId: 'goals' })];
    expect(goalProgress(goal(), entries, '2026-11', 0)).toMatchObject({ remaining: 0, progressPct: 100, suggestedMonthly: 0, behind: false });
  });
});

describe('averageMonthlyNeeds', () => {
  const categories = [category('food', 'needs'), category('fun', 'wants')];

  it('averages Needs spending over the last 6 tracked months before the month', () => {
    const entries = [
      entry('2026-01-05', 99999, { categoryId: 'food' }),                      // the 7th tracked month back: left out
      ...['2026-02', '2026-03', '2026-04', '2026-05', '2026-06'].map((ym) => entry(`${ym}-05`, 30000, { categoryId: 'food' })),
      entry('2026-07-05', 5000, { categoryId: 'fun' }),                        // a tracked month with no Needs
      entry('2026-08-05', 70000, { categoryId: 'food' }),                      // this month: left out
    ];
    expect(averageMonthlyNeeds(entries, categories, '2026-08')).toBe(Math.round((5 * 30000) / 6));
  });

  it('leaves out one-offs, planned and deleted entries, and is 0 with no history', () => {
    const entries = [
      entry('2026-06-05', 40000, { categoryId: 'food' }),
      entry('2026-06-06', 90000, { categoryId: 'food', oneOff: true }),
      entry('2026-06-07', 90000, { categoryId: 'food', status: 'planned' }),
      entry('2026-06-08', 90000, { categoryId: 'food', deleted: true }),
    ];
    expect(averageMonthlyNeeds(entries, categories, '2026-08')).toBe(40000);
    expect(averageMonthlyNeeds([], categories, '2026-08')).toBe(0);
  });
});

describe('emergencyOutlook', () => {
  it('shows the progress and the month the target is reached at the monthly contribution', () => {
    // €2,000.00 of €6,000.00, €500.00 a month from November: 8 months, so reached in June 2027.
    expect(emergencyOutlook({ balance: 200000, target: 600000, monthlyContribution: 50000, ym: '2026-11' }))
      .toEqual({ progressPct: 33, reachedYm: '2027-06' });
  });

  it('is reached already at or above the target, and never without a contribution', () => {
    expect(emergencyOutlook({ balance: 600000, target: 600000, monthlyContribution: 0, ym: '2026-11' })).toEqual({ progressPct: 100, reachedYm: '2026-10' });
    expect(emergencyOutlook({ balance: 100, target: 600000, monthlyContribution: 0, ym: '2026-11' })).toEqual({ progressPct: 0 });
    expect(emergencyOutlook({ balance: 0, target: 0, monthlyContribution: 0, ym: '2026-11' })).toEqual({ progressPct: 100, reachedYm: '2026-10' });
  });
});

import { describe, expect, it } from 'vitest';
import { category, entry } from '../test/budgetRecords';
import { yearlySpending } from './yearlySpending';

const categories = [category('food', 'needs'), category('fun', 'wants'), category('etf', 'savings'), category('loan', 'debts')];
const assumptions = { withdrawalRatePct: 4, emergencyMonths: 6, fundReminderDays: 30 };

describe('yearlySpending', () => {
  it('is the average Needs + Wants of the tracked months before this one, times 12', () => {
    const entries = [
      entry('2026-08-03', 100000, { categoryId: 'food' }), entry('2026-08-04', 20000, { categoryId: 'fun' }),
      entry('2026-09-03', 80000, { categoryId: 'food' }), entry('2026-09-10', 50000, { categoryId: 'etf' }), // a transfer: not spending
      entry('2026-10-02', 999900, { categoryId: 'food' }), // this month: not tracked yet
    ];
    // (120,000 + 80,000) ÷ 2 = 100,000 a month.
    expect(yearlySpending({ entries, categories, assumptions, currentYm: '2026-10' })).toEqual({ amount: 1200000, source: 'average', months: 2 });
  });

  it('takes the last 12 tracked months only, and leaves out one-offs, planned and deleted entries', () => {
    const entries = [
      ...Array.from({ length: 13 }, (_, i) => entry(`${i < 4 ? 2025 : 2026}-${String(((i + 8) % 12) + 1).padStart(2, '0')}-05`, i === 0 ? 900000 : 10000, { categoryId: 'food' })),
      entry('2026-08-06', 500000, { categoryId: 'fun', oneOff: true }),
      entry('2026-08-07', 500000, { categoryId: 'fun', status: 'planned' }),
      entry('2026-08-08', 500000, { categoryId: 'fun', deleted: true }),
    ];
    // 2025-09 … 2026-09 are 13 months; 2025-09 (€9,000) is left out.
    expect(yearlySpending({ entries, categories, assumptions, currentYm: '2026-10' })).toEqual({ amount: 120000, source: 'average', months: 12 });
  });

  it('counts a month tracked by an income entry alone as a month of no spending', () => {
    const entries = [entry('2026-08-03', 120000, { categoryId: 'food' }), entry('2026-09-01', 500000, { kind: 'income', incomeSource: 'salary' })];
    expect(yearlySpending({ entries, categories, assumptions, currentYm: '2026-10' })).toEqual({ amount: 720000, source: 'average', months: 2 });
  });

  it('is 0 with no tracked month', () => {
    expect(yearlySpending({ entries: [], categories, assumptions, currentYm: '2026-10' })).toEqual({ amount: 0, source: 'average', months: 0 });
  });

  it("is the user's own amount when the assumptions give one", () => {
    const entries = [entry('2026-08-03', 100000, { categoryId: 'food' })];
    expect(yearlySpending({ entries, categories, assumptions: { ...assumptions, yearlySpendingCents: 3000000 }, currentYm: '2026-10' }))
      .toEqual({ amount: 3000000, source: 'fixed', months: 0 });
  });
});

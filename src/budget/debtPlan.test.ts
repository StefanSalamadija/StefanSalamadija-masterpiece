import { describe, expect, it } from 'vitest';
import type { BudgetData } from './forecast';
import { forecast } from './forecast';
import { budgetData, category, correction, debt, entry, recurring, settings } from '../test/budgetRecords';
import { debtPayoffs } from './debtPlan';

const TODAY = '2026-11-15';
const CATEGORIES = [category('cat-groc', 'needs'), category('cat-loan', 'debts'), category('cat-extra', 'debts')];
const LOAN = debt({ id: 'd1', startBalance: 100000, startYm: '2026-11', yearlyRatePct: 6, instalment: 30000 });
const data = (fields: Partial<BudgetData> = {}) => budgetData({ budgetCategories: CATEGORIES, budgetDebts: [LOAN], ...fields });
const SETTINGS = settings({ horizon: 12 });
const payoff = (d: BudgetData, whatIfExtra?: { debtId: string; amount: number }) => debtPayoffs({ today: TODAY, data: d, settings: SETTINGS, whatIfExtra })['d1'];

describe('debtPayoffs', () => {
  it("is the forecast's own payoff, with the debt's own interest, even without a bank start", () => {
    // 100,000 at 0.5% a month, 30,000 a month: 70,500 → 40,853 → 11,057 → 0 (as amortise).
    expect(payoff(data())).toEqual({ debtFreeYm: '2027-02', totalInterest: 500 + 353 + 204 + 55 });
    const withBank = data({ budgetCorrections: [correction('bank', '2026-10', 500000)] });
    const f = forecast({ today: TODAY, data: withBank, settings: SETTINGS, months: 120 });
    expect(payoff(withBank)).toEqual({ debtFreeYm: f.debtFree.d1, totalInterest: f.interestByDebt.d1 });
  });

  it('counts the planned payments on the debt', () => {
    const extra = entry('2026-12-01', 40000, { categoryId: 'cat-extra', debtId: 'd1', status: 'planned', oneOff: true });
    expect(payoff(data({ budgetEntries: [extra] })).debtFreeYm).toBe('2027-01');
  });

  it('lets a Debts template without a debt pay the only debt in place of its instalment', () => {
    const t = recurring({ id: 't1', amount: 50000, startYm: '2026-01', categoryId: 'cat-loan' });
    expect(payoff(data({ budgetRecurring: [t] })).debtFreeYm).toBe('2027-01');   // 100,000 → 50,500 → 753 → 0
  });

  it('keeps the instalment when the template that names the debt is booked in another pot', () => {
    const t = recurring({ id: 't1', amount: 50000, startYm: '2026-01', categoryId: 'cat-groc', untilDebtId: 'd1' });
    expect(payoff(data({ budgetRecurring: [t] })).debtFreeYm).toBe('2027-02');
  });

  it('pays the stored extra, and a what-if extra on top of it', () => {
    const stored = data({ budgetDebts: [{ ...LOAN, extraMonthly: 20000 }] });
    expect(payoff(stored).debtFreeYm).toBe('2027-01');
    expect(payoff(stored, { debtId: 'd1', amount: 50000 }).debtFreeYm).toBe('2026-12');
  });

  it('looks far enough ahead for a long debt, and has no month for one never paid off', () => {
    const long = debt({ id: 'd1', startBalance: 3000000, startYm: '2026-11', yearlyRatePct: 0, instalment: 10000 });
    expect(payoff(data({ budgetDebts: [long] })).debtFreeYm).toBe('2051-10');   // 300 payments
    expect(payoff(data({ budgetDebts: [{ ...long, instalment: 0 }] })).debtFreeYm).toBeUndefined();
  });
});

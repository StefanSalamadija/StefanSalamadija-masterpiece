import { describe, expect, it } from 'vitest';
import { asset, category, correction, debt, entry, fund, move } from '../test/budgetRecords';
import { balancesByMonth } from './ledger';
import type { MonthSummary, PotSummary } from './month';
import { netWorthSeries, savingsRate, savingsRateOver } from './netWorth';

const categories = [category('food', 'needs'), category('fun', 'wants'), category('etf', 'savings'), category('ef', 'emergency'), category('loan', 'debts')];
type Input = Parameters<typeof balancesByMonth>[0];
function balances(input: Partial<Input> & { fromYm: string; toYm: string }) {
  return balancesByMonth({ entries: [], corrections: [], debts: [], assets: [], categories, fundMoves: [], funds: [], ...input });
}

describe('netWorthSeries', () => {
  it('leaves the net worth unchanged by a transfer to investments', () => {
    const b = balances({
      entries: [entry('2026-12-05', 40000, { categoryId: 'etf' }), entry('2026-12-06', 10000, { categoryId: 'ef' })],
      corrections: [correction('bank', '2026-11', 100000)], fromYm: '2026-11', toYm: '2026-12',
    });
    const series = netWorthSeries(b, []);
    expect(series.map((m) => m.netWorth)).toEqual([100000, 100000]);
    expect(series[1].parts).toEqual({ bank: 50000, investments: 40000, emergency: 10000 });
  });

  it('counts opted-in assets, subtracts debts, and counts sinking-fund money once (inside the bank)', () => {
    const b = new Map([['2026-11', { bank: 100000, investments: 50000, emergency: 20000, 'debt:car': 30000, 'asset:flat': 900000, 'asset:bike': 5000, 'fund:tax': 7000 }]]);
    const [m] = netWorthSeries(b, [asset('flat'), asset('bike', { includeInNetWorth: false })]);
    expect(m).toEqual({
      ym: '2026-11', netWorth: 100000 + 50000 + 20000 - 30000 + 900000,
      parts: { bank: 100000, investments: 50000, emergency: 20000, 'debt:car': -30000, 'asset:flat': 900000 },
    });
  });

  it('shows the net worth after a correction', () => {
    const b = balances({ corrections: [correction('investments', '2026-12', 123400)], fromYm: '2026-11', toYm: '2026-12' });
    expect(netWorthSeries(b, []).map((m) => m.netWorth)).toEqual([0, 123400]);
  });

  it('equals the sum of its parts in every month', () => {
    const b = balances({
      entries: [
        entry('2026-11-01', 450000, { kind: 'income' }), entry('2026-11-03', 61234, { categoryId: 'food' }),
        entry('2026-11-05', 30000, { categoryId: 'loan' }), entry('2026-11-06', 25000, { categoryId: 'etf' }),
        entry('2026-12-01', 450000, { kind: 'income' }), entry('2026-12-05', 30000, { categoryId: 'loan' }),
        entry('2026-12-09', 15050, { categoryId: 'fun' }), entry('2026-12-10', 10000, { categoryId: 'ef' }),
        entry('2027-01-12', 200000, { kind: 'income', soldAssetId: 'car' }), entry('2027-01-15', 60000, { id: 'bill', categoryId: 'food', fundId: 'tax' }),
        entry('2027-02-05', 30000, { categoryId: 'loan' }), entry('2027-02-06', 25000, { categoryId: 'etf', status: 'planned' }),
      ],
      corrections: [
        correction('bank', '2026-10', 300000), correction('asset:car', '2026-10', 1500000), correction('asset:flat', '2026-10', 2000000),
        correction('investments', '2027-01', 80000),
      ],
      debts: [debt({ id: 'loan', startBalance: 500000, yearlyRatePct: 7.5, instalment: 30000, startYm: '2026-11' })],
      assets: [asset('car'), asset('flat', { includeInNetWorth: false })],
      funds: [fund({ id: 'tax', amount: 60000, dueYm: '2027-01' })],
      fundMoves: [move('tax', '2026-11', 'setaside', 20000), move('tax', '2026-12', 'setaside', 40000), move('tax', '2027-01', 'paid', 60000, { entryId: 'bill' })],
      fromYm: '2026-10', toYm: '2027-03',
    });
    const series = netWorthSeries(b, [asset('car'), asset('flat', { includeInNetWorth: false })]);
    expect(series).toHaveLength(6);
    for (const m of series) {
      expect(m.netWorth).toBe(Object.values(m.parts).reduce((sum, v) => sum + v, 0));
      expect(Number.isInteger(m.netWorth)).toBe(true);
    }
    // A sale at the asset's value changes nothing; the interest is the only cost of the debt.
    expect(series.find((m) => m.ym === '2027-01')!.parts['asset:car']).toBe(1300000);
    expect(Object.keys(series[0].parts)).not.toContain('fund:tax');
  });
});

function summary(ym: string, actualIncome: number, spent: Partial<Record<PotSummary['pot'], number>>): MonthSummary {
  const pots = (['needs', 'savings', 'wants', 'debts', 'emergency'] as const).map((pot) => ({
    pot, target: 0, targetPct: 0, spent: spent[pot] ?? 0, spentPct: 0, unused: 0, planned: 0,
  }));
  return { ym, plannedIncome: 0, actualIncome, pots, targetsPctTotal: 0, surplus: 0, categories: [] };
}

describe('savingsRate', () => {
  it('is (income − Needs − Wants) ÷ income; debt repayment and investing count as saving', () => {
    expect(savingsRate([summary('2026-11', 400000, { needs: 150000, wants: 50000, savings: 100000, debts: 30000 })])).toEqual([{ ym: '2026-11', rate: 0.5 }]);
  });

  it('is null in a month with no income', () => {
    expect(savingsRate([summary('2026-12', 0, { needs: 150000 })])).toEqual([{ ym: '2026-12', rate: null }]);
  });

  it('over several months is their total saving ÷ their total income, null with no income at all', () => {
    const months = [summary('2026-11', 400000, { needs: 200000 }), summary('2026-12', 0, { needs: 100000, wants: 20000 })];
    expect(savingsRateOver(months)).toBeCloseTo((400000 - 320000) / 400000);
    expect(savingsRateOver([summary('2026-12', 0, { needs: 1 })])).toBeNull();
    expect(savingsRateOver([])).toBeNull();
  });
});

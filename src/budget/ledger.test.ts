import { describe, expect, it } from 'vitest';
import { defaultCategoryId } from '../db/budget';
import { asset, category, correction, debt, entry, fund, move, recurring } from '../test/budgetRecords';
import { balancesByMonth, SAVINGS_GOALS_CATEGORY_ID } from './ledger';

const categories = [
  category('food', 'needs'), category('fun', 'wants'), category('etf', 'savings'), category(SAVINGS_GOALS_CATEGORY_ID, 'savings'),
  category('ef', 'emergency'), category('loan', 'debts'),
];

type Input = Parameters<typeof balancesByMonth>[0];
function run(input: Partial<Input> & { fromYm: string; toYm: string }) {
  return balancesByMonth({ entries: [], corrections: [], debts: [], assets: [], categories, fundMoves: [], funds: [], ...input });
}

describe('balancesByMonth', () => {
  it('gives each month end from fromYm to toYm, in order', () => {
    expect([...run({ fromYm: '2026-11', toYm: '2027-02' }).keys()]).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(run({ fromYm: '2026-11', toYm: '2027-02' }).get('2026-11')).toEqual({ bank: 0, investments: 0, emergency: 0 });
  });

  it('raises the bank with income and lowers it with every expense', () => {
    const entries = [
      entry('2026-11-01', 500000, { kind: 'income', incomeSource: 'salary' }), entry('2026-11-03', 12000, { categoryId: 'food' }),
      entry('2026-11-04', 3000), entry('2026-12-02', 8000, { categoryId: 'fun' }),
    ];
    const b = run({ entries, corrections: [correction('bank', '2026-10', 100000)], fromYm: '2026-11', toYm: '2026-12' });
    expect(b.get('2026-11')!.bank).toBe(100000 + 500000 - 12000 - 3000);
    expect(b.get('2026-12')!.bank).toBe(585000 - 8000);
  });

  it('moves a transfer from the bank to investments or the emergency fund', () => {
    const entries = [entry('2026-11-05', 40000, { categoryId: 'etf' }), entry('2026-11-06', 10000, { categoryId: 'ef' })];
    const m = run({ entries, corrections: [correction('bank', '2026-10', 100000)], fromYm: '2026-11', toYm: '2026-11' }).get('2026-11')!;
    expect(m).toEqual({ bank: 50000, investments: 40000, emergency: 10000 });
  });

  it('keeps money for a savings goal in the bank (it is earmarked, not moved)', () => {
    expect(SAVINGS_GOALS_CATEGORY_ID).toBe(defaultCategoryId({ pot: 'savings', name: 'Savings goals' }));
    const entries = [entry('2026-11-05', 40000, { categoryId: SAVINGS_GOALS_CATEGORY_ID })];
    const m = run({ entries, corrections: [correction('bank', '2026-10', 100000)], fromYm: '2026-11', toYm: '2026-11' }).get('2026-11')!;
    expect(m).toEqual({ bank: 100000, investments: 0, emergency: 0 });
  });

  it('leaves planned and deleted entries out', () => {
    const entries = [
      entry('2026-11-05', 40000, { categoryId: 'etf', status: 'planned' }), entry('2026-11-06', 10000, { categoryId: 'food', deleted: true }),
      entry('2026-11-07', 10000, { kind: 'income', status: 'planned' }),
    ];
    expect(run({ entries, fromYm: '2026-11', toYm: '2026-11' }).get('2026-11')).toEqual({ bank: 0, investments: 0, emergency: 0 });
  });

  it('counts entries before fromYm into the first month', () => {
    const entries = [entry('2026-08-01', 70000, { kind: 'income' }), entry('2026-09-10', 20000, { categoryId: 'etf' })];
    expect(run({ entries, fromYm: '2026-11', toYm: '2026-11' }).get('2026-11')).toEqual({ bank: 50000, investments: 20000, emergency: 0 });
  });

  describe('debts', () => {
    it('charges a month of interest on the balance, and the payment (instalment with interest) lowers the debt', () => {
      const loan = debt({ id: 'car', startBalance: 100000, yearlyRatePct: 6, instalment: 30000, startYm: '2026-11' });
      const entries = [entry('2026-11-05', 30000, { categoryId: 'loan' }), entry('2026-12-05', 30000, { categoryId: 'loan' })];
      const b = run({ entries, debts: [loan], corrections: [correction('bank', '2026-10', 100000)], fromYm: '2026-10', toYm: '2027-01' });
      expect(b.get('2026-10')!['debt:car']).toBe(0);
      // As in the hand-computed table: 70,500, then 40,853; with no payment in January the interest (204) is still due.
      expect(b.get('2026-11')).toEqual({ bank: 70000, investments: 0, emergency: 0, 'debt:car': 70500 });
      expect(b.get('2026-12')!['debt:car']).toBe(40853);
      expect(b.get('2027-01')!['debt:car']).toBe(41057);
    });

    it('lowers a debt with no rate by the full payment, extra payments included', () => {
      const loan = debt({ id: 'car', startBalance: 100000, instalment: 30000, startYm: '2026-11' });
      const entries = [entry('2026-11-05', 30000, { categoryId: 'loan' }), entry('2026-11-20', 5000, { categoryId: 'loan' })];
      expect(run({ entries, debts: [loan], fromYm: '2026-11', toYm: '2026-11' }).get('2026-11')!['debt:car']).toBe(65000);
    });

    it('pays the debt the entry\'s recurring template pays off, when there are several', () => {
      const car = debt({ id: 'car', startBalance: 100000, startYm: '2026-11' });
      const card = debt({ id: 'card', startBalance: 50000, startYm: '2026-11' });
      const tpl = recurring({ id: 'card-tpl', amount: 10000, startYm: '2026-11', categoryId: 'loan', untilDebtId: 'card' });
      const entries = [entry('2026-11-05', 10000, { categoryId: 'loan', recurringId: 'card-tpl' })];
      const m = run({ entries, debts: [car, card], recurring: [tpl], fromYm: '2026-11', toYm: '2026-11' }).get('2026-11')!;
      expect(m['debt:car']).toBe(100000);
      expect(m['debt:card']).toBe(40000);
    });

    it('pays the only debt when the entry names none', () => {
      const car = debt({ id: 'car', startBalance: 100000, startYm: '2026-11' });
      const entries = [entry('2026-11-05', 10000, { categoryId: 'loan' })];
      expect(run({ entries, debts: [car], fromYm: '2026-11', toYm: '2026-11' }).get('2026-11')!['debt:car']).toBe(90000);
    });

    it('leaves out deleted debts', () => {
      const car = debt({ id: 'car', startBalance: 100000, startYm: '2026-11', deleted: true });
      expect(run({ debts: [car], fromYm: '2026-11', toYm: '2026-11' }).get('2026-11')).toEqual({ bank: 0, investments: 0, emergency: 0 });
    });
  });

  describe('corrections', () => {
    it('set the balance at that month end, and later months continue from it', () => {
      const entries = [
        entry('2026-11-05', 40000, { categoryId: 'etf' }), entry('2026-12-05', 40000, { categoryId: 'etf' }),
        entry('2027-01-05', 40000, { categoryId: 'etf' }),
      ];
      const b = run({ entries, corrections: [correction('investments', '2026-12', 95000)], fromYm: '2026-11', toYm: '2027-01' });
      expect(b.get('2026-11')!.investments).toBe(40000);
      expect(b.get('2026-12')!.investments).toBe(95000); // the market value, not 80,000
      expect(b.get('2027-01')!.investments).toBe(135000);
    });

    it('take the latest correction of a month, and ignore deleted ones', () => {
      const corrections = [
        correction('bank', '2026-11', 1000, { updatedAt: '2026-12-01T10:00:00.000Z' }),
        correction('bank', '2026-11', 2000, { updatedAt: '2026-12-02T10:00:00.000Z' }),
        correction('bank', '2026-11', 3000, { updatedAt: '2026-12-03T10:00:00.000Z', deleted: true }),
      ];
      expect(run({ corrections, fromYm: '2026-11', toYm: '2026-11' }).get('2026-11')!.bank).toBe(2000);
    });

    it('set a debt, and its interest runs on from the corrected balance', () => {
      const loan = debt({ id: 'car', startBalance: 100000, yearlyRatePct: 6, startYm: '2026-11' });
      const b = run({ debts: [loan], corrections: [correction('debt:car', '2026-11', 80000)], fromYm: '2026-11', toYm: '2026-12' });
      expect(b.get('2026-11')!['debt:car']).toBe(80000);
      expect(b.get('2026-12')!['debt:car']).toBe(80400);
    });

    it('set a fund, and its set-asides and bills run on from it', () => {
      const car = fund({ id: 'car', amount: 60000, dueYm: '2027-03' });
      const fundMoves = [move('car', '2026-11', 'setaside', 12000), move('car', '2026-12', 'setaside', 12000), move('car', '2027-01', 'setaside', 12000)];
      const b = run({ funds: [car], fundMoves, corrections: [correction('fund:car', '2026-12', 30000)], fromYm: '2026-11', toYm: '2027-01' });
      expect(b.get('2026-11')!['fund:car']).toBe(12000);
      expect(b.get('2026-12')!['fund:car']).toBe(30000);
      expect(b.get('2027-01')!['fund:car']).toBe(42000);
      // A correction before fromYm still counts.
      expect(run({ funds: [car], fundMoves, corrections: [correction('fund:car', '2026-11', 5000)], fromYm: '2027-01', toYm: '2027-01' })
        .get('2027-01')!['fund:car']).toBe(29000);
    });
  });

  describe('assets', () => {
    it('take their value from corrections, and a sale lowers the asset it sold (never below zero)', () => {
      const car = asset('car');
      const entries = [
        entry('2026-12-10', 300000, { kind: 'income', incomeSource: 'sales', soldAssetId: 'car' }),
        entry('2027-01-10', 900000, { kind: 'income', incomeSource: 'sales', soldAssetId: 'car' }),
      ];
      const b = run({ entries, assets: [car], corrections: [correction('asset:car', '2026-11', 800000)], fromYm: '2026-11', toYm: '2027-01' });
      expect(b.get('2026-11')).toEqual({ bank: 0, investments: 0, emergency: 0, 'asset:car': 800000 });
      expect(b.get('2026-12')).toEqual({ bank: 300000, investments: 0, emergency: 0, 'asset:car': 500000 });
      expect(b.get('2027-01')).toEqual({ bank: 1200000, investments: 0, emergency: 0, 'asset:car': 0 });
    });
  });

  describe('sinking funds', () => {
    it('hold their balance inside the bank: a set-aside moves no bank money, a bill paid lowers the bank and the fund', () => {
      const car = fund({ id: 'car', amount: 60000, dueYm: '2026-12', startBalance: 20000 });
      const bill = entry('2026-12-15', 60000, { id: 'bill', categoryId: 'food', fundId: 'car' });
      const fundMoves = [move('car', '2026-11', 'setaside', 40000), move('car', '2026-12', 'paid', 60000, { entryId: 'bill' })];
      const b = run({ entries: [bill], funds: [car], fundMoves, corrections: [correction('bank', '2026-10', 100000)], fromYm: '2026-11', toYm: '2026-12' });
      expect(b.get('2026-11')).toEqual({ bank: 100000, investments: 0, emergency: 0, 'fund:car': 60000 });
      expect(b.get('2026-12')).toEqual({ bank: 40000, investments: 0, emergency: 0, 'fund:car': 0 });
    });
  });
});

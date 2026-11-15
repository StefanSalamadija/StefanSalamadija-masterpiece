import { describe, expect, it } from 'vitest';
import type { PotId } from '../domain/types';
import { category, entry, fund, move, plan } from '../test/budgetRecords';
import { categoryBand, summariseMonth, targetsWarning } from './month';

const categories = [
  category('rent', 'needs'), category('food', 'needs'), category('registration', 'needs'),
  category('cafes', 'wants'), category('etf', 'savings'), category('loan', 'debts'), category('emergency', 'emergency'),
];

const pot = (summary: ReturnType<typeof summariseMonth>, id: PotId) => summary.pots.find((p) => p.pot === id)!;

describe('summariseMonth', () => {
  const nov = plan('2026-11', {
    plannedIncome: 400000,
    potTargets: {
      needs: { kind: 'pct', value: 50, inherited: false },
      wants: { kind: 'amount', value: 60000, inherited: false },
      savings: { kind: 'pct', value: 20, inherited: true },
      debts: { kind: 'amount', value: 40000, inherited: false },
      emergency: { kind: 'pct', value: 5, inherited: false },
    },
    categoryTargets: { food: { amount: 50000, inherited: false } },
  });

  it('shows each pot against its target, as an amount and a percentage of planned income', () => {
    const s = summariseMonth({ month: nov, categories, funds: [], fundMoves: [], entries: [
      entry('2026-11-01', 150000, { categoryId: 'rent' }),
      entry('2026-11-10', 55000, { categoryId: 'food' }),
      entry('2026-11-12', 70000, { categoryId: 'cafes' }),
      // Transfers count toward their pot, as in the workbook.
      entry('2026-11-05', 80000, { categoryId: 'etf' }),
      entry('2026-11-05', 40000, { categoryId: 'loan' }),
      entry('2026-11-20', 380000, { kind: 'income', incomeSource: 'salary' }),
      entry('2026-11-25', 5000, { kind: 'income', incomeSource: 'other' }),
      // Other months are left out.
      entry('2026-10-31', 99900, { categoryId: 'rent' }),
      entry('2026-12-01', 99900, { categoryId: 'rent' }),
    ] });
    expect(s.ym).toBe('2026-11');
    expect(s.plannedIncome).toBe(400000);
    expect(s.actualIncome).toBe(385000);
    expect(pot(s, 'needs')).toEqual({ pot: 'needs', target: 200000, targetPct: 50, spent: 205000, spentPct: 51.25, unused: -5000, planned: 0 });
    expect(pot(s, 'wants')).toEqual({ pot: 'wants', target: 60000, targetPct: 15, spent: 70000, spentPct: 17.5, unused: -10000, planned: 0 });
    expect(pot(s, 'savings')).toMatchObject({ target: 80000, spent: 80000, unused: 0 });
    expect(pot(s, 'debts')).toMatchObject({ target: 40000, targetPct: 10, spent: 40000, unused: 0 });
    expect(pot(s, 'emergency')).toMatchObject({ target: 20000, spent: 0, unused: 20000 });
    expect(s.pots.map((p) => p.pot)).toEqual(['needs', 'savings', 'wants', 'debts', 'emergency']);
    expect(s.targetsPctTotal).toBe(100);
    // The surplus is the sum of what is unused: −5,000 − 10,000 + 0 + 0 + 20,000.
    expect(s.surplus).toBe(5000);
    expect(s.categories.find((c) => c.categoryId === 'food')).toEqual({ categoryId: 'food', target: 50000, spent: 55000, band: 'red' });
    expect(s.categories.find((c) => c.categoryId === 'rent')).toEqual({ categoryId: 'rent', spent: 150000, band: 'none' });
  });

  it('counts a planned entry in planned, never in spent or in actual income', () => {
    const s = summariseMonth({ month: nov, categories, funds: [], fundMoves: [], entries: [
      entry('2026-11-05', 40000, { categoryId: 'loan', status: 'planned', recurringId: 't' }),
      entry('2026-11-01', 380000, { kind: 'income', incomeSource: 'salary', status: 'planned' }),
      entry('2026-11-02', 3000, { categoryId: 'loan', deleted: true }),
    ] });
    expect(pot(s, 'debts')).toMatchObject({ spent: 0, planned: 40000, unused: 40000 });
    expect(s.actualIncome).toBe(0);
    expect(s.categories.find((c) => c.categoryId === 'loan')!.spent).toBe(0);
  });

  it('reports targets that do not add up to 100%', () => {
    const off = plan('2026-11', { plannedIncome: 300000, potTargets: {
      needs: { kind: 'pct', value: 60, inherited: false }, wants: { kind: 'amount', value: 90000, inherited: false },
      savings: { kind: 'pct', value: 12.5, inherited: false },
    } });
    const s = summariseMonth({ month: off, categories, entries: [], funds: [], fundMoves: [] });
    expect(s.targetsPctTotal).toBe(102.5);
    expect(targetsWarning(s.targetsPctTotal)).toBe('Targets add up to 102.5% — adjust to 100%.');
    expect(targetsWarning(100)).toBeUndefined();
    expect(targetsWarning(80)).toBe('Targets add up to 80% — adjust to 100%.');
  });

  it('copes with a month without planned income or targets', () => {
    const empty = plan('2026-11');
    const s = summariseMonth({ month: empty, categories, funds: [], fundMoves: [], entries: [entry('2026-11-03', 2500, { categoryId: 'cafes' })] });
    expect(s.plannedIncome).toBe(0);
    expect(pot(s, 'wants')).toEqual({ pot: 'wants', target: 0, targetPct: 0, spent: 2500, spentPct: 0, unused: -2500, planned: 0 });
    expect(s.targetsPctTotal).toBe(0);
    expect(s.surplus).toBe(-2500);
  });

  describe('sinking funds', () => {
    const car = fund({ id: 'car', amount: 60000, dueYm: '2027-03', categoryId: 'registration' });

    it('counts a set-aside against the pot of the fund\'s category, and a pending one as planned', () => {
      const confirmed = summariseMonth({ month: nov, categories, entries: [], funds: [car], fundMoves: [move('car', '2026-11', 'setaside', 12000)] });
      expect(pot(confirmed, 'needs')).toMatchObject({ spent: 12000, planned: 0 });
      expect(confirmed.categories.find((c) => c.categoryId === 'registration')!.spent).toBe(12000);
      // Not yet confirmed: 60,000 over November to March (5 months).
      const pending = summariseMonth({ month: nov, categories, entries: [], funds: [car], fundMoves: [] });
      expect(pot(pending, 'needs')).toMatchObject({ spent: 0, planned: 12000 });
    });

    it('does not count a bill paid from the fund twice against the pot', () => {
      const mar = plan('2027-03', { plannedIncome: 400000, potTargets: { needs: { kind: 'pct', value: 50, inherited: false } } });
      const moves = [
        move('car', '2026-11', 'setaside', 12000), move('car', '2026-12', 'setaside', 12000), move('car', '2027-01', 'setaside', 12000),
        move('car', '2027-02', 'setaside', 12000), move('car', '2027-03', 'setaside', 12000, { seq: 1 }),
        move('car', '2027-03', 'paid', 60000, { seq: 2, entryId: 'bill' }),
      ];
      const bill = entry('2027-03-10', 60000, { id: 'bill', categoryId: 'registration', fundId: 'car' });
      const s = summariseMonth({ month: mar, categories, entries: [bill], funds: [car], fundMoves: moves });
      // Only March's set-aside counts: the bill itself was covered by the fund.
      expect(pot(s, 'needs')).toMatchObject({ spent: 12000, unused: 188000 });
    });

    it('shows the part of a bill the fund could not cover as overspend', () => {
      const mar = plan('2027-03', { plannedIncome: 400000, potTargets: { needs: { kind: 'amount', value: 10000, inherited: false } } });
      const moves = [
        move('car', '2026-11', 'setaside', 40000),
        // The fund held 40,000: it gives that, and is empty.
        move('car', '2027-03', 'paid', 40000, { entryId: 'bill' }),
      ];
      const bill = entry('2027-03-10', 65000, { id: 'bill', categoryId: 'registration', fundId: 'car' });
      const s = summariseMonth({ month: mar, categories, entries: [bill], funds: [car], fundMoves: moves });
      expect(pot(s, 'needs')).toMatchObject({ spent: 25000, unused: -15000 });
      // The same when the fund record was written for the whole bill: the fund can give only what it holds.
      const whole = summariseMonth({ month: mar, categories, entries: [bill], funds: [car],
        fundMoves: [moves[0], move('car', '2027-03', 'paid', 65000, { entryId: 'bill' })] });
      expect(pot(whole, 'needs')).toMatchObject({ spent: 25000 });
    });
  });
});

describe('categoryBand', () => {
  it('is amber from 90% of the target and red over it', () => {
    expect(categoryBand(8900, 10000)).toBe('ok');
    expect(categoryBand(9000, 10000)).toBe('amber');
    expect(categoryBand(10000, 10000)).toBe('amber');
    expect(categoryBand(10100, 10000)).toBe('red');
    expect(categoryBand(10001, 10000)).toBe('red');
    expect(categoryBand(500, undefined)).toBe('none');
    expect(categoryBand(0, 0)).toBe('ok');
    expect(categoryBand(1, 0)).toBe('red');
  });

  it('is the band each category shows in the month', () => {
    const m = plan('2026-11', { categoryTargets: {
      rent: { amount: 10000, inherited: false }, food: { amount: 10000, inherited: false },
      cafes: { amount: 10000, inherited: false }, etf: { amount: 10000, inherited: false },
    } });
    const s = summariseMonth({ month: m, categories, funds: [], fundMoves: [], entries: [
      entry('2026-11-01', 8900, { categoryId: 'rent' }), entry('2026-11-01', 9000, { categoryId: 'food' }),
      entry('2026-11-01', 10000, { categoryId: 'cafes' }), entry('2026-11-01', 10100, { categoryId: 'etf' }),
    ] });
    const band = (id: string) => s.categories.find((c) => c.categoryId === id)!.band;
    expect([band('rent'), band('food'), band('cafes'), band('etf'), band('loan')]).toEqual(['ok', 'amber', 'amber', 'red', 'none']);
  });
});

import { describe, expect, it } from 'vitest';
import type { BudgetMonth } from '../domain/types';
import { month } from '../test/budgetRecords';
import { effectiveMonth, potTargetAmount, setCategoryTarget, setPotTarget } from './targets';
import type { MonthChanges } from './targets';

/** Saves the changes the way the app does: a new record is added with a fresh id, a changed one replaced. */
function apply(months: BudgetMonth[], changes: MonthChanges): BudgetMonth[] {
  const next = months.map((m) => changes.update.find((u) => u.id === m.id) ?? m);
  changes.create.forEach((c, i) => next.push(month(c.ym, { ...c, id: `new-${c.ym}-${next.length}-${i}` })));
  return next;
}

const needs = (months: BudgetMonth[], ym: string) => effectiveMonth(months, ym).potTargets.needs;
const value = (months: BudgetMonth[], ym: string) => needs(months, ym)?.value;
const food = (months: BudgetMonth[], ym: string) => effectiveMonth(months, ym).categoryTargets.food?.amount;
/** `n` months from `from` on. */
const yms = (from: string, n: number) => Array.from({ length: n }, (_, i) => {
  const [y, m] = from.split('-').map(Number);
  const k = y * 12 + m - 1 + i;
  return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, '0')}`;
});

describe('effectiveMonth', () => {
  it('uses the month\'s own targets, and the latest earlier "from this month on" ones, marked inherited', () => {
    const jan = month('2026-01', { plannedIncome: 300000, notes: 'January',
      potTargets: { needs: { kind: 'pct', value: 50, origin: 'fromOn' }, wants: { kind: 'pct', value: 30, origin: 'this' } },
      categoryTargets: { food: { amount: 40000, origin: 'fromOn' } } });
    const mar = month('2026-03', { plannedIncome: 320000, potTargets: { needs: { kind: 'pct', value: 45, origin: 'fromOn' } } });
    expect(effectiveMonth([mar, jan], '2026-01')).toEqual({ ym: '2026-01', plannedIncome: 300000, notes: 'January', record: jan,
      potTargets: { needs: { kind: 'pct', value: 50, inherited: false }, wants: { kind: 'pct', value: 30, inherited: false } },
      categoryTargets: { food: { amount: 40000, inherited: false } } });
    // February has no record; January's "this month only" target does not pass on.
    expect(effectiveMonth([mar, jan], '2026-02')).toEqual({ ym: '2026-02', plannedIncome: 300000,
      potTargets: { needs: { kind: 'pct', value: 50, inherited: true } }, categoryTargets: { food: { amount: 40000, inherited: true } } });
    expect(effectiveMonth([mar, jan], '2026-05')).toMatchObject({ plannedIncome: 320000, potTargets: { needs: { value: 45, inherited: true } } });
    expect(effectiveMonth([mar, jan], '2026-05').record).toBeUndefined();
  });

  it('is an empty plan when no earlier month exists, and ignores deleted months', () => {
    const later = month('2026-06', { potTargets: { needs: { kind: 'pct', value: 50, origin: 'fromOn' } } });
    const gone = month('2026-01', { deleted: true, potTargets: { needs: { kind: 'pct', value: 10, origin: 'fromOn' } } });
    expect(effectiveMonth([later, gone], '2026-03')).toEqual({ ym: '2026-03', potTargets: {}, categoryTargets: {} });
  });
});

describe('setPotTarget', () => {
  const jan = () => month('2026-01', { id: 'jan', potTargets: { needs: { kind: 'pct', value: 50, origin: 'fromOn' } } });

  it('"from this month on" reaches every later month but one edited individually', () => {
    let months = [jan()];
    months = apply(months, setPotTarget(months, '2026-04', 'needs', { kind: 'pct', value: 30 }, 'this'));
    months = apply(months, setPotTarget(months, '2026-07', 'wants', { kind: 'pct', value: 20 }, 'this'));
    months = apply(months, setPotTarget(months, '2026-02', 'needs', { kind: 'pct', value: 55 }, 'fromOn'));
    expect(needs(months, '2026-01')).toEqual({ kind: 'pct', value: 50, inherited: false });
    expect(needs(months, '2026-02')).toEqual({ kind: 'pct', value: 55, inherited: false });
    expect(yms('2026-03', 22).map((ym) => value(months, ym))).toEqual(yms('2026-03', 22).map((ym) => (ym === '2026-04' ? 30 : 55)));
    expect(needs(months, '2026-07')).toEqual({ kind: 'pct', value: 55, inherited: true });
  });

  it('"this month only" changes one month only, and stores that month alone', () => {
    const months = [jan()];
    const changes = setPotTarget(months, '2026-03', 'needs', { kind: 'amount', value: 120000 }, 'this');
    expect(changes).toEqual({ create: [{ ym: '2026-03', potTargets: { needs: { kind: 'amount', value: 120000, origin: 'this' } }, categoryTargets: {} }], update: [] });
    const after = apply(months, changes);
    expect(needs(after, '2026-03')).toEqual({ kind: 'amount', value: 120000, inherited: false });
    expect(['2026-02', '2026-04', '2026-09'].map((ym) => needs(after, ym))).toEqual(Array(3).fill({ kind: 'pct', value: 50, inherited: true }));
  });

  it('a later "from this month on" edit blocks an earlier one', () => {
    let months = [jan()];
    months = apply(months, setPotTarget(months, '2026-05', 'needs', { kind: 'pct', value: 40 }, 'fromOn'));
    months = apply(months, setPotTarget(months, '2026-08', 'wants', { kind: 'pct', value: 10 }, 'this'));
    months = apply(months, setPotTarget(months, '2026-01', 'needs', { kind: 'pct', value: 60 }, 'fromOn'));
    expect(yms('2026-01', 12).map((ym) => value(months, ym))).toEqual([60, 60, 60, 60, 40, 40, 40, 40, 40, 40, 40, 40]);
  });

  it('regression (I-1): going back to an earlier value later on does not let an earlier edit leak past it', () => {
    let months = [jan()];
    months = apply(months, setPotTarget(months, '2026-05', 'needs', { kind: 'pct', value: 40 }, 'fromOn'));
    months = apply(months, setPotTarget(months, '2026-09', 'needs', { kind: 'pct', value: 50 }, 'fromOn'));
    months = apply(months, setPotTarget(months, '2026-12', 'wants', { kind: 'pct', value: 15 }, 'this'));
    months = apply(months, setPotTarget(months, '2026-01', 'needs', { kind: 'pct', value: 60 }, 'fromOn'));
    expect(yms('2026-01', 18).map((ym) => value(months, ym))).toEqual([60, 60, 60, 60, 40, 40, 40, 40, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50]);
  });

  it('a "from this month on" edit of a month edited for itself carries on after it', () => {
    let months = [jan()];
    months = apply(months, setPotTarget(months, '2026-03', 'needs', { kind: 'pct', value: 30 }, 'this'));
    months = apply(months, setPotTarget(months, '2026-03', 'needs', { kind: 'pct', value: 40 }, 'fromOn'));
    expect(yms('2026-01', 6).map((ym) => value(months, ym))).toEqual([50, 50, 40, 40, 40, 40]);
    expect(needs(months, '2026-03')).toMatchObject({ inherited: false });
  });

  it('changes nothing when the edit is already there, and leaves the input alone', () => {
    const months = [jan()];
    const before = JSON.stringify(months);
    expect(setPotTarget(months, '2026-01', 'needs', { kind: 'pct', value: 50 }, 'fromOn')).toEqual({ create: [], update: [] });
    const other = setPotTarget(months, '2026-01', 'wants', { kind: 'pct', value: 30 }, 'fromOn');
    expect(other.create).toEqual([]);
    expect(other.update).toHaveLength(1);
    expect(other.update[0]).toMatchObject({ id: 'jan', potTargets: { needs: { value: 50 }, wants: { kind: 'pct', value: 30, origin: 'fromOn' } } });
    expect(JSON.stringify(months)).toBe(before);
  });
});

describe('setCategoryTarget', () => {
  it('sets a category target for one month only or from this month on', () => {
    let months = [month('2026-01', { id: 'jan' })];
    months = apply(months, setCategoryTarget(months, '2026-01', 'food', 40000, 'fromOn'));
    months = apply(months, setCategoryTarget(months, '2026-03', 'food', 50000, 'this'));
    expect(effectiveMonth(months, '2026-02').categoryTargets.food).toEqual({ amount: 40000, inherited: true });
    expect(effectiveMonth(months, '2026-03').categoryTargets.food).toEqual({ amount: 50000, inherited: false });
    expect(effectiveMonth(months, '2026-04').categoryTargets.food).toEqual({ amount: 40000, inherited: true });
  });

  it('keeps a removed target as "no target", which passes on from this month on', () => {
    let months = [month('2026-01', { id: 'jan', categoryTargets: { food: { amount: 40000, origin: 'fromOn' } } })];
    const changes = setCategoryTarget(months, '2026-04', 'food', undefined, 'fromOn');
    expect(changes.create[0].categoryTargets).toEqual({ food: { amount: null, origin: 'fromOn' } });
    months = apply(months, changes);
    months = apply(months, setCategoryTarget(months, '2026-06', 'food', undefined, 'this'));
    expect(yms('2026-01', 8).map((ym) => food(months, ym))).toEqual([40000, 40000, 40000, undefined, undefined, undefined, undefined, undefined]);
  });

  it('regression (I-2): a target removed on purpose is not filled in again by an earlier edit', () => {
    let months = [month('2026-01', { id: 'jan' })];
    months = apply(months, setCategoryTarget(months, '2026-03', 'food', 80000, 'fromOn'));
    months = apply(months, setCategoryTarget(months, '2026-06', 'food', undefined, 'fromOn'));
    months = apply(months, setPotTarget(months, '2026-08', 'wants', { kind: 'pct', value: 10 }, 'this'));
    months = apply(months, setCategoryTarget(months, '2026-01', 'food', 50000, 'fromOn'));
    expect(yms('2026-01', 10).map((ym) => food(months, ym)))
      .toEqual([50000, 50000, 80000, 80000, 80000, undefined, undefined, undefined, undefined, undefined]);
  });
});

describe('potTargetAmount', () => {
  it('works a percentage out of planned income, to the cent', () => {
    expect(potTargetAmount({ kind: 'pct', value: 50 }, 300001)).toBe(150001);
    expect(potTargetAmount({ kind: 'pct', value: 12.5 }, 100000)).toBe(12500);
    expect(potTargetAmount({ kind: 'amount', value: 70000 }, 300000)).toBe(70000);
    expect(potTargetAmount(undefined, 300000)).toBe(0);
  });
});

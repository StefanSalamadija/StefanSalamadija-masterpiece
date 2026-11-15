import { describe, expect, it } from 'vitest';
import type { BudgetMonth } from '../domain/types';
import { month } from '../test/budgetRecords';
import { effectiveMonth, isNewMonth, potTargetAmount, setCategoryTarget, setPotTarget } from './targets';

/** Applies changed records the way the app saves them: a new one is added, a stored one replaced. */
function apply(months: BudgetMonth[], changed: BudgetMonth[]): BudgetMonth[] {
  const next = [...months];
  changed.forEach((m, i) => {
    const at = next.findIndex((n) => !isNewMonth(m) && n.id === m.id);
    if (at >= 0) next[at] = m;
    else next.push({ ...m, id: `new-${m.ym}-${i}-${next.length}` });
  });
  return next;
}

const needs = (months: BudgetMonth[], ym: string) => effectiveMonth(months, ym).potTargets.needs;

describe('effectiveMonth', () => {
  it('is the stored month when there is one', () => {
    const jan = month('2026-01', { plannedIncome: 300000, potTargets: { needs: { kind: 'pct', value: 50, inherited: false } } });
    expect(effectiveMonth([jan], '2026-01')).toBe(jan);
  });

  it('inherits plan and targets from the latest earlier month, marked inherited', () => {
    const jan = month('2026-01', { plannedIncome: 300000, notes: 'January',
      potTargets: { needs: { kind: 'pct', value: 50, inherited: false } }, categoryTargets: { food: { amount: 40000, inherited: false } } });
    const mar = month('2026-03', { plannedIncome: 320000, potTargets: { needs: { kind: 'pct', value: 45, inherited: false } } });
    const may = effectiveMonth([mar, jan], '2026-05');
    expect(may).toMatchObject({ ym: '2026-05', plannedIncome: 320000, potTargets: { needs: { kind: 'pct', value: 45, inherited: true } } });
    expect(isNewMonth(may)).toBe(true);
    const feb = effectiveMonth([mar, jan], '2026-02');
    expect(feb.categoryTargets).toEqual({ food: { amount: 40000, inherited: true } });
    expect(feb.notes).toBeUndefined();
  });

  it('is an empty plan when no earlier month exists, and ignores deleted months', () => {
    const later = month('2026-06', { potTargets: { needs: { kind: 'pct', value: 50, inherited: false } } });
    const gone = month('2026-01', { deleted: true, potTargets: { needs: { kind: 'pct', value: 10, inherited: false } } });
    const m = effectiveMonth([later, gone], '2026-03');
    expect(m).toMatchObject({ ym: '2026-03', potTargets: {}, categoryTargets: {}, scope: 'personal', deleted: false });
    expect(m.plannedIncome).toBeUndefined();
  });
});

describe('setPotTarget', () => {
  const jan = () => month('2026-01', { id: 'jan', potTargets: { needs: { kind: 'pct', value: 50, inherited: false } } });

  it('"from this month on" changes this month and every later one that inherits, but not one edited individually', () => {
    let months = [jan()];
    // April edited for itself only.
    months = apply(months, setPotTarget(months, '2026-04', 'needs', { kind: 'pct', value: 30 }, 'this'));
    // A stored later month that inherits January's value.
    months = apply(months, setPotTarget(months, '2026-07', 'wants', { kind: 'pct', value: 20 }, 'this'));
    expect(needs(months, '2026-07')).toEqual({ kind: 'pct', value: 50, inherited: true });

    months = apply(months, setPotTarget(months, '2026-02', 'needs', { kind: 'pct', value: 55 }, 'fromOn'));
    expect(needs(months, '2026-01')).toEqual({ kind: 'pct', value: 50, inherited: false });
    expect(needs(months, '2026-02')).toEqual({ kind: 'pct', value: 55, inherited: false });
    expect(needs(months, '2026-03')).toMatchObject({ kind: 'pct', value: 55 });
    expect(needs(months, '2026-04')).toEqual({ kind: 'pct', value: 30, inherited: false });
    expect(needs(months, '2026-05')).toMatchObject({ kind: 'pct', value: 55 });
    expect(needs(months, '2026-07')).toEqual({ kind: 'pct', value: 55, inherited: true });
    expect(needs(months, '2027-01')).toMatchObject({ kind: 'pct', value: 55 });
  });

  it('"this month only" changes one month only', () => {
    let months = [jan()];
    const changed = setPotTarget(months, '2026-03', 'needs', { kind: 'amount', value: 120000 }, 'this');
    months = apply(months, changed);
    expect(needs(months, '2026-02')).toMatchObject({ kind: 'pct', value: 50 });
    expect(needs(months, '2026-03')).toEqual({ kind: 'amount', value: 120000, inherited: false });
    expect(needs(months, '2026-04')).toMatchObject({ kind: 'pct', value: 50 });
    expect(needs(months, '2026-09')).toMatchObject({ kind: 'pct', value: 50 });
    // Only new records: March, and April to hold the plan that continues after it.
    expect(changed.map((m) => m.ym)).toEqual(['2026-03', '2026-04']);
    expect(changed.every(isNewMonth)).toBe(true);
  });

  it('does not reach past a later "from this month on" edit', () => {
    let months = [jan()];
    months = apply(months, setPotTarget(months, '2026-05', 'needs', { kind: 'pct', value: 40 }, 'fromOn'));
    months = apply(months, setPotTarget(months, '2026-08', 'wants', { kind: 'pct', value: 10 }, 'this'));
    months = apply(months, setPotTarget(months, '2026-01', 'needs', { kind: 'pct', value: 60 }, 'fromOn'));
    expect(needs(months, '2026-04')).toMatchObject({ value: 60 });
    expect(needs(months, '2026-05')).toMatchObject({ value: 40, inherited: false });
    expect(needs(months, '2026-08')).toMatchObject({ value: 40, inherited: true });
    expect(needs(months, '2026-12')).toMatchObject({ value: 40 });
  });

  it('a "from this month on" edit of a month edited for itself carries on after it', () => {
    let months = [jan()];
    months = apply(months, setPotTarget(months, '2026-03', 'needs', { kind: 'pct', value: 30 }, 'this'));
    months = apply(months, setPotTarget(months, '2026-03', 'needs', { kind: 'pct', value: 40 }, 'fromOn'));
    expect(needs(months, '2026-02')).toMatchObject({ value: 50 });
    expect(needs(months, '2026-03')).toMatchObject({ value: 40, inherited: false });
    expect(needs(months, '2026-04')).toMatchObject({ value: 40, inherited: true });
    expect(needs(months, '2026-10')).toMatchObject({ value: 40 });
  });

  it('returns only the records that changed, and leaves the input alone', () => {
    const months = [jan(), month('2026-02', { id: 'feb', potTargets: { needs: { kind: 'pct', value: 50, inherited: true } } })];
    const before = JSON.stringify(months);
    const changed = setPotTarget(months, '2026-01', 'needs', { kind: 'pct', value: 50 }, 'fromOn');
    expect(changed).toEqual([]);
    const other = setPotTarget(months, '2026-01', 'wants', { kind: 'pct', value: 30 }, 'fromOn');
    expect(other.map((m) => m.id)).toEqual(['jan', 'feb']);
    expect(other[1].potTargets.wants).toEqual({ kind: 'pct', value: 30, inherited: true });
    expect(JSON.stringify(months)).toBe(before);
  });
});

describe('setCategoryTarget', () => {
  it('sets, inherits and clears a category target with the same two choices', () => {
    let months = [month('2026-01', { id: 'jan' })];
    months = apply(months, setCategoryTarget(months, '2026-01', 'food', 40000, 'fromOn'));
    months = apply(months, setCategoryTarget(months, '2026-03', 'food', 50000, 'this'));
    expect(effectiveMonth(months, '2026-02').categoryTargets.food).toEqual({ amount: 40000, inherited: true });
    expect(effectiveMonth(months, '2026-03').categoryTargets.food).toEqual({ amount: 50000, inherited: false });
    expect(effectiveMonth(months, '2026-04').categoryTargets.food).toEqual({ amount: 40000, inherited: true });

    months = apply(months, setCategoryTarget(months, '2026-02', 'food', undefined, 'fromOn'));
    expect(effectiveMonth(months, '2026-01').categoryTargets.food).toMatchObject({ amount: 40000 });
    expect(effectiveMonth(months, '2026-02').categoryTargets.food).toBeUndefined();
    expect(effectiveMonth(months, '2026-03').categoryTargets.food).toMatchObject({ amount: 50000 });
    expect(effectiveMonth(months, '2026-04').categoryTargets.food).toBeUndefined();
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

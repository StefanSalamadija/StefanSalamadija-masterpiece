import { describe, expect, it } from 'vitest';
import type { BudgetMonth } from '../domain/types';
import { month } from '../test/budgetRecords';
import { editOrigin, effectiveMonth, monthRecordId, potTargetAmount, setCategoryTarget, setPlannedIncome, setPotTarget } from './targets';
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
    const jan = month('2026-01', { plannedIncome: { fromOn: 300000 }, notes: 'January',
      potTargets: { needs: { fromOn: { kind: 'pct', value: 50 } }, wants: { thisOnly: { kind: 'pct', value: 30 } } },
      categoryTargets: { food: { fromOn: 40000 } } });
    const mar = month('2026-03', { plannedIncome: { fromOn: 320000 }, potTargets: { needs: { fromOn: { kind: 'pct', value: 45 } } } });
    expect(effectiveMonth([mar, jan], '2026-01')).toEqual({ ym: '2026-01', plannedIncome: 300000, plannedIncomeInherited: false, notes: 'January', record: jan,
      potTargets: { needs: { kind: 'pct', value: 50, inherited: false }, wants: { kind: 'pct', value: 30, inherited: false } },
      categoryTargets: { food: { amount: 40000, inherited: false } } });
    // February has no record; January's "this month only" target does not pass on.
    expect(effectiveMonth([mar, jan], '2026-02')).toEqual({ ym: '2026-02', plannedIncome: 300000, plannedIncomeInherited: true,
      potTargets: { needs: { kind: 'pct', value: 50, inherited: true } }, categoryTargets: { food: { amount: 40000, inherited: true } } });
    expect(effectiveMonth([mar, jan], '2026-05')).toMatchObject({ plannedIncome: 320000, potTargets: { needs: { value: 45, inherited: true } } });
    expect(effectiveMonth([mar, jan], '2026-05').record).toBeUndefined();
  });

  it('is an empty plan when no earlier month exists, and ignores deleted months', () => {
    const later = month('2026-06', { potTargets: { needs: { fromOn: { kind: 'pct', value: 50 } } } });
    const gone = month('2026-01', { deleted: true, potTargets: { needs: { fromOn: { kind: 'pct', value: 10 } } } });
    expect(effectiveMonth([later, gone], '2026-03')).toEqual({ ym: '2026-03', potTargets: {}, categoryTargets: {} });
  });
});

describe('setPotTarget', () => {
  const jan = () => month('2026-01', { id: 'jan', potTargets: { needs: { fromOn: { kind: 'pct', value: 50 } } } });

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
    expect(changes).toEqual({ create: [{ ym: '2026-03', potTargets: { needs: { thisOnly: { kind: 'amount', value: 120000 } } }, categoryTargets: {} }], update: [] });
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

  it('regression (N-1): "this month only" in a month with a "from this month on" target keeps that target going', () => {
    let months = [jan()];
    months = apply(months, setPotTarget(months, '2026-05', 'needs', { kind: 'pct', value: 40 }, 'fromOn'));
    const changes = setPotTarget(months, '2026-05', 'needs', { kind: 'pct', value: 45 }, 'this');
    expect(changes.update[0].potTargets.needs).toEqual({ fromOn: { kind: 'pct', value: 40 }, thisOnly: { kind: 'pct', value: 45 } });
    months = apply(months, changes);
    expect(yms('2026-03', 6).map((ym) => value(months, ym))).toEqual([50, 50, 45, 40, 40, 40]);
    expect(needs(months, '2026-06')).toEqual({ kind: 'pct', value: 40, inherited: true });
    // "From this month on" in that month again drops its own override.
    months = apply(months, setPotTarget(months, '2026-05', 'needs', { kind: 'pct', value: 35 }, 'fromOn'));
    expect(months.find((m) => m.ym === '2026-05')!.potTargets.needs).toEqual({ fromOn: { kind: 'pct', value: 35 } });
    expect(yms('2026-04', 4).map((ym) => value(months, ym))).toEqual([50, 35, 35, 35]);
  });

  it('changes nothing when the edit is already there, and leaves the input alone', () => {
    const months = [jan()];
    const before = JSON.stringify(months);
    expect(setPotTarget(months, '2026-01', 'needs', { kind: 'pct', value: 50 }, 'fromOn')).toEqual({ create: [], update: [] });
    const other = setPotTarget(months, '2026-01', 'wants', { kind: 'pct', value: 30 }, 'fromOn');
    expect(other.create).toEqual([]);
    expect(other.update).toHaveLength(1);
    expect(other.update[0]).toMatchObject({ id: 'jan', potTargets: { needs: { fromOn: { value: 50 } }, wants: { fromOn: { kind: 'pct', value: 30 } } } });
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
    let months = [month('2026-01', { id: 'jan', categoryTargets: { food: { fromOn: 40000 } } })];
    const changes = setCategoryTarget(months, '2026-04', 'food', undefined, 'fromOn');
    expect(changes.create[0].categoryTargets).toEqual({ food: { fromOn: null } });
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

describe('setCategoryTarget, N-1', () => {
  it('regression (N-1): "this month only" in a month with a "from this month on" category target keeps that target going', () => {
    let months = [month('2026-01', { id: 'jan', categoryTargets: { food: { fromOn: 50000 } } })];
    months = apply(months, setCategoryTarget(months, '2026-05', 'food', 40000, 'fromOn'));
    months = apply(months, setCategoryTarget(months, '2026-05', 'food', 45000, 'this'));
    expect(yms('2026-04', 4).map((ym) => food(months, ym))).toEqual([50000, 45000, 40000, 40000]);
    // Removed for one month only: the month after still has the target.
    months = apply(months, setCategoryTarget(months, '2026-07', 'food', undefined, 'this'));
    expect(yms('2026-06', 3).map((ym) => food(months, ym))).toEqual([40000, undefined, 40000]);
  });
});

describe('setPlannedIncome', () => {
  it('regression (N-2): a "this month only" income change applies to that month alone', () => {
    let months = [month('2026-01', { id: 'jan' })];
    months = apply(months, setPlannedIncome(months, '2026-01', 400000, 'fromOn'));
    months = apply(months, setPlannedIncome(months, '2026-03', 250000, 'this'));
    const income = (ym: string) => effectiveMonth(months, ym).plannedIncome;
    expect(['2026-02', '2026-03', '2026-04', '2026-12'].map(income)).toEqual([400000, 250000, 400000, 400000]);
    expect(effectiveMonth(months, '2026-03').plannedIncomeInherited).toBe(false);
    expect(effectiveMonth(months, '2026-04').plannedIncomeInherited).toBe(true);
  });

  it('changes planned income from a month on, up to a later "from this month on" change', () => {
    let months = [month('2026-01', { id: 'jan', plannedIncome: { fromOn: 400000 } })];
    months = apply(months, setPlannedIncome(months, '2026-06', 300000, 'fromOn'));
    months = apply(months, setPlannedIncome(months, '2026-03', 450000, 'fromOn'));
    months = apply(months, setPlannedIncome(months, '2026-09', undefined, 'fromOn'));
    expect(yms('2026-01', 10).map((ym) => effectiveMonth(months, ym).plannedIncome))
      .toEqual([400000, 400000, 450000, 450000, 450000, 300000, 300000, 300000, undefined, undefined]);
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

describe('editOrigin', () => {
  const needs = (m: BudgetMonth) => m.potTargets.needs;
  const months = [
    month('2026-10', { potTargets: { needs: { fromOn: { kind: 'pct', value: 50 } } } }),
    month('2026-12', { potTargets: { needs: { thisOnly: { kind: 'pct', value: 30 } } } }),
  ];

  it('names the month a value comes from, and whether it is for that month only', () => {
    expect(editOrigin(months, '2026-09', needs)).toBeUndefined();
    expect(editOrigin(months, '2026-10', needs)).toEqual({ scope: 'fromOn', ym: '2026-10' });
    expect(editOrigin(months, '2026-11', needs)).toEqual({ scope: 'fromOn', ym: '2026-10' });
    expect(editOrigin(months, '2026-12', needs)).toEqual({ scope: 'this', ym: '2026-12' });
    expect(editOrigin(months, '2027-01', needs)).toEqual({ scope: 'fromOn', ym: '2026-10' });
    expect(editOrigin([{ ...months[0], deleted: true }], '2026-11', needs)).toBeUndefined();
  });
});

describe('duplicate month records (I2)', () => {
  const older = (fields: Partial<BudgetMonth> = {}) => month('2026-12', { id: 'dev-a', createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z', ...fields });
  const newer = (fields: Partial<BudgetMonth> = {}) => month('2026-12', { id: 'dev-b', createdAt: '2026-11-02T10:00:00.000Z', updatedAt: '2026-11-03T10:00:00.000Z', ...fields });

  it('folds two records of one month: each one\'s edits survive', () => {
    const months = [
      newer({ notes: 'Winter tyres' }),
      older({ potTargets: { wants: { fromOn: { kind: 'amount', value: 30000 } } } }),
    ];
    const plan = effectiveMonth(months, '2026-12');
    expect(plan.potTargets.wants).toEqual({ kind: 'amount', value: 30000, inherited: false });
    expect(plan.notes).toBe('Winter tyres');
    expect(effectiveMonth(months, '2027-01').potTargets.wants).toEqual({ kind: 'amount', value: 30000, inherited: true });
  });

  it('takes the later-updated record for a value both set, and its notes', () => {
    const months = [
      older({ potTargets: { needs: { fromOn: { kind: 'amount', value: 100 } } }, notes: 'old' }),
      newer({ potTargets: { needs: { fromOn: { kind: 'amount', value: 200 } } }, notes: 'new' }),
    ];
    const plan = effectiveMonth(months, '2026-12');
    expect(plan.potTargets.needs?.value).toBe(200);
    expect(plan.notes).toBe('new');
  });

  it('reads the canonical record, and an edit of a folded month carries every record\'s values', () => {
    const months = [
      older({ notes: 'Winter tyres' }),
      newer({ id: monthRecordId('2026-12'), potTargets: { wants: { fromOn: { kind: 'amount', value: 30000 } } } }),
    ];
    expect(effectiveMonth(months, '2026-12').record?.id).toBe('budget-month:2026-12');
    const { update } = setPlannedIncome(months, '2026-12', 400000, 'fromOn');
    expect(update).toHaveLength(1);
    expect(update[0]).toMatchObject({ id: 'budget-month:2026-12', notes: 'Winter tyres', potTargets: { wants: { fromOn: { kind: 'amount', value: 30000 } } } });
  });
});

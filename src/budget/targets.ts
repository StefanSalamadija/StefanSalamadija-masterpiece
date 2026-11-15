import type { BudgetMonth, Cents, PotId, PotTarget, Ym } from '../domain/types';
import { addMonths } from './months';

/*
 * A month's plan (planned income, pot targets, category targets) and how it carries on from month to month.
 *
 * A month with no stored plan uses the plan of the latest earlier stored month, every target marked `inherited`. A
 * target set in a month is `inherited: false` ("edited individually"); a stored month holds a copy of every target it
 * uses, so a stored month never looks further back.
 *
 * Editing a target:
 *  - "this month only" (`'this'`) changes that one month. So that the month after it does not inherit the new value,
 *    the month after it is stored too (when it is not already), holding the plan it had before;
 *  - "from this month on" (`'fromOn'`) changes the month, and every later stored month whose target is still the
 *    inherited value that this month passed on. A later month edited individually is left alone, and so are the
 *    months that inherit from it.
 *
 * The setters are pure: they return the month records that changed (copies), in month order, and leave the input
 * alone. A record that is not stored yet has the id `''` (see `isNewMonth`): the caller adds it as a new record.
 */

type TargetScope = 'this' | 'fromOn';

/** A month that is not stored yet: the setters and `effectiveMonth` return such a record with the id `''`. */
export function isNewMonth(month: BudgetMonth): boolean {
  return month.id === '';
}

function live(months: BudgetMonth[]): BudgetMonth[] {
  return months.filter((m) => !m.deleted);
}

/** The stored month of `ym` (the oldest, should two devices each have stored one). */
function stored(months: BudgetMonth[], ym: Ym): BudgetMonth | undefined {
  return months.filter((m) => m.ym === ym).sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))[0];
}

function newMonth(ym: Ym): BudgetMonth {
  return { id: '', createdAt: '', updatedAt: '', updatedBy: '', deleted: false, scope: 'personal', ym, potTargets: {}, categoryTargets: {} };
}

/**
 * The plan of `ym`: its stored month if it has one; else the plan of the latest earlier stored month (planned income
 * and targets, each target marked inherited, without its notes); else an empty plan. Deleted months are ignored.
 */
export function effectiveMonth(months: BudgetMonth[], ym: Ym): BudgetMonth {
  const all = live(months);
  const own = stored(all, ym);
  if (own) return own;
  const earlier = all.filter((m) => m.ym < ym).sort((a, b) => (a.ym < b.ym ? 1 : a.ym > b.ym ? -1 : 0))[0];
  const month = newMonth(ym);
  if (!earlier) return month;
  const from = stored(all, earlier.ym)!;
  if (from.plannedIncome !== undefined) month.plannedIncome = from.plannedIncome;
  for (const [pot, t] of Object.entries(from.potTargets) as [PotId, PotTarget][]) month.potTargets[pot] = { kind: t.kind, value: t.value, inherited: true };
  for (const [id, t] of Object.entries(from.categoryTargets)) month.categoryTargets[id] = { amount: t.amount, inherited: true };
  return month;
}

/** One target of a month plan, read and written without its `inherited` flag. */
interface Slot<V> {
  read(m: BudgetMonth): { value: V; inherited: boolean } | undefined;
  /** A copy of `m` with the target set (or removed, for `undefined`). */
  write(m: BudgetMonth, value: V | undefined, inherited: boolean): BudgetMonth;
  same(a: V | undefined, b: V | undefined): boolean;
}

function setTarget<V>(months: BudgetMonth[], ym: Ym, value: V | undefined, scope: TargetScope, slot: Slot<V>): BudgetMonth[] {
  const all = live(months);
  const changed = new Map<Ym, BudgetMonth>();
  const keep = (before: BudgetMonth, after: BudgetMonth) => {
    if (isNewMonth(before) || JSON.stringify(slot.read(before)) !== JSON.stringify(slot.read(after))) changed.set(after.ym, after);
  };

  const current = effectiveMonth(all, ym);
  const next = addMonths(ym, 1);
  const nextStored = stored(all, next);
  keep(current, slot.write(current, value, false));

  if (scope === 'this') {
    // The month after keeps the plan it had, rather than inheriting this month's own value.
    if (!nextStored) {
      const after = effectiveMonth(all, next);
      if (!slot.same(slot.read(after)?.value, value)) changed.set(next, after);
    }
  } else {
    // The values this month passed on: its own, and (when it was edited for itself only) the plan that went on after it.
    const passedOn: (V | undefined)[] = [slot.read(current)?.value];
    const nextTarget = nextStored && slot.read(nextStored);
    if (nextTarget && nextTarget.inherited) passedOn.push(nextTarget.value);
    for (const m of all.filter((n) => n.ym > ym).sort((a, b) => (a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : 0))) {
      if (stored(all, m.ym) !== m) continue;
      const t = slot.read(m);
      const inherits = t === undefined ? passedOn.some((v) => v === undefined) : t.inherited && passedOn.some((v) => slot.same(v, t.value));
      if (inherits) keep(m, slot.write(m, value, true));
    }
  }
  return [...changed.values()].sort((a, b) => (a.ym < b.ym ? -1 : 1));
}

const potSlot = (pot: PotId): Slot<{ kind: PotTarget['kind']; value: number }> => ({
  read: (m) => {
    const t = m.potTargets[pot];
    return t && { value: { kind: t.kind, value: t.value }, inherited: t.inherited };
  },
  write: (m, value, inherited) => {
    const potTargets = { ...m.potTargets };
    if (value === undefined) delete potTargets[pot];
    else potTargets[pot] = { kind: value.kind, value: value.value, inherited };
    return { ...m, potTargets };
  },
  same: (a, b) => (a === undefined || b === undefined ? a === b : a.kind === b.kind && a.value === b.value),
});

const categorySlot = (categoryId: string): Slot<Cents> => ({
  read: (m) => {
    const t = m.categoryTargets[categoryId];
    return t && { value: t.amount, inherited: t.inherited };
  },
  write: (m, value, inherited) => {
    const categoryTargets = { ...m.categoryTargets };
    if (value === undefined) delete categoryTargets[categoryId];
    else categoryTargets[categoryId] = { amount: value, inherited };
    return { ...m, categoryTargets };
  },
  same: (a, b) => a === b,
});

/** Sets a pot's target (a % of planned income, or an amount in cents) for one month, or from this month on. */
export function setPotTarget(
  months: BudgetMonth[], ym: Ym, pot: PotId, t: { kind: 'pct' | 'amount'; value: number }, scope: TargetScope,
): BudgetMonth[] {
  return setTarget(months, ym, { kind: t.kind, value: t.value }, scope, potSlot(pot));
}

/** Sets a category's monthly target, or removes it (`undefined`), for one month or from this month on. */
export function setCategoryTarget(months: BudgetMonth[], ym: Ym, categoryId: string, amount: Cents | undefined, scope: TargetScope): BudgetMonth[] {
  return setTarget(months, ym, amount, scope, categorySlot(categoryId));
}

/** A pot target in cents: a percentage is of planned income, rounded to the cent. No target is 0. */
export function potTargetAmount(t: { kind: 'pct' | 'amount'; value: number } | undefined, plannedIncome: Cents): Cents {
  if (!t) return 0;
  return t.kind === 'amount' ? t.value : Math.round((plannedIncome * t.value) / 100);
}

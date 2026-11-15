import type { BaseRecord, BudgetMonth, Cents, PlanEdit, PotId, PotTarget, Ym } from '../domain/types';

/*
 * A month's plan (planned income, pot targets, category targets) and how it carries on from month to month
 * (base §3.1–§3.3).
 *
 * A stored month holds only what was edited in it. For each value (planned income, one pot target, one category
 * target) it may hold a `PlanEdit`:
 *  - `fromOn`: set "from this month on". Every later month uses it, up to the next month with a `fromOn` of its own;
 *  - `thisOnly`: set "for this month only". It overrides the value in this month alone and passes on to no other.
 * Either can be `null`: no value on purpose (a target removed), which applies like any other value.
 *
 * The value of month M is M's `thisOnly` if it has one; else the `fromOn` of the latest month up to M that has one;
 * else none. So a "this month only" edit sets only `thisOnly` (a month's "from this month on" value stays, and goes on
 * passing to later months), and a "from this month on" edit sets `fromOn` and drops the month's `thisOnly`. An edit
 * changes one record only, the edited month: nothing in another month is copied or overwritten.
 *
 * `effectiveMonth` works the plan of a month out (`MonthPlan`); it never makes a record. The setters are pure: they
 * return the one record to add (`create`, without an id: the db layer gives it one) or to change (`update`).
 */

/** The fields of a month record not stored yet: what `createBudgetRecord(db, 'budgetMonths', …)` takes. */
export type NewBudgetMonth = Omit<BudgetMonth, keyof BaseRecord>;

/** A value of the plan, with whether it came from an earlier month. */
export type Planned<V> = V & { inherited: boolean };

/** A month's plan as it applies: its own values (`inherited: false`) and those it uses from an earlier month. */
export interface MonthPlan {
  ym: Ym;
  plannedIncome?: Cents;
  /** Planned income came from an earlier month (absent when there is no planned income). */
  plannedIncomeInherited?: boolean;
  potTargets: Partial<Record<PotId, Planned<PotTarget>>>;
  /** The categories with a target in the month (one removed on purpose is left out). */
  categoryTargets: Record<string, { amount: Cents; inherited: boolean }>;
  notes?: string;
  /** The month's stored record, when it has one. */
  record?: BudgetMonth;
}

/** What an edit changes: at most one record, to add or to change. */
export interface MonthChanges { create: NewBudgetMonth[]; update: BudgetMonth[] }

export type PlanScope = 'this' | 'fromOn';

const byYm = (a: BudgetMonth, b: BudgetMonth) => (a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);

/** The live stored months, one per month (the oldest, should two devices each have stored one), in month order. */
function storedMonths(months: BudgetMonth[]): BudgetMonth[] {
  const seen = new Set<Ym>();
  return months.filter((m) => !m.deleted).sort(byYm).filter((m) => (seen.has(m.ym) ? false : (seen.add(m.ym), true)));
}

/**
 * The value one slot has in month `ym`: the month's `thisOnly`, else the latest `fromOn` up to it. `upTo` is the stored
 * months up to and including `ym`, in month order. `undefined` when there is none (or it was removed on purpose).
 */
function resolve<V>(upTo: BudgetMonth[], ym: Ym, read: (m: BudgetMonth) => PlanEdit<V> | undefined): { value: V; inherited: boolean } | undefined {
  const last = upTo[upTo.length - 1];
  const own = last && last.ym === ym ? read(last) : undefined;
  if (own && own.thisOnly !== undefined) return own.thisOnly === null ? undefined : { value: own.thisOnly, inherited: false };
  for (let i = upTo.length - 1; i >= 0; i -= 1) {
    const edit = read(upTo[i]);
    if (edit && edit.fromOn !== undefined) return edit.fromOn === null ? undefined : { value: edit.fromOn, inherited: upTo[i].ym !== ym };
  }
  return undefined;
}

/** The plan of `ym`, worked out from the stored months (deleted ones are ignored). Notes are the month's own. */
export function effectiveMonth(months: BudgetMonth[], ym: Ym): MonthPlan {
  const upTo = storedMonths(months).filter((m) => m.ym <= ym);
  const record = upTo.find((m) => m.ym === ym);
  const plan: MonthPlan = { ym, potTargets: {}, categoryTargets: {} };

  const income = resolve(upTo, ym, (m) => m.plannedIncome);
  if (income) {
    plan.plannedIncome = income.value;
    plan.plannedIncomeInherited = income.inherited;
  }
  if (record?.notes !== undefined) plan.notes = record.notes;
  if (record) plan.record = record;

  const pots = new Set<PotId>();
  const categories = new Set<string>();
  for (const m of upTo) {
    (Object.keys(m.potTargets) as PotId[]).forEach((p) => pots.add(p));
    Object.keys(m.categoryTargets).forEach((c) => categories.add(c));
  }
  for (const pot of pots) {
    const found = resolve(upTo, ym, (m) => m.potTargets[pot]);
    if (found) plan.potTargets[pot] = { kind: found.value.kind, value: found.value.value, inherited: found.inherited };
  }
  for (const id of categories) {
    const found = resolve(upTo, ym, (m) => m.categoryTargets[id]);
    if (found) plan.categoryTargets[id] = { amount: found.value, inherited: found.inherited };
  }
  return plan;
}

/** A month's edit of one value after a new edit: "from this month on" replaces the month's own override too. */
function withEdit<V>(edit: PlanEdit<V> | undefined, value: V | null, scope: PlanScope): PlanEdit<V> {
  if (scope === 'fromOn') return { fromOn: value };
  const next: PlanEdit<V> = { thisOnly: value };
  if (edit?.fromOn !== undefined) next.fromOn = edit.fromOn;
  return next;
}

/** Writes one edit into the month `ym`: a change to its record, or a new record when it has none. */
function edit(months: BudgetMonth[], ym: Ym, change: (m: NewBudgetMonth) => Partial<NewBudgetMonth>): MonthChanges {
  const record = storedMonths(months).find((m) => m.ym === ym);
  if (!record) {
    const fresh: NewBudgetMonth = { ym, potTargets: {}, categoryTargets: {} };
    return { create: [{ ...fresh, ...change(fresh) }], update: [] };
  }
  const changed = { ...record, ...change(record) };
  const key = (m: BudgetMonth) => JSON.stringify([m.plannedIncome, m.potTargets, m.categoryTargets]);
  return { create: [], update: key(changed) === key(record) ? [] : [changed] };
}

/** Sets a pot's target (a % of planned income, or an amount in cents) for this month only, or from this month on. */
export function setPotTarget(months: BudgetMonth[], ym: Ym, pot: PotId, t: PotTarget, scope: PlanScope): MonthChanges {
  return edit(months, ym, (m) => ({ potTargets: { ...m.potTargets, [pot]: withEdit(m.potTargets[pot], { kind: t.kind, value: t.value }, scope) } }));
}

/** Sets a category's monthly target, or removes it (`undefined`), for this month only or from this month on. */
export function setCategoryTarget(months: BudgetMonth[], ym: Ym, categoryId: string, amount: Cents | undefined, scope: PlanScope): MonthChanges {
  return edit(months, ym, (m) => ({ categoryTargets: { ...m.categoryTargets, [categoryId]: withEdit(m.categoryTargets[categoryId], amount ?? null, scope) } }));
}

/** Sets planned income, or removes it (`undefined`), for this month only or from this month on. */
export function setPlannedIncome(months: BudgetMonth[], ym: Ym, amount: Cents | undefined, scope: PlanScope): MonthChanges {
  return edit(months, ym, (m) => ({ plannedIncome: withEdit(m.plannedIncome, amount ?? null, scope) }));
}

/** A pot target in cents: a percentage is of planned income, rounded to the cent. No target is 0. */
export function potTargetAmount(t: PotTarget | undefined, plannedIncome: Cents): Cents {
  if (!t) return 0;
  return t.kind === 'amount' ? t.value : Math.round((plannedIncome * t.value) / 100);
}

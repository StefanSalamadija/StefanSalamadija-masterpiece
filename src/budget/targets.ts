import type { BaseRecord, BudgetMonth, Cents, CategoryTarget, PotId, PotTarget, TargetOrigin, Ym } from '../domain/types';

/*
 * A month's plan (planned income, pot targets, category targets) and how it carries on from month to month
 * (base §3.2, §3.3).
 *
 * A stored month holds only the targets edited in it, each with how it was edited (`origin`):
 *  - `'this'`: for that month only. It is the month's own target and passes on to no other month;
 *  - `'fromOn'`: from that month on. Every later month without a target of its own uses it, up to the next later
 *    "from this month on" edit. A later month edited for itself keeps its own target, and the months after it still
 *    use the "from this month on" one.
 * A removed category target is kept as `amount: null` (no target), so it too is an edit, and the walk above stops at
 * it like at any other edit.
 *
 * So an edit changes one record only: the month that was edited. Nothing is copied into later months, and nothing in a
 * later month is ever overwritten.
 *
 * `effectiveMonth` works the plan of a month out (`MonthPlan`); it never makes a record. The setters are pure: they
 * return the one record to add (`create`, without an id: the db layer gives it one) or to change (`update`).
 */

/** The fields of a month record not stored yet: what `createBudgetRecord(db, 'budgetMonths', …)` takes. */
export type NewBudgetMonth = Omit<BudgetMonth, keyof BaseRecord>;

/** A month's plan as it applies: its own targets (`inherited: false`) and those it uses from an earlier month. */
export interface MonthPlan {
  ym: Ym;
  plannedIncome?: Cents;
  potTargets: Partial<Record<PotId, { kind: PotTarget['kind']; value: number; inherited: boolean }>>;
  /** The categories with a target in the month (one removed on purpose is left out). */
  categoryTargets: Record<string, { amount: Cents; inherited: boolean }>;
  notes?: string;
  /** The month's stored record, when it has one. */
  record?: BudgetMonth;
}

/** What an edit changes: at most one record, to add or to change. */
export interface MonthChanges { create: NewBudgetMonth[]; update: BudgetMonth[] }

type TargetScope = TargetOrigin;

const byYm = (a: BudgetMonth, b: BudgetMonth) => (a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);

/** The live stored months, one per month (the oldest, should two devices each have stored one), in month order. */
function storedMonths(months: BudgetMonth[]): BudgetMonth[] {
  const seen = new Set<Ym>();
  return months.filter((m) => !m.deleted).sort(byYm).filter((m) => (seen.has(m.ym) ? false : (seen.add(m.ym), true)));
}

/**
 * The target a month uses for one slot: its own edit, else the latest earlier "from this month on" edit.
 * `earlier` is in month order, latest last.
 */
function resolve<T extends { origin: TargetOrigin }>(own: T | undefined, earlier: BudgetMonth[], read: (m: BudgetMonth) => T | undefined):
  { target: T; inherited: boolean } | undefined {
  if (own) return { target: own, inherited: false };
  for (let i = earlier.length - 1; i >= 0; i -= 1) {
    const t = read(earlier[i]);
    if (t && t.origin === 'fromOn') return { target: t, inherited: true };
  }
  return undefined;
}

/**
 * The plan of `ym`. Each target is the month's own, or the latest earlier "from this month on" one (marked inherited);
 * a month's "this month only" edits apply to it alone. Planned income is the month's own, else that of the latest
 * earlier month that has one. Notes are the month's own. Deleted months are ignored.
 */
export function effectiveMonth(months: BudgetMonth[], ym: Ym): MonthPlan {
  const all = storedMonths(months);
  const record = all.find((m) => m.ym === ym);
  const earlier = all.filter((m) => m.ym < ym);
  const plan: MonthPlan = { ym, potTargets: {}, categoryTargets: {} };

  const income = record?.plannedIncome ?? [...earlier].reverse().find((m) => m.plannedIncome !== undefined)?.plannedIncome;
  if (income !== undefined) plan.plannedIncome = income;
  if (record?.notes !== undefined) plan.notes = record.notes;
  if (record) plan.record = record;

  const pots = new Set<PotId>();
  const categories = new Set<string>();
  for (const m of [...earlier, ...(record ? [record] : [])]) {
    (Object.keys(m.potTargets) as PotId[]).forEach((p) => pots.add(p));
    Object.keys(m.categoryTargets).forEach((c) => categories.add(c));
  }
  for (const pot of pots) {
    const found = resolve(record?.potTargets[pot], earlier, (m) => m.potTargets[pot]);
    if (found) plan.potTargets[pot] = { kind: found.target.kind, value: found.target.value, inherited: found.inherited };
  }
  for (const id of categories) {
    const found = resolve(record?.categoryTargets[id], earlier, (m) => m.categoryTargets[id]);
    if (found && found.target.amount !== null) plan.categoryTargets[id] = { amount: found.target.amount, inherited: found.inherited };
  }
  return plan;
}

/** Writes one target into the month `ym`: a change to its record, or a new record when it has none. */
function edit(months: BudgetMonth[], ym: Ym, change: (m: NewBudgetMonth) => NewBudgetMonth): MonthChanges {
  const record = storedMonths(months).find((m) => m.ym === ym);
  if (!record) return { create: [change({ ym, potTargets: {}, categoryTargets: {} })], update: [] };
  const changed = { ...record, ...change(record) };
  const same = JSON.stringify([changed.potTargets, changed.categoryTargets]) === JSON.stringify([record.potTargets, record.categoryTargets]);
  return { create: [], update: same ? [] : [changed] };
}

/** Sets a pot's target (a % of planned income, or an amount in cents) for one month only, or from this month on. */
export function setPotTarget(
  months: BudgetMonth[], ym: Ym, pot: PotId, t: { kind: 'pct' | 'amount'; value: number }, scope: TargetScope,
): MonthChanges {
  return edit(months, ym, (m) => ({ ...m, potTargets: { ...m.potTargets, [pot]: { kind: t.kind, value: t.value, origin: scope } } }));
}

/**
 * Sets a category's monthly target for one month only, or from this month on. `undefined` removes it: the month (and,
 * from this month on, the months that inherit) then has no target, which is kept as `amount: null`.
 */
export function setCategoryTarget(months: BudgetMonth[], ym: Ym, categoryId: string, amount: Cents | undefined, scope: TargetScope): MonthChanges {
  const target: CategoryTarget = { amount: amount ?? null, origin: scope };
  return edit(months, ym, (m) => ({ ...m, categoryTargets: { ...m.categoryTargets, [categoryId]: target } }));
}

/** A pot target in cents: a percentage is of planned income, rounded to the cent. No target is 0. */
export function potTargetAmount(t: { kind: 'pct' | 'amount'; value: number } | undefined, plannedIncome: Cents): Cents {
  if (!t) return 0;
  return t.kind === 'amount' ? t.value : Math.round((plannedIncome * t.value) / 100);
}

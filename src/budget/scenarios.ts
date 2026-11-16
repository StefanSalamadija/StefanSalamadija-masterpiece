import type {
  Assumptions, BaseRecord, BudgetCategory, BudgetDebt, BudgetEntry, BudgetMonth, BudgetRecurring, BudgetScenario, BudgetSettings, Cents,
  ForecastMethod, PotId, RotationSettings, Ym,
} from '../domain/types';
import { POTS } from './catalog';
import { forecast } from './forecast';
import type { BudgetData, ForecastInput } from './forecast';
import { freedom } from './freedom';
import { SAVINGS_GOALS_CATEGORY_ID } from './ledger';
import { addExtra, removeExtra, tidySteps } from './debts';
import type { ExtraStep } from './debts';
import { formatMoney } from './money';
import { addMonths, monthsBetween, ymOf } from './months';
import type { ScenarioChange } from './scenarioTypes';
import { effectiveMonth, setCategoryTarget, setPotTarget, storedMonths } from './targets';
import type { MonthChanges, NewBudgetMonth } from './targets';

export type { ScenarioChange };

/*
 * Scenarios ("what if", v2 §3.5, §3.9.9). A scenario is a named set of changes on top of the base plan. It changes
 * the forecast only, never the stored plan, until "Apply to plan".
 *
 * One model. A scenario is forecast as the plan that applying it would make: `applyToPlan`'s writes are carried out
 * on a copy of the data and settings (`planWith`), and that copy is forecast. So what Compare shows is, by
 * construction, what the plan forecasts after "Apply to plan".
 *
 * Compare: the base plan first, then each scenario, each forecast 10 years (120 months) ahead:
 *  - debt-free: the month the last debt is paid off (none while any debt is not paid off within the 10 years, or with
 *    no debts);
 *  - lowest: the month with the lowest bank balance (the first, on a tie), and that balance;
 *  - net worth after 1, 5 and 10 years: at the end of the 12th, 60th and 120th forecast month (the current one first);
 *  - freedom: the freedom date at the plan's own rates, from the yearly spending the caller gives (§3.4: the average
 *    Needs + Wants of the last 12 tracked months, or the user's fixed amount), the same for every row; none when it is
 *    not within 60 years or an assumption is missing;
 *  - total interest over the 10 years; and the month-by-month bank and net worth, for the chart.
 *
 * Apply to plan returns the writes, for the UI to carry out after it takes a snapshot, and summary lines for the
 * confirmation (each change's line first, then the plan edits it needs). Each change goes to its real place:
 *  - rotation → the rotation settings (periods, pattern); salary → the salary from its month on; rates → the
 *    assumptions. All settings edits make one settings change;
 *  - pot target → from its month on, the pot is planned at exactly that amount:
 *      - its pot target "from this month on" in that month (`setPotTarget`);
 *      - its category targets removed "from this month on" in that month (they would plan more than the pot);
 *      - later months' own edits of that pot's target and its categories' targets removed;
 *      - its forecast method set to `targets` (a method holds for every month);
 *  - investment → from its month on, Savings & investments contributes exactly that a month:
 *      - the templates: each investment template (an expense template in Savings & investments, savings goals aside)
 *        still running at the month ends the month before (one that would start later is deleted), and one template
 *        of the new amount runs from the month on, named and booked like the first of them (else "Investment
 *        contribution", in the first Savings & investments category);
 *      - the Savings & investments pot target set to that amount, as for a pot target change;
 *  - one-off → a planned entry to confirm on the 1st of its month, marked one-off: an expense in the pot's "Other …"
 *    category (else its first one; none without a pot), or other income, with the id
 *    `scenario:<scenarioId>:<changeIndex>:<ym>` (as for a lump sum below);
 *  - extra debt → the monthly extra is added to the debt's extra steps from the current month or the debt's start on
 *    (its own steps keep their months: `addExtra`), which the forecast pays on top of
 *    the instalment until the debt is paid off; the lump sum is a planned payment on that debt, to confirm in its
 *    month, in a Debts category ("Extra …" if there is one), with the id `scenario:<scenarioId>:<changeIndex>:<ym>` so
 *    that applying twice, or on two devices, makes one entry. Neither is ever covered by a target or a fixed amount.
 */

export interface CompareRow {
  name: string; debtFree?: Ym; lowest?: { ym: Ym; amount: Cents }; netWorth1y: Cents; netWorth5y: Cents; netWorth10y: Cents; freedom?: Ym; totalInterest: Cents;
  /** Each month's bank balance and net worth, for the chart. */
  series: { ym: Ym; bank: Cents; netWorth: Cents }[];
}

/** The base plan to compare against, and the yearly spending the freedom date is worked out from (§3.4). */
export interface CompareInput extends ForecastInput { yearlySpending: Cents }

const COMPARE_MONTHS = 120;
/** How far ahead the summary looks for the month a debt with an extra is paid off. */
const EXTRA_MAX_MONTHS = 360;
type Fields<T> = Omit<T, keyof BaseRecord>;
type SettingsPatch = { rotation?: RotationSettings; assumptions?: Assumptions; forecastMethod?: Record<PotId, ForecastMethod> };

/** One write "Apply to plan" asks for. The db layer gives each new record its id. */
export type PlanWrite =
  | { op: 'update'; table: 'budgetSettings'; id: string; patch: SettingsPatch }
  | { op: 'create'; table: 'budgetMonths'; fields: NewBudgetMonth }
  | { op: 'update'; table: 'budgetMonths'; id: string; patch: Pick<BudgetMonth, 'potTargets' | 'categoryTargets'> }
  | { op: 'create'; table: 'budgetRecurring'; fields: Fields<BudgetRecurring> }
  | { op: 'update'; table: 'budgetRecurring'; id: string; patch: Partial<Fields<BudgetRecurring>> }
  | { op: 'delete'; table: 'budgetRecurring'; id: string }
  | { op: 'update'; table: 'budgetDebts'; id: string; patch: Required<Pick<Fields<BudgetDebt>, 'extraSteps'>> & Pick<Fields<BudgetDebt>, 'extraApplied'> }
  /** `id`, when given, is the entry's own: the same on every device (see `applyToPlan`). */
  | { op: 'create'; table: 'budgetEntries'; fields: Fields<BudgetEntry>; id?: string };

/**
 * The data and settings after `writes`, worked out in memory (nothing is stored): what the db would hold once the UI
 * carries them out. New records get ids of their own (`plan:1`, …).
 */
export function planWith(data: BudgetData, settings: BudgetSettings, writes: PlanWrite[], today: string): { data: BudgetData; settings: BudgetSettings } {
  const out: BudgetData = {
    ...data, budgetMonths: [...data.budgetMonths], budgetRecurring: [...data.budgetRecurring], budgetEntries: [...data.budgetEntries],
    budgetDebts: [...data.budgetDebts],
  };
  let next = settings;
  let n = 0;
  const stamp = `${today}T00:00:00.000Z`;
  const record = (): BaseRecord => {
    n += 1;
    return { id: `plan:${n}`, createdAt: stamp, updatedAt: stamp, updatedBy: 'plan', deleted: false, scope: settings.scope };
  };
  const change = <T extends { id: string }>(list: T[], id: string, edit: (r: T) => T) => {
    const at = list.findIndex((r) => r.id === id);
    if (at >= 0) list[at] = edit(list[at]);
  };
  for (const w of writes) {
    if (w.table === 'budgetSettings') next = { ...next, ...w.patch };
    else if (w.table === 'budgetMonths') {
      if (w.op === 'create') out.budgetMonths.push({ ...w.fields, ...record() } as BudgetMonth);
      else {
        // As `writeMonth` does: the month's records folded into one, with the patch, the others moved into it.
        const ym = out.budgetMonths.find((r) => r.id === w.id)?.ym;
        const folded = storedMonths(out.budgetMonths).find((r) => r.ym === ym);
        if (folded) {
          out.budgetMonths = out.budgetMonths.filter((r) => r.ym !== ym || r.deleted);
          out.budgetMonths.push({ ...folded, ...w.patch, id: w.id });
        }
      }
    } else if (w.table === 'budgetRecurring') {
      if (w.op === 'create') out.budgetRecurring.push({ ...w.fields, ...record() } as BudgetRecurring);
      else if (w.op === 'update') change(out.budgetRecurring, w.id, (r) => ({ ...r, ...w.patch }));
      else change(out.budgetRecurring, w.id, (r) => ({ ...r, deleted: true }));
    } else if (w.table === 'budgetDebts') {
      change(out.budgetDebts, w.id, (r) => ({ ...r, ...w.patch }));
    } else {
      // As `applyPlanWrites` does: an entry already live under its id is left as it is.
      if (w.id !== undefined && out.budgetEntries.some((e) => e.id === w.id && !e.deleted)) continue;
      out.budgetEntries.push({ ...w.fields, ...record(), ...(w.id !== undefined && { id: w.id }) } as BudgetEntry);
    }
  }
  return { data: out, settings: next };
}

/** The data and settings a scenario's "Apply to plan" would make, in memory. */
export function scenarioPlan(data: BudgetData, settings: BudgetSettings, s: BudgetScenario, today: string): { data: BudgetData; settings: BudgetSettings } {
  return planWith(data, settings, applyToPlan(data, settings, s, today).writes, today);
}

export function compareScenarios(base: CompareInput, scenarios: BudgetScenario[]): CompareRow[] {
  const months = Math.max(COMPARE_MONTHS, base.months ?? 0);
  const row = (name: string, input: ForecastInput): CompareRow => {
    const r = forecast({ today: input.today, data: input.data, settings: input.settings, months });
    const at = (k: number) => r.months[Math.min(k, r.months.length) - 1]?.netWorth ?? 0;
    const free = Object.values(r.debtFree);
    let lowest: CompareRow['lowest'];
    for (const m of r.months) if (lowest === undefined || m.bank < lowest.amount) lowest = { ym: m.ym, amount: m.bank };
    const f = freedom({ forecast: r, yearlySpending: base.yearlySpending, assumptions: r.assumptions, today: base.today });
    return {
      name,
      ...(free.length > 0 && free.every((ym) => ym !== undefined) && { debtFree: free.reduce((a, b) => (b! > a! ? b : a)) }),
      ...(lowest !== undefined && { lowest }),
      netWorth1y: at(12), netWorth5y: at(60), netWorth10y: at(120),
      ...(f.status === 'ok' && f.ym !== undefined && { freedom: f.ym }),
      totalInterest: r.totalInterest,
      series: r.months.map((m) => ({ ym: m.ym, bank: m.bank, netWorth: m.netWorth })),
    };
  };
  return [
    row('Base plan', base),
    ...scenarios.map((s) => row(s.name, { ...base, ...scenarioPlan(base.data, base.settings, s, base.today) })),
  ];
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** `2027-05` → `May 2027`. */
const monthName = (ym: Ym) => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const potLabel = (pot: PotId) => POTS.find((p) => p.id === pot)!.label;
const pct = (n: number) => `${n}%`;
const METHOD_NAMES: Record<ForecastMethod, string> = { targets: 'its targets', average: 'the average of past months', fixed: 'a fixed amount' };

/** Lowercase, diacritics removed: enough to find an "Other …" or "Extra …" category by its name. */
const folded = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '');

/**
 * The live, shown categories of a pot in their order (savings goals aside; hidden ones when none is shown), the one
 * whose name starts with `prefer` first.
 */
function categoryIn(categories: BudgetCategory[], pot: PotId, prefer: string): string | undefined {
  const live = categories.filter((c) => !c.deleted && c.pot === pot && c.id !== SAVINGS_GOALS_CATEGORY_ID)
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const shown = live.filter((c) => !c.hidden);
  const inPot = shown.length > 0 ? shown : live;
  return (inPot.find((c) => folded(c.name).startsWith(prefer)) ?? inPot[0])?.id;
}

const sameMonthPlan = (a: BudgetMonth, b: BudgetMonth) => JSON.stringify([a.potTargets, a.categoryTargets]) === JSON.stringify([b.potTargets, b.categoryTargets]);

/** A planned payment on a debt, to confirm on the 1st of its month. */
function extraPayment(categories: BudgetCategory[], d: BudgetDebt, ym: Ym, amount: Cents): Fields<BudgetEntry> {
  const categoryId = categoryIn(categories, 'debts', 'extra');
  return { kind: 'expense', date: `${ym}-01`, amount, ...(categoryId !== undefined && { categoryId }), debtId: d.id, note: `Extra payment: ${d.name}`, status: 'planned', oneOff: true };
}

/** A scenario's monthly extra on a debt, its summary line, and the change it comes from (`scenario:<id>:<index>`). */
type Extra = { debt: BudgetDebt; monthly: Cents; line: number; source: string };

export function applyToPlan(data: BudgetData, settings: BudgetSettings, s: BudgetScenario, today: string): { writes: PlanWrite[]; summary: string[] } {
  const cur = ymOf(today);
  const summary: string[] = [];
  const potOf = new Map(data.budgetCategories.map((c) => [c.id, c.pot]));
  const debts = data.budgetDebts.filter((d) => !d.deleted);

  // The settings edits so far, made into one change at the end.
  const patch: SettingsPatch = {};
  // The month plans with the edits so far; `fresh` holds the ids of the months this apply creates.
  // One record per month (duplicates folded, as the db writes them), so the writes start from what every view reads.
  const initialMonths = storedMonths(data.budgetMonths);
  let months = initialMonths;
  const fresh = new Set<string>();
  let recurring = data.budgetRecurring.filter((t) => !t.deleted);
  const templateWrites: PlanWrite[] = [];
  const entryWrites: PlanWrite[] = [];
  const extras: Extra[] = [];

  const monthEdit = ({ create, update }: MonthChanges) => {
    for (const c of create) {
      const id = `new-month:${c.ym}`;
      fresh.add(id);
      months = [...months, { ...c, id, createdAt: '', updatedAt: '', updatedBy: '', deleted: false, scope: settings.scope } as BudgetMonth];
    }
    for (const u of update) months = months.map((m) => (m.id === u.id ? u : m));
  };

  /** The writes for the edits so far (the monthly extra debt payments aside: they come last). */
  const assemble = (): PlanWrite[] => {
    const monthWrites: PlanWrite[] = [];
    for (const m of months) {
      if (fresh.has(m.id)) {
        const { id: _id, createdAt: _c, updatedAt: _u, updatedBy: _b, deleted: _d, scope: _s, ...fields } = m;
        monthWrites.push({ op: 'create', table: 'budgetMonths', fields });
      } else {
        const was = initialMonths.find((x) => x.id === m.id)!;
        if (!sameMonthPlan(was, m)) monthWrites.push({ op: 'update', table: 'budgetMonths', id: m.id, patch: { potTargets: m.potTargets, categoryTargets: m.categoryTargets } });
      }
    }
    const settingsWrite: PlanWrite[] = Object.keys(patch).length > 0 ? [{ op: 'update', table: 'budgetSettings', id: settings.id, patch: { ...patch } }] : [];
    return [...settingsWrite, ...monthWrites, ...templateWrites, ...entryWrites];
  };
  /** Each month's spending in `pot` in the plan with the edits so far, for the `span` months from the current one. */
  const potSpending = (pot: PotId, span: number): Cents[] =>
    forecast({ today, ...planWith(data, settings, assemble(), today), months: span }).months.map((m) => m.pots[pot]);

  /**
   * From `fromYm` on, the pot is planned at exactly `amount`. A pot planned by the average or a fixed amount moves to
   * its targets, which hold for every month: the months from the current one to `fromYm` are then given pot targets
   * that plan what the old method planned there, so the scenario changes nothing before its month.
   */
  const potExactly = (pot: PotId, fromYm: Ym, amount: Cents) => {
    const label = potLabel(pot);
    const method = (patch.forecastMethod ?? settings.forecastMethod)[pot] ?? 'targets';
    const span = method !== 'targets' ? Math.max(0, monthsBetween(cur, fromYm)) : 0;
    const startYm = span > 0 ? cur : fromYm;
    const wanted = span > 0 ? potSpending(pot, span) : [];

    // No category targets and no later edits of the pot from `startYm` on: the pot targets alone plan the pot.
    const inPot = new Set(data.budgetCategories.filter((c) => c.pot === pot).map((c) => c.id));
    const targeted = Object.keys(effectiveMonth(months, startYm).categoryTargets).filter((id) => inPot.has(id));
    for (const id of targeted) monthEdit(setCategoryTarget(months, startYm, id, undefined, 'fromOn'));
    const later = new Set<Ym>();
    months = months.map((m) => {
      if (m.ym <= startYm) return m;
      const potTargets = { ...m.potTargets };
      const categoryTargets = { ...m.categoryTargets };
      let changed = false;
      if (potTargets[pot] !== undefined) { delete potTargets[pot]; changed = true; }
      for (const id of Object.keys(categoryTargets)) if (inPot.has(id)) { delete categoryTargets[id]; changed = true; }
      if (!changed) return m;
      later.add(m.ym);
      return { ...m, potTargets, categoryTargets };
    });
    monthEdit(setPotTarget(months, fromYm, pot, { kind: 'amount', value: amount }, 'fromOn'));

    summary.push(`${label} target: ${formatMoney(amount)} a month from ${monthName(fromYm)} on`);
    if (targeted.length > 0) {
      const names = targeted.map((id) => data.budgetCategories.find((c) => c.id === id)!.name);
      summary.push(`${label}: category targets removed from ${monthName(startYm)} on (${names.join(', ')})`);
    }
    if (later.size > 0) summary.push(`${label}: later target changes removed (${[...later].sort().map(monthName).join(', ')})`);
    if (method === 'targets') return;
    patch.forecastMethod = { ...(patch.forecastMethod ?? settings.forecastMethod), [pot]: 'targets' };
    summary.push(`${label}: planned by its targets in every month (was ${METHOD_NAMES[method]})`);
    if (wanted.length === 0) return;

    // The months before `fromYm`: a pot target per month that plans what the old method did. A target is what the
    // pot spends beyond its templates' and funds' cover (never below it), so the amount is found by correcting a
    // first guess with what the forecast then plans, until the two agree (normally on the first correction).
    let pins = [...wanted];
    const pin = () => pins.forEach((v, i) => monthEdit(setPotTarget(months, addMonths(cur, i), pot, { kind: 'amount', value: v }, 'fromOn')));
    for (let round = 0; round < 8; round += 1) {
      pin();
      const off = potSpending(pot, span).map((got, i) => got - wanted[i]);
      if (off.every((d) => d === 0)) break;
      pins = pins.map((v, i) => Math.max(0, v - off[i]));
    }
    // Keep only the months where the pin changes: "from this month on" carries it to the next.
    for (let i = 1; i < span; i += 1) {
      if (pins[i] !== pins[i - 1]) continue;
      const ym = addMonths(cur, i);
      months = months.flatMap((m) => {
        if (m.ym !== ym || m.potTargets[pot] === undefined) return [m];
        const potTargets = { ...m.potTargets };
        delete potTargets[pot];
        const empty = Object.keys(potTargets).length === 0 && Object.keys(m.categoryTargets).length === 0 && m.plannedIncome === undefined && m.notes === undefined;
        if (fresh.has(m.id) && empty) { fresh.delete(m.id); return []; }
        return [{ ...m, potTargets }];
      });
    }
    const until = monthName(addMonths(fromYm, -1));
    const low = Math.min(...pins);
    const high = Math.max(...pins);
    summary.push(low === high
      ? `${label}: ${formatMoney(low)} a month until ${until}, what ${METHOD_NAMES[method]} planned`
      : `${label}: what ${METHOD_NAMES[method]} planned until ${until}, month by month (${formatMoney(low)} to ${formatMoney(high)})`);
  };

  for (const [index, c] of s.changes.entries()) {
    if (c.kind === 'rotation') {
      const rotation: RotationSettings = { ...(patch.rotation ?? settings.rotation), ...(c.periods !== undefined && { periods: c.periods.map((p) => ({ ...p })) }),
        ...(c.patternOn !== undefined && { patternOn: c.patternOn }), ...(c.patternOff !== undefined && { patternOff: c.patternOff }) };
      patch.rotation = rotation;
      const parts: string[] = [];
      if (c.periods !== undefined) parts.push(`${c.periods.length} contract period${c.periods.length === 1 ? '' : 's'}`);
      if (c.patternOn !== undefined || c.patternOff !== undefined) {
        parts.push(`${parts.length > 0 ? 'then ' : ''}${rotation.patternOn} months on and ${rotation.patternOff} off`);
      }
      summary.push(`Rotation: ${parts.join(', ') || 'unchanged'}`);
    } else if (c.kind === 'salary') {
      const rotation = patch.rotation ?? settings.rotation;
      const from = rotation.salaryFrom.filter((x) => x.ym !== c.fromYm);
      patch.rotation = { ...rotation, salaryFrom: [...from, { ym: c.fromYm, amount: c.amount }].sort((a, b) => (a.ym < b.ym ? -1 : 1)) };
      summary.push(`Salary: ${formatMoney(c.amount)} a month from ${monthName(c.fromYm)} on`);
    } else if (c.kind === 'rates') {
      patch.assumptions = { ...(patch.assumptions ?? settings.assumptions), ...(c.yearlyReturnPct !== undefined && { yearlyReturnPct: c.yearlyReturnPct }),
        ...(c.withdrawalRatePct !== undefined && { withdrawalRatePct: c.withdrawalRatePct }), ...(c.inflationPct !== undefined && { inflationPct: c.inflationPct }) };
      const parts = [
        ...(c.yearlyReturnPct !== undefined ? [`expected return ${pct(c.yearlyReturnPct)}`] : []),
        ...(c.withdrawalRatePct !== undefined ? [`withdrawal rate ${pct(c.withdrawalRatePct)}`] : []),
        ...(c.inflationPct !== undefined ? [`inflation ${pct(c.inflationPct)}`] : []),
      ];
      summary.push(`Assumptions: ${parts.join(', ') || 'unchanged'}`);
    } else if (c.kind === 'potTarget') {
      potExactly(c.pot, c.fromYm, c.amount);
    } else if (c.kind === 'investment') {
      const affected = recurring
        .filter((t) => t.incomeSource === undefined && t.categoryId !== SAVINGS_GOALS_CATEGORY_ID && potOf.get(t.categoryId ?? '') === 'savings'
          && (t.endYm === undefined || t.endYm >= c.fromYm))
        .sort((a, b) => (a.startYm < b.startYm ? -1 : a.startYm > b.startYm ? 1 : 0));
      for (const t of affected) {
        if (t.startYm < c.fromYm) templateWrites.push({ op: 'update', table: 'budgetRecurring', id: t.id, patch: { endYm: addMonths(c.fromYm, -1) } });
        else templateWrites.push({ op: 'delete', table: 'budgetRecurring', id: t.id });
      }
      const gone = new Set(affected.map((t) => t.id));
      recurring = recurring.filter((t) => !gone.has(t.id));
      const first = affected[0];
      const categoryId = first?.categoryId ?? categoryIn(data.budgetCategories, 'savings', '');
      if (c.monthly > 0) {
        const fields: Fields<BudgetRecurring> = {
          name: first?.name ?? 'Investment contribution', amount: c.monthly, ...(categoryId !== undefined && { categoryId }), day: first?.day ?? 1, startYm: c.fromYm,
        };
        templateWrites.push({ op: 'create', table: 'budgetRecurring', fields });
        recurring = [...recurring, { ...fields, id: `new-template:${templateWrites.length}`, createdAt: '', updatedAt: '', updatedBy: '', deleted: false, scope: settings.scope }];
      }
      const replacing = affected.length > 0 ? ` (replacing ${affected.map((t) => t.name).join(', ')})` : '';
      summary.push(`Investments: ${formatMoney(c.monthly)} a month from ${monthName(c.fromYm)} on${replacing}`);
      potExactly('savings', c.fromYm, c.monthly);
    } else if (c.kind === 'oneOff') {
      const date = `${c.ym}-01`;
      const id = `scenario:${s.id}:${index}:${c.ym}`;
      if (c.income === true) {
        entryWrites.push({ op: 'create', table: 'budgetEntries', id, fields: { kind: 'income', date, amount: c.amount, incomeSource: 'other', note: c.label, status: 'planned', oneOff: true } });
        summary.push(`Planned income in ${monthName(c.ym)}: ${c.label}, ${formatMoney(c.amount)}`);
      } else {
        const categoryId = c.pot !== undefined ? categoryIn(data.budgetCategories, c.pot, 'other') : undefined;
        entryWrites.push({ op: 'create', table: 'budgetEntries', id, fields: {
          kind: 'expense', date, amount: c.amount, ...(categoryId !== undefined && { categoryId }), note: c.label, status: 'planned', oneOff: true,
        } });
        summary.push(`Planned purchase in ${monthName(c.ym)}: ${c.label}, ${formatMoney(c.amount)}`);
      }
    } else if (c.kind === 'extraDebt') {
      const d = debts.find((x) => x.id === c.debtId);
      if (d === undefined) {
        summary.push('Extra debt payment: the debt no longer exists, left out');
        continue;
      }
      if (c.monthly !== undefined && c.monthly > 0) {
        extras.push({ debt: d, monthly: c.monthly, line: summary.length, source: `scenario:${s.id}:${index}` });
        summary.push('');
      }
      if (c.lumpYm !== undefined && c.lump !== undefined && c.lump > 0) {
        entryWrites.push({ op: 'create', table: 'budgetEntries', id: `scenario:${s.id}:${index}:${c.lumpYm}`, fields: extraPayment(data.budgetCategories, d, c.lumpYm, c.lump) });
        summary.push(`${d.name}: extra payment of ${formatMoney(c.lump)} in ${monthName(c.lumpYm)}`);
      }
    }
  }

  const assembled = assemble();
  // A planned entry already live under its id (the scenario was applied before) is the plan already: never added twice.
  const live = new Set(data.budgetEntries.filter((e) => !e.deleted).map((e) => e.id));
  const writes = assembled.filter((w) => !(w.table === 'budgetEntries' && w.op === 'create' && w.id !== undefined && live.has(w.id)));
  const prefix = `scenario:${s.id}:`;
  const appliedBefore = debts.some((d) => d.extraApplied?.some((a) => a.source.startsWith(prefix)));
  if (extras.length > 0 || appliedBefore) writes.push(...extraWrites(data, settings, writes, today, extras, summary, prefix));
  return { writes, summary };
}

/**
 * The monthly extras, stored on their debts: each debt's extra steps raised by the scenario's from the current month
 * (or the debt's start) on (`addExtra`), so the debt's own steps keep their months. An extra to a debt already paid off before it would start
 * is left out. Each change's summary line names the month the debt is then paid off.
 */
function extraWrites(data: BudgetData, settings: BudgetSettings, writes: PlanWrite[], today: string,
  extras: Extra[], summary: string[], prefix: string): PlanWrite[] {
  const cur = ymOf(today);
  const startOf = (d: BudgetDebt) => (d.startYm > cur ? d.startYm : cur);
  const before = forecast({ today, ...planWith(data, settings, writes, today), months: 1 }).debtFree;
  const kept = extras.filter((x) => {
    const free = before[x.debt.id];
    if (free !== undefined && free < startOf(x.debt)) {
      summary[x.line] = `${x.debt.name}: extra ${formatMoney(x.monthly)} a month left out, the debt is paid off before it starts`;
      return false;
    }
    return true;
  });
  const leftOut = extras.filter((x) => !kept.includes(x));
  const out: PlanWrite[] = [];
  const stepsAfter = new Map<string, ExtraStep[]>();
  const debts = data.budgetDebts.filter((d) => !d.deleted && (kept.some((x) => x.debt.id === d.id) || d.extraApplied?.some((a) => a.source.startsWith(prefix))));
  for (const d of debts) {
    let steps: ExtraStep[] = [...(d.extraSteps ?? [])];
    const held = d.extraApplied ?? [];
    // This scenario's part from an earlier Apply is taken back first (from now on: past months keep what they had), then
    // its changes are added again, so applying twice gives what applying once does.
    const back = held.filter((a) => a.source.startsWith(prefix) && !leftOut.some((x) => x.source === a.source && x.debt.id === d.id));
    for (const a of back) steps = removeExtra(steps, a.fromYm > startOf(d) ? a.fromYm : startOf(d), a.monthly);
    const applied = held.filter((a) => !back.includes(a));
    for (const x of kept) {
      if (x.debt.id !== d.id) continue;
      steps = addExtra(steps, startOf(d), x.monthly);
      const was = back.find((a) => a.source === x.source);
      applied.push({ source: x.source, fromYm: was !== undefined && was.monthly === x.monthly ? was.fromYm : startOf(d), monthly: x.monthly });
    }
    if (back.length > 0) steps = tidySteps(steps);
    stepsAfter.set(d.id, steps);
    const same = JSON.stringify(tidySteps(steps)) === JSON.stringify(tidySteps(d.extraSteps ?? []))
      && JSON.stringify(applied) === JSON.stringify(held);
    if (same) continue;
    out.push({ op: 'update', table: 'budgetDebts', id: d.id, patch: { extraSteps: steps, extraApplied: applied } });
  }
  if (kept.length === 0) return out;
  const paidOff = (span: number) => forecast({ today, ...planWith(data, settings, [...writes, ...out], today), months: span }).debtFree;
  let free = paidOff(COMPARE_MONTHS);
  if (kept.some((x) => free[x.debt.id] === undefined)) free = paidOff(EXTRA_MAX_MONTHS);
  for (const x of kept) {
    const until = free[x.debt.id];
    const start = startOf(x.debt);
    // The debt's whole extra from then on, when it is not just this change's: its own extra stays in its months.
    const from = stepsAfter.get(x.debt.id)!.filter((st) => st.fromYm >= start);
    const plain = from.length === 1 && from[0].fromYm === start && from[0].monthly === x.monthly;
    const inAll = plain ? '' : ` (in all ${from.map((st) => `${formatMoney(st.monthly)} from ${monthName(st.fromYm)}`).join(', ')})`;
    summary[x.line] = `${x.debt.name}: extra ${formatMoney(x.monthly)} a month from ${monthName(start)}${inAll} `
      + (until === undefined ? 'on (not paid off within 30 years)' : `until it is paid off in ${monthName(until)}`);
  }
  return out;
}

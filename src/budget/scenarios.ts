import type {
  Assumptions, BaseRecord, BudgetCategory, BudgetEntry, BudgetMonth, BudgetRecurring, BudgetScenario, BudgetSettings, Cents, PotId,
  RotationSettings, Ym,
} from '../domain/types';
import { POTS } from './catalog';
import { forecast } from './forecast';
import type { BudgetData, ForecastInput } from './forecast';
import { freedom } from './freedom';
import { SAVINGS_GOALS_CATEGORY_ID } from './ledger';
import { formatMoney } from './money';
import { addMonths, ymOf } from './months';
import type { ScenarioChange } from './scenarioTypes';
import { setPotTarget } from './targets';
import type { NewBudgetMonth } from './targets';

export type { ScenarioChange };

/*
 * Scenarios ("what if", v2 §3.5, §3.9.9). A scenario is a named set of changes on top of the base plan; it changes the
 * forecast only (`forecast`'s `overrides`), never the plan, until "Apply to plan".
 *
 * Compare: the base plan first, then each scenario, each forecast 10 years (120 months) ahead:
 *  - debt-free: the month the last debt is paid off (none while any debt is not paid off within the 10 years, or with
 *    no debts);
 *  - lowest: the month with the lowest bank balance (the first, on a tie), and that balance;
 *  - net worth after 1, 5 and 10 years: at the end of the 12th, 60th and 120th forecast month (the current one first);
 *  - freedom: the freedom date at the plan's own rates, when the yearly spending is given (else none);
 *  - total interest over the 10 years; and the month-by-month bank and net worth, for the chart.
 *
 * Apply to plan returns the writes, for the UI to carry out after it takes a snapshot, and one summary line per change
 * for the confirmation. Each change goes to its real place:
 *  - rotation → the rotation settings (periods, pattern); salary → the salary from its month on; rates → the
 *    assumptions. All of them make one settings change;
 *  - pot target → that pot's target "from this month on" in its month (`setPotTarget`), one month record per month;
 *  - investment → the templates: each investment template (an expense template in Savings & investments, savings goals
 *    aside) still running at the month ends the month before (one that would start later is deleted), and one template
 *    of the new amount runs from the month on, named and booked like the first of them (else "Investment
 *    contribution", in the first Savings & investments category);
 *  - one-off → a planned entry to confirm on the 1st of its month, marked one-off: an expense in the pot's "Other …"
 *    category (else its first one; none without a pot), or other income;
 *  - extra debt → the monthly extra is a template from the current month in a Debts category ("Extra …" if there is
 *    one), paying that debt until it is paid off; the lump sum a planned payment on that debt in its month. A template
 *    that pays a debt stops its automatic instalment, so when no template pays the debt yet, the new template is the
 *    instalment and the extra together.
 */

export interface CompareRow {
  name: string; debtFree?: Ym; lowest?: { ym: Ym; amount: Cents }; netWorth1y: Cents; netWorth5y: Cents; netWorth10y: Cents; freedom?: Ym; totalInterest: Cents;
  /** Each month's bank balance and net worth, for the chart. */
  series: { ym: Ym; bank: Cents; netWorth: Cents }[];
}

const COMPARE_MONTHS = 120;
type Fields<T> = Omit<T, keyof BaseRecord>;

/** One write "Apply to plan" asks for. The db layer gives each new record its id. */
export type PlanWrite =
  | { op: 'update'; table: 'budgetSettings'; id: string; patch: { rotation?: RotationSettings; assumptions?: Assumptions } }
  | { op: 'create'; table: 'budgetMonths'; fields: NewBudgetMonth }
  | { op: 'update'; table: 'budgetMonths'; id: string; patch: Pick<BudgetMonth, 'potTargets'> }
  | { op: 'create'; table: 'budgetRecurring'; fields: Fields<BudgetRecurring> }
  | { op: 'update'; table: 'budgetRecurring'; id: string; patch: Partial<Fields<BudgetRecurring>> }
  | { op: 'delete'; table: 'budgetRecurring'; id: string }
  | { op: 'create'; table: 'budgetEntries'; fields: Fields<BudgetEntry> };

export function compareScenarios(base: ForecastInput, scenarios: BudgetScenario[], opts: { yearlySpending?: Cents } = {}): CompareRow[] {
  const months = Math.max(COMPARE_MONTHS, base.months ?? 0);
  const row = (name: string, changes: ScenarioChange[]): CompareRow => {
    const r = forecast({ ...base, overrides: [...(base.overrides ?? []), ...changes], months });
    const at = (n: number) => r.months[Math.min(n, r.months.length) - 1]?.netWorth ?? 0;
    const free = Object.values(r.debtFree);
    let lowest: CompareRow['lowest'];
    for (const m of r.months) if (lowest === undefined || m.bank < lowest.amount) lowest = { ym: m.ym, amount: m.bank };
    let freedomYm: Ym | undefined;
    if (opts.yearlySpending !== undefined) {
      const f = freedom({ forecast: r, yearlySpending: opts.yearlySpending, assumptions: r.assumptions, today: base.today });
      if (f.status === 'ok') freedomYm = f.ym;
    }
    return {
      name,
      ...(free.length > 0 && free.every((ym) => ym !== undefined) && { debtFree: free.reduce((a, b) => (b! > a! ? b : a)) }),
      ...(lowest !== undefined && { lowest }),
      netWorth1y: at(12), netWorth5y: at(60), netWorth10y: at(120),
      ...(freedomYm !== undefined && { freedom: freedomYm }),
      totalInterest: r.totalInterest,
      series: r.months.map((m) => ({ ym: m.ym, bank: m.bank, netWorth: m.netWorth })),
    };
  };
  return [row('Base plan', []), ...scenarios.map((s) => row(s.name, s.changes))];
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** `2027-05` → `May 2027`. */
const monthName = (ym: Ym) => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const potLabel = (pot: PotId) => POTS.find((p) => p.id === pot)!.label;
const pct = (n: number) => `${n}%`;

/** Lowercase, diacritics removed: enough to find an "Other …" or "Extra …" category by its name. */
const folded = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '');

/** The live, shown categories of a pot in their order (savings goals aside), the one whose name starts with `prefer` first. */
function categoryIn(categories: BudgetCategory[], pot: PotId, prefer: string): string | undefined {
  const inPot = categories.filter((c) => !c.deleted && !c.hidden && c.pot === pot && c.id !== SAVINGS_GOALS_CATEGORY_ID)
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return (inPot.find((c) => folded(c.name).startsWith(prefer)) ?? inPot[0])?.id;
}

export function applyToPlan(data: BudgetData, settings: BudgetSettings, s: BudgetScenario, today: string): { writes: PlanWrite[]; summary: string[] } {
  const cur = ymOf(today);
  const writes: PlanWrite[] = [];
  const summary: string[] = [];
  const potOf = new Map(data.budgetCategories.map((c) => [c.id, c.pot]));
  const debts = data.budgetDebts.filter((d) => !d.deleted);
  const onlyDebt = debts.length === 1 ? debts[0].id : undefined;

  // Settings: rotation, salary and rates, as one change.
  let rotation: RotationSettings | undefined;
  let assumptions: Assumptions | undefined;
  // Month plans: the stored months with the edits so far; `fresh` holds the months this apply creates.
  let months = [...data.budgetMonths];
  const fresh = new Set<string>();
  const changedMonths = new Set<string>();
  let recurring = data.budgetRecurring.filter((t) => !t.deleted);

  for (const c of s.changes) {
    if (c.kind === 'rotation') {
      rotation = { ...(rotation ?? settings.rotation), ...(c.periods !== undefined && { periods: c.periods.map((p) => ({ ...p })) }),
        ...(c.patternOn !== undefined && { patternOn: c.patternOn }), ...(c.patternOff !== undefined && { patternOff: c.patternOff }) };
      const parts: string[] = [];
      if (c.periods !== undefined) parts.push(`${c.periods.length} contract period${c.periods.length === 1 ? '' : 's'}`);
      if (c.patternOn !== undefined || c.patternOff !== undefined) {
        parts.push(`${parts.length > 0 ? 'then ' : ''}${rotation.patternOn} months on and ${rotation.patternOff} off`);
      }
      summary.push(`Rotation: ${parts.join(', ') || 'unchanged'}`);
    } else if (c.kind === 'salary') {
      const from = (rotation ?? settings.rotation).salaryFrom.filter((x) => x.ym !== c.fromYm);
      rotation = { ...(rotation ?? settings.rotation), salaryFrom: [...from, { ym: c.fromYm, amount: c.amount }].sort((a, b) => (a.ym < b.ym ? -1 : 1)) };
      summary.push(`Salary: ${formatMoney(c.amount)} a month from ${monthName(c.fromYm)} on`);
    } else if (c.kind === 'rates') {
      assumptions = { ...(assumptions ?? settings.assumptions), ...(c.yearlyReturnPct !== undefined && { yearlyReturnPct: c.yearlyReturnPct }),
        ...(c.withdrawalRatePct !== undefined && { withdrawalRatePct: c.withdrawalRatePct }), ...(c.inflationPct !== undefined && { inflationPct: c.inflationPct }) };
      const parts = [
        ...(c.yearlyReturnPct !== undefined ? [`expected return ${pct(c.yearlyReturnPct)}`] : []),
        ...(c.withdrawalRatePct !== undefined ? [`withdrawal rate ${pct(c.withdrawalRatePct)}`] : []),
        ...(c.inflationPct !== undefined ? [`inflation ${pct(c.inflationPct)}`] : []),
      ];
      summary.push(`Assumptions: ${parts.join(', ') || 'unchanged'}`);
    } else if (c.kind === 'potTarget') {
      const { create, update } = setPotTarget(months, c.fromYm, c.pot, { kind: 'amount', value: c.amount }, 'fromOn');
      if (create.length > 0) {
        const id = `new-month:${c.fromYm}`;
        fresh.add(id);
        months = [...months, { ...create[0], id, createdAt: '', updatedAt: '', updatedBy: '', deleted: false, scope: 'personal' }];
      }
      for (const u of update) {
        months = months.map((m) => (m.id === u.id ? u : m));
        if (!fresh.has(u.id)) changedMonths.add(u.id);
      }
      summary.push(`${potLabel(c.pot)} target: ${formatMoney(c.amount)} a month from ${monthName(c.fromYm)} on`);
    } else if (c.kind === 'investment') {
      const affected = recurring
        .filter((t) => t.incomeSource === undefined && t.categoryId !== SAVINGS_GOALS_CATEGORY_ID && potOf.get(t.categoryId ?? '') === 'savings'
          && (t.endYm === undefined || t.endYm >= c.fromYm))
        .sort((a, b) => (a.startYm < b.startYm ? -1 : a.startYm > b.startYm ? 1 : 0));
      for (const t of affected) {
        if (t.startYm < c.fromYm) writes.push({ op: 'update', table: 'budgetRecurring', id: t.id, patch: { endYm: addMonths(c.fromYm, -1) } });
        else writes.push({ op: 'delete', table: 'budgetRecurring', id: t.id });
      }
      const gone = new Set(affected.map((t) => t.id));
      recurring = recurring.filter((t) => !gone.has(t.id));
      const first = affected[0];
      const categoryId = first?.categoryId ?? categoryIn(data.budgetCategories, 'savings', '');
      if (c.monthly > 0) {
        const fields: Fields<BudgetRecurring> = {
          name: first?.name ?? 'Investment contribution', amount: c.monthly, ...(categoryId !== undefined && { categoryId }), day: first?.day ?? 1, startYm: c.fromYm,
        };
        writes.push({ op: 'create', table: 'budgetRecurring', fields });
      }
      const replacing = affected.length > 0 ? ` (replacing ${affected.map((t) => t.name).join(', ')})` : '';
      summary.push(`Investments: ${formatMoney(c.monthly)} a month from ${monthName(c.fromYm)} on${replacing}`);
    } else if (c.kind === 'oneOff') {
      const date = `${c.ym}-01`;
      if (c.income === true) {
        writes.push({ op: 'create', table: 'budgetEntries', fields: { kind: 'income', date, amount: c.amount, incomeSource: 'other', note: c.label, status: 'planned', oneOff: true } });
        summary.push(`Planned income in ${monthName(c.ym)}: ${c.label}, ${formatMoney(c.amount)}`);
      } else {
        const categoryId = c.pot !== undefined ? categoryIn(data.budgetCategories, c.pot, 'other') : undefined;
        writes.push({ op: 'create', table: 'budgetEntries', fields: {
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
      const categoryId = categoryIn(data.budgetCategories, 'debts', 'extra');
      if (c.monthly !== undefined && c.monthly > 0) {
        // A template running now in the Debts pot that pays this debt (as the forecast reads it) already stops the instalment.
        const paid = recurring.some((t) => t.incomeSource === undefined && cur >= t.startYm && (t.endYm === undefined || cur <= t.endYm)
          && potOf.get(t.categoryId ?? '') === 'debts' && (t.untilDebtId !== undefined && debts.some((x) => x.id === t.untilDebtId) ? t.untilDebtId : onlyDebt) === d.id);
        const withInstalment = !paid && d.instalment > 0;
        const fields: Fields<BudgetRecurring> = {
          name: withInstalment ? `${d.name} instalment + extra` : `${d.name} extra payment`, amount: c.monthly + (withInstalment ? d.instalment : 0),
          ...(categoryId !== undefined && { categoryId }), day: 1, startYm: cur, untilDebtId: d.id,
        };
        writes.push({ op: 'create', table: 'budgetRecurring', fields });
        recurring = [...recurring, { ...fields, id: `new-template:${d.id}`, createdAt: '', updatedAt: '', updatedBy: '', deleted: false, scope: 'personal' }];
        summary.push(`${d.name}: extra ${formatMoney(c.monthly)} a month from ${monthName(cur)} on${withInstalment
          ? ` (one template with its ${formatMoney(d.instalment)} instalment, ${formatMoney(fields.amount)} a month)` : ''}`);
      }
      if (c.lumpYm !== undefined && c.lump !== undefined && c.lump > 0) {
        writes.push({ op: 'create', table: 'budgetEntries', fields: {
          kind: 'expense', date: `${c.lumpYm}-01`, amount: c.lump, ...(categoryId !== undefined && { categoryId }), debtId: d.id,
          note: `Extra payment: ${d.name}`, status: 'planned', oneOff: true,
        } });
        summary.push(`${d.name}: extra payment of ${formatMoney(c.lump)} in ${monthName(c.lumpYm)}`);
      }
    }
  }

  const monthWrites: PlanWrite[] = [];
  for (const m of months) {
    if (fresh.has(m.id)) {
      const { id: _id, createdAt: _c, updatedAt: _u, updatedBy: _b, deleted: _d, scope: _s, ...fields } = m;
      monthWrites.push({ op: 'create', table: 'budgetMonths', fields });
    } else if (changedMonths.has(m.id)) {
      monthWrites.push({ op: 'update', table: 'budgetMonths', id: m.id, patch: { potTargets: m.potTargets } });
    }
  }
  const settingsWrite: PlanWrite[] = rotation !== undefined || assumptions !== undefined
    ? [{ op: 'update', table: 'budgetSettings', id: settings.id, patch: { ...(rotation !== undefined && { rotation }), ...(assumptions !== undefined && { assumptions }) } }]
    : [];
  return { writes: [...settingsWrite, ...monthWrites, ...writes], summary };
}

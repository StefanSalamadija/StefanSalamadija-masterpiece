import type {
  Assumptions, BudgetAsset, BudgetCategory, BudgetCorrection, BudgetDebt, BudgetEntry, BudgetFund, BudgetFundMove, BudgetGoal, BudgetMonth,
  BudgetRecurring, BudgetScenario, BudgetSettings, Cents, PotId, Ym,
} from '../domain/types';
import { extraFor, monthlyInterest } from './debts';
import { fundLedger, fundStatus } from './funds';
import { balancesByMonth, SAVINGS_GOALS_CATEGORY_ID } from './ledger';
import { addMonths, monthsBetween, ymOf } from './months';
import { rotationPeriods, salaryFromPeriods } from './rotation';
import type { MonthStatus } from './rotation';
import { effectiveMonth, potTargetAmount } from './targets';

/*
 * The cash-flow forecast (v2 §3.3, §3.9.1, §3.9.4–§3.9.6, §3.9.9), month by month from the current month (the month
 * of `today`, ship's today) to the horizon. Pure: nothing is stored.
 *
 * Start. Without a bank correction at or before the current month there is no bank start: `needsBankStart`, and no
 * months. Otherwise each account starts from `balancesByMonth` at the end of last month (corrections, actual entries,
 * debt interest, funds, as the ledger has them). A correction made in the current month is taken as already holding
 * the month's actual entries: the month is that balance plus what is still to come.
 *
 * Income = salary + other income:
 *  - salary: the actual salary entries of the month when there are any, else the pay rule (`rotation.ts`) for the
 *    salary that lands in the month (paid the same month, or the next). Planned salary entries and salary templates
 *    are left out: the rule is the salary, so it is never counted twice;
 *  - other income: actual + max(0, planned − actual), planned being the other income templates running in the month,
 *    and the planned income entries made by hand.
 *
 * Spending is what leaves the bank. It is worked out per line ("key"), each the actual entries of the month plus
 * max(0, planned − actual), so the current month blends what was spent with what is still planned and nothing is
 * counted twice (§3.9.4). What is planned for a month:
 *  - recurring templates (an expense template counts its amount; one whose planned entry the user deleted this month,
 *    with no live entry left, is left out; a template that pays off a debt stops once the debt is paid);
 *  - sinking funds: the set-aside each fund asks for is earmarked inside the bank, so it leaves nothing; the bill
 *    leaves the bank, in full, in the month it is due (an overdue bill in the current month);
 *  - planned expense entries made by hand (one-off purchases and extra debt payments to confirm);
 *  - everything else by the pot's method:
 *      - targets: a category with a target forecasts max(0, target − its templates and fund set-asides); the pot
 *        target covers the categories without one: max(0, pot target − the targeted categories' forecasts − what the
 *        templates and set-asides of the others cover). A % target is of the month's planned income (as in the month
 *        view). Nothing goes below zero (§3.9.5);
 *      - average: per category, the average of the last 6 tracked months (months before this one with an actual
 *        entry) of the actual entries not made from a template, not paid from a fund and not marked one-off;
 *      - fixed: the pot's fixed amount a month.
 *    The keys follow the method: a targeted category is its own line and a pot's other categories share one (its
 *    pot target is theirs); with average each category is a line; with fixed the pot is one line.
 *  - Savings-goal money stays in the bank (as in the ledger): it is no spending here.
 *
 * Debt instalments: each live debt that still owes at the start of a month (from its start month) is paid its
 * `instalment`, a planned Debts payment on that debt, unless an expense template in the Debts pot that pays that debt
 * (its `untilDebtId`, or the only debt) runs in the month, so it is never paid twice. Under the targets method the
 * Debts pot's plan covers these instalments first, whatever its method: under targets they use up the Debts category
 * targets first, then the pot target; a fixed amount is net of them; and the average leaves out past payments to a
 * debt that has an instalment. An actual payment to the debt counts against it (one line). With two or more debts, an
 * actual Debts payment that names no debt pays none (the ledger lists it as unassigned, for the user to say which):
 * until then it is counted on top of the instalments.
 *
 * A debt's planned extra (its `extraSteps`: in each month the latest step at or before it) is paid on top, while the
 * debt still owes at the start of the month: a planned payment on the debt's own line. A template that pays the debt
 * takes the instalment's place only, never the extra's, and the extra is never covered by a Debts target or a fixed
 * amount. The last payment is only what is left. A what-if extra (`whatIfExtra`) is added to it the same way.
 *
 * Transfers (§3.9.1): spending in the Savings & investments pot raises investments (the contribution), in the
 * Emergency fund pot raises the emergency fund, and in the Debts pot lowers the debt it pays: the one the entry names,
 * or the one its template pays off, else the only debt, else none (the bank still pays it). A debt is charged a
 * month's interest on its balance at the start of each month (rounded to the cent), and planned payments stop at
 * what it owes, so it never goes below zero by a planned payment.
 *
 * Investments grow each month by (1 + r)^(1/12), r the expected return (none without one), rounded to the cent:
 * investments(m) = round(investments(m − 1) × growth) + contribution(m).
 *
 * So bank(m) = bank(m − 1) + income(m) − spending(m) exactly, in whole cents; free to spend = bank − the funds'
 * balances; net worth = bank + investments + emergency fund + assets included − debts (assets held at their value).
 *
 * Warnings: `belowBuffer` in each month whose free to spend is below the buffer (`bufferCents`, else a month of Needs:
 * the forecast's average monthly Needs spending) and `negativeBank` in each month the bank is below zero. The lowest
 * point is the month with the least free to spend (the first, on a tie).
 *
 * A scenario (§3.5) is forecast as the plan it would make: `scenarios.ts` carries "Apply to plan" out on a copy of the
 * data and settings and forecasts that, so what is compared is what applying gives.
 */

/** Every budget table but the settings, as the db holds them (deleted records included: they are left out here). */
export interface BudgetData {
  budgetCategories: BudgetCategory[]; budgetEntries: BudgetEntry[]; budgetMonths: BudgetMonth[]; budgetRecurring: BudgetRecurring[];
  budgetFunds: BudgetFund[]; budgetFundMoves: BudgetFundMove[]; budgetDebts: BudgetDebt[]; budgetGoals: BudgetGoal[]; budgetAssets: BudgetAsset[];
  budgetCorrections: BudgetCorrection[]; budgetScenarios: BudgetScenario[];
}

export interface ForecastInput {
  /** Ship's today, `YYYY-MM-DD`: its month is the first forecast month. */
  today: string; data: BudgetData; settings: BudgetSettings;
  /** How many months to forecast, instead of the settings' horizon (a scenario comparison looks 10 years ahead). */
  months?: number;
  /** "With an extra €X/month": a what-if amount paid to one debt each month from now on, on top of its stored extra. */
  whatIfExtra?: { debtId: string; amount: Cents };
}

export interface ForecastMonth {
  ym: Ym; status: MonthStatus; income: Cents; spending: Cents; bank: Cents; freeToSpend: Cents; investments: Cents; emergency: Cents;
  /** All debts' balances at the month end. */
  debts: Cents; netWorth: Cents;
  /** The sinking funds' balances at the month end (earmarked inside the bank). */
  funds: Cents;
  /** Paid into investments in the month (the planned investment amount). */
  contribution: Cents;
  /** Debt interest charged in the month. */
  interest: Cents;
  /** Spending in the Needs pot. */
  needs: Cents;
  /** Spending by pot (savings-goal money, which stays in the bank, and spending in no pot left out). */
  pots: Record<PotId, Cents>;
  /** Spending that moved into investments, the emergency fund or a debt (the rest of spending is gone). */
  transfers: Cents;
}

export interface ForecastResult {
  months: ForecastMonth[]; lowest?: { ym: Ym; freeToSpend: Cents; status: string }; warnings: { kind: 'belowBuffer' | 'negativeBank'; ym: Ym }[];
  /** Each debt's last payment month within the forecast (the month before it, for one already paid off); undefined if not paid off in it. */
  debtFree: Record<string, Ym | undefined>; totalInterest: Cents;
  /** Each debt's interest within the forecast (they add up to `totalInterest`). */
  interestByDebt: Record<string, Cents>;
  needsBankStart: boolean;
  /** The buffer the warnings use. */
  buffer: Cents;
  /** Investments at the end of the month before the first forecast month. */
  startInvestments: Cents;
  /**
   * Investments were corrected in the current month: the first month's investments are that correction (with what is
   * still to come), not `startInvestments` grown by a month.
   */
  investmentsCorrectedNow: boolean;
  /** The Debts templates left out because they do not say which of 2 or more debts they pay (`unassignedDebtTemplates`). */
  unassignedDebtTemplates: string[];
  /** The assumptions in force. */
  assumptions: Assumptions;
}

interface Line { key: string; pot?: PotId; debtId?: string; amount: Cents }

const POT_IDS: PotId[] = ['needs', 'savings', 'wants', 'debts', 'emergency'];
/**
 * The Debts-pot payment templates that do not say which debt they pay (`untilDebtId`) while there are 2 or more debts.
 * With one debt such a template pays it; with more, the forecast cannot tell which debt's instalment it replaces, so it
 * counts it nowhere (each debt keeps its own instalment, never paid twice) and lists it until the user picks the debt.
 */
export function unassignedDebtTemplates(recurring: BudgetRecurring[], categories: BudgetCategory[], debts: BudgetDebt[]): BudgetRecurring[] {
  const live = debts.filter((d) => !d.deleted);
  if (live.length < 2) return [];
  const ids = new Set(live.map((d) => d.id));
  const potOf = new Map(categories.map((c) => [c.id, c.pot]));
  return recurring.filter((t) => !t.deleted && t.incomeSource === undefined && potOf.get(t.categoryId ?? '') === 'debts'
    && !(t.untilDebtId !== undefined && ids.has(t.untilDebtId)));
}

const sum = (xs: Iterable<number>) => { let s = 0; for (const x of xs) s += x; return s; };

export function forecast(input: ForecastInput): ForecastResult {
  const { data, settings } = input;
  const { rotation, assumptions } = settings;
  const cur = ymOf(input.today);
  const prev = addMonths(cur, -1);
  const corrections = data.budgetCorrections.filter((c) => !c.deleted);
  const empty: ForecastResult = { months: [], warnings: [], debtFree: {}, totalInterest: 0, interestByDebt: {}, needsBankStart: true, buffer: settings.bufferCents ?? 0, startInvestments: 0, investmentsCorrectedNow: false, assumptions, unassignedDebtTemplates: [] };
  if (!corrections.some((c) => c.account === 'bank' && c.ym <= cur)) return empty;

  const count = Math.max(1, Math.floor(input.months ?? settings.horizon));
  const last = addMonths(cur, count - 1);
  const categories = data.budgetCategories.filter((c) => !c.deleted);
  // Deleted categories still route their entries, as in the ledger.
  const potOf = new Map(data.budgetCategories.map((c) => [c.id, c.pot]));
  const debts = data.budgetDebts.filter((d) => !d.deleted);
  const debtIds = new Set(debts.map((d) => d.id));
  const funds = data.budgetFunds.filter((f) => !f.deleted);
  const templates = data.budgetRecurring.filter((t) => !t.deleted);
  const templateById = new Map(templates.map((t) => [t.id, t]));
  const assets = data.budgetAssets.filter((a) => !a.deleted);
  const onlyDebt = debts.length === 1 ? debts[0].id : undefined;
  const unassigned = new Set(unassignedDebtTemplates(templates, data.budgetCategories, debts).map((t) => t.id));

  const { balances } = balancesByMonth({
    entries: data.budgetEntries, corrections: data.budgetCorrections, debts: data.budgetDebts, assets: data.budgetAssets, categories: data.budgetCategories,
    fundMoves: data.budgetFundMoves, funds: data.budgetFunds, fromYm: prev, toYm: cur, recurring: data.budgetRecurring,
  });
  const before = balances.get(prev)!;
  const atCur = balances.get(cur)!;
  const correctedNow = (account: string) => corrections.some((c) => c.account === account && c.ym === cur);

  // Entries by month, from the current month on; the history for the average method.
  const byMonth = new Map<Ym, BudgetEntry[]>();
  const tombstones = new Map<Ym, Set<string>>();
  const history = new Map<Ym, BudgetEntry[]>();
  for (const e of data.budgetEntries) {
    const ym = ymOf(e.date);
    if (e.deleted) {
      if (ym >= cur && ym <= last && e.recurringId !== undefined) (tombstones.get(ym) ?? tombstones.set(ym, new Set()).get(ym)!).add(e.recurringId);
      continue;
    }
    if (ym >= cur && ym <= last) (byMonth.get(ym) ?? byMonth.set(ym, []).get(ym)!).push(e);
    else if (ym < cur && e.status === 'actual') (history.get(ym) ?? history.set(ym, []).get(ym)!).push(e);
  }
  const tracked = [...history.keys()].sort().slice(-6);
  const average = new Map<string, Cents>();
  for (const ym of tracked) {
    for (const e of history.get(ym)!) {
      if (e.kind !== 'expense' || e.categoryId === undefined || e.recurringId !== undefined || e.fundId !== undefined || e.oneOff === true) continue;
      // A payment to a debt with an instalment is the instalment's: it is paid automatically, never by the average too.
      if (potOf.get(e.categoryId) === 'debts') {
        const paidDebt = e.debtId !== undefined ? (debtIds.has(e.debtId) ? e.debtId : undefined) : onlyDebt;
        if (paidDebt !== undefined && debts.find((d) => d.id === paidDebt)!.instalment > 0) continue;
      }
      average.set(e.categoryId, (average.get(e.categoryId) ?? 0) + e.amount);
    }
  }
  for (const [id, total] of average) average.set(id, Math.round(total / tracked.length));

  const periods = rotationPeriods(rotation, last);
  const growth = assumptions.yearlyReturnPct !== undefined ? (1 + assumptions.yearlyReturnPct / 100) ** (1 / 12) : 1;

  // Running balances.
  let bank = before.bank;
  let invested = before.investments;
  let emergency = before.emergency;
  const debtBalance = new Map<string, Cents | undefined>(debts.map((d) => [d.id, d.startYm <= prev ? before[`debt:${d.id}`] : undefined]));
  const debtFree: Record<string, Ym | undefined> = {};
  for (const d of debts) {
    const b = debtBalance.get(d.id);
    debtFree[d.id] = b !== undefined && b <= 0 ? prev : undefined;
  }
  const assetsValue = sum(assets.filter((a) => a.includeInNetWorth).map((a) => atCur[`asset:${a.id}`] ?? 0));

  // Funds: their state at the end of the current month comes from their records; later months are simulated.
  const fundState = funds.map((f) => {
    const ledger = fundLedger(f, data.budgetFundMoves, cur, data.budgetCorrections);
    const status = fundStatus(f, data.budgetFundMoves, cur, data.budgetCorrections);
    const repeats = f.repeatMonths !== undefined && f.repeatMonths > 0;
    const hasSetAside = data.budgetFundMoves.some((m) => m.fundId === f.id && !m.deleted && m.ym === cur && m.kind === 'setaside');
    return { fund: f, balance: ledger.balance, dueYm: status.dueYm, done: !repeats && ledger.paidCount > 0, repeats,
      firstSetAside: hasSetAside ? 0 : status.setAside, setAsideSoFar: ledger.setAsideThisCycle };
  });

  const months: ForecastMonth[] = [];
  let totalInterest = 0;
  const interestByDebt: Record<string, Cents> = Object.fromEntries(debts.map((d) => [d.id, 0]));

  for (let i = 0; i < count; i += 1) {
    const ym = addMonths(cur, i);
    const isCur = i === 0;
    const plan = effectiveMonth(data.budgetMonths, ym);
    const plannedIncome = plan.plannedIncome ?? 0;
    const entries = byMonth.get(ym) ?? [];
    const removed = tombstones.get(ym);

    // Income.
    const salaryEntries = entries.filter((e) => e.kind === 'income' && e.status === 'actual' && e.incomeSource === 'salary');
    const earned = salaryFromPeriods(rotation, periods, rotation.paidNextMonth ? addMonths(ym, -1) : ym).amount;
    const salary = salaryEntries.length > 0 ? sum(salaryEntries.map((e) => e.amount)) : earned;
    const otherActual = sum(entries.filter((e) => e.kind === 'income' && e.status === 'actual' && e.incomeSource !== 'salary').map((e) => e.amount));
    let otherPlanned = 0;
    for (const e of entries) {
      if (e.kind === 'income' && e.status === 'planned' && e.incomeSource !== 'salary' && !(e.recurringId !== undefined && templateById.has(e.recurringId))) otherPlanned += e.amount;
    }

    // Which line a category's spending falls on.
    const lineOf = (categoryId: string | undefined): { key: string; pot?: PotId } => {
      if (categoryId === undefined) return { key: 'none' };
      if (categoryId === SAVINGS_GOALS_CATEGORY_ID) return { key: 'goals', pot: 'savings' };
      const pot = potOf.get(categoryId);
      if (pot === undefined) return { key: 'none' };
      const method = settings.forecastMethod[pot] ?? 'targets';
      if (method === 'fixed') return { key: `pot:${pot}`, pot };
      if (method === 'average' || plan.categoryTargets[categoryId] !== undefined) return { key: `cat:${categoryId}`, pot };
      return { key: `pot:${pot}`, pot };
    };
    const debtLine = (debtId: string): { key: string; pot: PotId; debtId: string } => ({ key: `debt:${debtId}`, pot: 'debts', debtId });
    const templateLine = (t: BudgetRecurring): { key: string; pot?: PotId; debtId?: string } =>
      (t.untilDebtId !== undefined && debtIds.has(t.untilDebtId) && potOf.get(t.categoryId ?? '') === 'debts' ? debtLine(t.untilDebtId) : lineOf(t.categoryId));
    const planned: Line[] = [];
    const actual: Line[] = [];
    /** Covered by templates and fund set-asides, by category (the targets method). */
    const covered = new Map<string, Cents>();
    const cover = (categoryId: string | undefined, amount: Cents) => {
      if (categoryId !== undefined) covered.set(categoryId, (covered.get(categoryId) ?? 0) + amount);
    };

    // Templates.
    for (const t of templates) {
      if (ym < t.startYm || (t.endYm !== undefined && ym > t.endYm)) continue;
      if (unassigned.has(t.id)) continue; // which debt it pays is not known yet: see `unassignedDebtTemplates`
      const live = entries.filter((e) => e.recurringId === t.id);
      if (live.length === 0 && removed?.has(t.id)) continue;
      if (t.untilDebtId !== undefined && debtIds.has(t.untilDebtId)) {
        const owed = debtBalance.get(t.untilDebtId);
        const started = debts.find((d) => d.id === t.untilDebtId)!;
        const atStart = owed ?? (ym >= started.startYm ? started.startBalance : undefined);
        if (atStart !== undefined && atStart <= 0) continue;
      }
      const plannedEntry = live.find((e) => e.status === 'planned');
      const amount = plannedEntry?.amount ?? t.amount;
      if (t.incomeSource !== undefined) {
        if (t.incomeSource !== 'salary') otherPlanned += amount;
        continue;
      }
      planned.push({ ...templateLine(t), amount });
      cover(t.categoryId, amount);
    }

    // Each debt still owing is paid its instalment, unless a template running this month pays it already.
    let autoInstalments = 0;
    for (const d of debts) {
      if (d.instalment <= 0 || ym < d.startYm) continue;
      const atStart = debtBalance.get(d.id) ?? d.startBalance;
      if (atStart <= 0) continue;
      const paidByTemplate = templates.some((t) => t.incomeSource === undefined && ym >= t.startYm && (t.endYm === undefined || ym <= t.endYm)
        && potOf.get(t.categoryId ?? '') === 'debts' && (templateLine(t).debtId ?? onlyDebt) === d.id);
      if (paidByTemplate) continue;
      planned.push({ ...debtLine(d.id), amount: d.instalment });
      autoInstalments += d.instalment;
    }

    // Each debt still owing is paid its planned extra (and a what-if extra) on top, from its from-month: on the debt's
    // own line, never given way to by a template, and never covered by a target or a fixed amount.
    for (const d of debts) {
      if (ym < d.startYm) continue;
      const atStart = debtBalance.get(d.id) ?? d.startBalance;
      if (atStart <= 0) continue;
      const stored = Math.max(0, extraFor(d.extraSteps, ym));
      const whatIf = input.whatIfExtra?.debtId === d.id ? Math.max(0, input.whatIfExtra.amount) : 0;
      if (stored + whatIf > 0) planned.push({ ...debtLine(d.id), amount: stored + whatIf });
    }

    // Funds: the set-aside (earmarked) and the bill when due.
    let fundsTotal = 0;
    for (const s of fundState) {
      const f = s.fund;
      let setAside: Cents;
      if (isCur) {
        setAside = s.firstSetAside;
        cover(f.categoryId, s.setAsideSoFar + setAside);
      } else {
        const missing = Math.max(0, f.amount - s.balance);
        const left = monthsBetween(ym, s.dueYm) + 1;
        setAside = s.done || missing === 0 ? 0 : left <= 0 ? missing : Math.ceil(missing / left);
        cover(f.categoryId, setAside);
      }
      s.balance += setAside;
      if (!s.done && s.dueYm <= ym) {
        planned.push({ ...lineOf(f.categoryId), amount: f.amount });
        s.balance -= Math.max(0, Math.min(f.amount, s.balance));
        if (s.repeats) s.dueYm = addMonths(s.dueYm, f.repeatMonths!);
        else s.done = true;
      }
      fundsTotal += s.balance;
    }

    // Planned entries made by hand.
    for (const e of entries) {
      if (e.kind !== 'expense' || e.status !== 'planned' || (e.recurringId !== undefined && templateById.has(e.recurringId))) continue;
      planned.push({ ...(e.debtId !== undefined && debtIds.has(e.debtId) && potOf.get(e.categoryId ?? '') === 'debts' ? debtLine(e.debtId) : lineOf(e.categoryId)), amount: e.amount });
    }

    // Everything else, by the pot's method.
    for (const pot of POT_IDS) {
      // Savings-goal money stays in the bank: its category takes its share of the pot target, but is no spending.
      const inPot = categories.filter((c) => c.pot === pot);
      const method = settings.forecastMethod[pot] ?? 'targets';
      // The automatic debt instalments come first out of the Debts pot's plan, whatever its method.
      let pool = pot === 'debts' ? autoInstalments : 0;
      if (method === 'fixed') {
        planned.push({ key: `pot:${pot}`, pot, amount: Math.max(0, (settings.fixedSpend?.[pot] ?? 0) - pool) });
      } else if (method === 'average') {
        for (const c of inPot) if (c.id !== SAVINGS_GOALS_CATEGORY_ID) planned.push({ key: `cat:${c.id}`, pot, amount: average.get(c.id) ?? 0 });
      } else {
        const potTarget = potTargetAmount(plan.potTargets[pot], plannedIncome);
        let taken = 0;
        for (const c of inPot) {
          const target = plan.categoryTargets[c.id]?.amount;
          const cov = covered.get(c.id) ?? 0;
          if (target === undefined) { taken += cov; continue; }
          const rest = Math.max(0, target - cov);
          const byInstalments = Math.min(rest, pool);
          pool -= byInstalments;
          if (c.id !== SAVINGS_GOALS_CATEGORY_ID) planned.push({ key: `cat:${c.id}`, pot, amount: rest - byInstalments });
          taken += Math.max(target, cov);
        }
        planned.push({ key: `pot:${pot}`, pot, amount: Math.max(0, potTarget - taken - pool) });
      }
    }

    // Actual spending.
    for (const e of entries) {
      if (e.kind !== 'expense' || e.status !== 'actual') continue;
      // An entry made from a template falls on the template's line; another payment on its debt's (as in the ledger).
      const template = e.recurringId !== undefined ? templateById.get(e.recurringId) : undefined;
      if (template !== undefined && template.incomeSource === undefined) {
        actual.push({ ...templateLine(template), amount: e.amount });
        continue;
      }
      const pot = potOf.get(e.categoryId ?? '');
      const debtId = pot !== 'debts' ? undefined : e.debtId !== undefined ? (debtIds.has(e.debtId) ? e.debtId : undefined) : onlyDebt;
      actual.push({ ...(debtId !== undefined ? debtLine(debtId) : lineOf(e.categoryId)), amount: e.amount });
    }

    // Blend each line: actual + max(0, planned − actual). Savings-goal money stays in the bank.
    const lines = new Map<string, { pot?: PotId; debtId?: string; actual: Cents; planned: Cents }>();
    const put = (l: Line, field: 'actual' | 'planned') => {
      if (l.key === 'goals') return;
      const held = lines.get(l.key) ?? { ...(l.pot !== undefined && { pot: l.pot }), ...(l.debtId !== undefined && { debtId: l.debtId }), actual: 0, planned: 0 };
      held[field] += l.amount;
      lines.set(l.key, held);
    };
    planned.forEach((l) => put(l, 'planned'));
    actual.forEach((l) => put(l, 'actual'));
    const spendOf = new Map<string, { actual: Cents; rest: Cents }>();
    for (const [key, l] of lines) spendOf.set(key, { actual: l.actual, rest: Math.max(0, l.planned - l.actual) });
    const debtOfLine = (l: { pot?: PotId; debtId?: string }) => (l.pot === 'debts' ? l.debtId ?? onlyDebt : undefined);

    // Debts: a month's interest, then the payments; planned payments stop at what the debt owes.
    let interest = 0;
    const paidTo = new Map<string, { actual: Cents; rest: Cents }>();
    for (const d of debts) {
      let balance = debtBalance.get(d.id);
      if (balance === undefined && ym >= d.startYm) balance = d.startBalance;
      if (balance === undefined) continue;
      const charged = ym >= d.startYm ? monthlyInterest(balance, d.yearlyRatePct) : 0;
      const owed = balance + charged;
      let paidActual = 0;
      for (const [key, l] of lines) if (debtOfLine(l) === d.id) paidActual += spendOf.get(key)!.actual;
      let room = Math.max(0, owed - paidActual);
      let paidRest = 0;
      for (const [key, l] of lines) {
        if (debtOfLine(l) !== d.id) continue;
        const s = spendOf.get(key)!;
        s.rest = Math.min(s.rest, room);
        room -= s.rest;
        paidRest += s.rest;
      }
      paidTo.set(d.id, { actual: paidActual, rest: paidRest });
      interest += charged;
      interestByDebt[d.id] = (interestByDebt[d.id] ?? 0) + charged;
      const end = isCur && correctedNow(`debt:${d.id}`) ? atCur[`debt:${d.id}`] - paidRest : owed - paidActual - paidRest;
      debtBalance.set(d.id, end);
      if (debtFree[d.id] === undefined && end <= 0 && balance > 0) debtFree[d.id] = ym;
    }

    let spending = 0;
    let spendingActual = 0;
    let contribution = 0;
    let contributionActual = 0;
    let toEmergency = 0;
    let toEmergencyActual = 0;
    let needs = 0;
    const pots: Record<PotId, Cents> = { needs: 0, savings: 0, wants: 0, debts: 0, emergency: 0 };
    for (const [key, l] of lines) {
      const s = spendOf.get(key)!;
      const total = s.actual + s.rest;
      spending += total;
      spendingActual += s.actual;
      if (l.pot === 'savings') { contribution += total; contributionActual += s.actual; }
      if (l.pot === 'emergency') { toEmergency += total; toEmergencyActual += s.actual; }
      if (l.pot === 'needs') needs += total;
      if (l.pot !== undefined) pots[l.pot] += total;
    }

    const otherIncome = otherActual + Math.max(0, otherPlanned - otherActual);
    const income = salary + otherIncome;
    const incomeActual = (salaryEntries.length > 0 ? salary : 0) + otherActual;
    if (isCur && correctedNow('bank')) bank = atCur.bank + (income - incomeActual) - (spending - spendingActual);
    else bank += income - spending;
    if (isCur && correctedNow('investments')) invested = atCur.investments + contribution - contributionActual;
    else invested = Math.round(invested * growth) + contribution;
    if (isCur && correctedNow('emergency')) emergency = atCur.emergency + toEmergency - toEmergencyActual;
    else emergency += toEmergency;

    totalInterest += interest;
    const debtsTotal = sum([...debtBalance.values()].map((b) => b ?? 0));
    months.push({
      ym, status: salaryFromPeriods(rotation, periods, ym).onboard, income, spending, bank, freeToSpend: bank - fundsTotal, investments: invested,
      emergency, debts: debtsTotal, netWorth: bank + invested + emergency + assetsValue - debtsTotal, funds: fundsTotal, contribution, interest, needs, pots,
      transfers: contribution + toEmergency + sum([...paidTo.values()].map((p) => p.actual + p.rest)),
    });
  }

  const buffer = settings.bufferCents ?? Math.round(sum(months.map((m) => m.needs)) / months.length);
  const warnings: ForecastResult['warnings'] = [];
  let lowest: ForecastResult['lowest'];
  for (const m of months) {
    if (m.freeToSpend < buffer) warnings.push({ kind: 'belowBuffer', ym: m.ym });
    if (m.bank < 0) warnings.push({ kind: 'negativeBank', ym: m.ym });
    if (lowest === undefined || m.freeToSpend < lowest.freeToSpend) lowest = { ym: m.ym, freeToSpend: m.freeToSpend, status: m.status };
  }
  return { months, lowest, warnings, debtFree, totalInterest, interestByDebt, needsBankStart: false, buffer, startInvestments: before.investments,
    investmentsCorrectedNow: correctedNow('investments'), assumptions, unassignedDebtTemplates: [...unassigned] };
}

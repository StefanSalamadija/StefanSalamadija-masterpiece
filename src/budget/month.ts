import type { BudgetCategory, BudgetEntry, BudgetFund, BudgetFundMove, BudgetMonth, Cents, PotId, Ym } from '../domain/types';
import { POTS } from './catalog';
import { fundLedger, fundStatus } from './funds';
import { ymOf } from './months';
import { potTargetAmount } from './targets';

/*
 * The totals of a month (base §3.2–§3.4, v2 §3.2, §3.9.1 and §3.9.6).
 *
 *  - A pot's target is a % of planned income or an amount; the other is worked out from planned income.
 *  - Spent is the month's actual expense entries in the pot's categories. A transfer category (savings, emergency
 *    fund, debts) counts toward its pot, as in the workbook.
 *  - A confirmed set-aside counts as spent against the pot (and category) of its fund's category. A bill paid from a
 *    fund counts only for the part the fund did not cover (what its `paid` record took), so it is never counted twice;
 *    a bill bigger than its fund shows the rest as spent, which is overspend.
 *  - Planned is the month's planned (to confirm) expense entries, plus the set-aside each fund still asks for this
 *    month. A planned entry counts in planned, never in spent, and planned income entries are not actual income.
 *  - Unused = target − spent (negative is overspent); the surplus is the sum of the pots' unused.
 *  - An entry without a category, or in a category not listed, belongs to no pot.
 */

export type CategoryBand = 'ok' | 'amber' | 'red' | 'none';

export interface PotSummary { pot: PotId; target: Cents; targetPct: number; spent: Cents; spentPct: number; unused: Cents; planned: Cents }
export interface MonthSummary {
  ym: Ym; plannedIncome: Cents; actualIncome: Cents; pots: PotSummary[]; targetsPctTotal: number; surplus: Cents;
  categories: { categoryId: string; target?: Cents; spent: Cents; band: CategoryBand }[];
}

/** A category's progress: amber from 90% of its target, red over it, none without a target. */
export function categoryBand(spent: Cents, target: Cents | undefined): CategoryBand {
  if (target === undefined) return 'none';
  if (spent > target) return 'red';
  // In whole numbers: spent ≥ 90% of target.
  return target > 0 && spent * 10 >= target * 9 ? 'amber' : 'ok';
}

/** Rounds a percentage to two decimals, so that amounts that add up to the income give exactly 100. */
function pct(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The warning a month shows when its targets do not add up to 100%: `Targets add up to <n>% — adjust to 100%.` */
export function targetsWarning(targetsPctTotal: number): string | undefined {
  const total = pct(targetsPctTotal);
  return total === 100 ? undefined : `Targets add up to ${total}% — adjust to 100%.`;
}

export function summariseMonth(input: {
  month: BudgetMonth; entries: BudgetEntry[]; categories: BudgetCategory[]; fundMoves: BudgetFundMove[]; funds: BudgetFund[];
}): MonthSummary {
  const { month } = input;
  const ym = month.ym;
  const plannedIncome = month.plannedIncome ?? 0;
  const potOf = new Map(input.categories.map((c) => [c.id, c.pot]));
  const fundsById = new Map(input.funds.map((f) => [f.id, f]));
  const entries = input.entries.filter((e) => !e.deleted && ymOf(e.date) === ym);

  const spentBy = new Map<string, Cents>();
  const plannedBy = new Map<string, Cents>();
  const add = (map: Map<string, Cents>, categoryId: string | undefined, amount: Cents) => {
    if (categoryId !== undefined) map.set(categoryId, (map.get(categoryId) ?? 0) + amount);
  };

  // What each bill record took from its fund, by the entry it paid.
  const coveredBy = new Map<string, Cents>();
  for (const fund of input.funds) {
    const { taken } = fundLedger(fund, input.fundMoves, ym);
    for (const m of input.fundMoves) {
      if (m.fundId === fund.id && m.kind === 'paid' && m.entryId !== undefined && taken.has(m.id)) {
        coveredBy.set(m.entryId, (coveredBy.get(m.entryId) ?? 0) + taken.get(m.id)!);
      }
    }
  }

  let actualIncome = 0;
  for (const e of entries) {
    if (e.kind === 'income') {
      if (e.status === 'actual') actualIncome += e.amount;
    } else if (e.status === 'planned') {
      add(plannedBy, e.categoryId, e.amount);
    } else {
      add(spentBy, e.categoryId, e.amount - Math.min(e.amount, coveredBy.get(e.id) ?? 0));
    }
  }

  for (const m of input.fundMoves) {
    if (!m.deleted && m.ym === ym && m.kind === 'setaside') add(spentBy, fundsById.get(m.fundId)?.categoryId, m.amount);
  }
  for (const fund of input.funds) {
    if (fund.deleted || input.fundMoves.some((m) => m.fundId === fund.id && !m.deleted && m.ym === ym && m.kind === 'setaside')) continue;
    add(plannedBy, fund.categoryId, fundStatus(fund, input.fundMoves, ym).setAside);
  }

  const potTotal = (map: Map<string, Cents>, pot: PotId) =>
    [...map].reduce((sum, [categoryId, amount]) => (potOf.get(categoryId) === pot ? sum + amount : sum), 0);
  const share = (amount: Cents) => (plannedIncome > 0 ? (amount / plannedIncome) * 100 : 0);

  let targetsPctTotal = 0;
  const pots: PotSummary[] = POTS.map(({ id }) => {
    const t = month.potTargets[id];
    const target = potTargetAmount(t, plannedIncome);
    const targetPct = t === undefined ? 0 : t.kind === 'pct' ? t.value : share(t.value);
    targetsPctTotal += targetPct;
    const spent = potTotal(spentBy, id);
    return { pot: id, target, targetPct: pct(targetPct), spent, spentPct: pct(share(spent)), unused: target - spent, planned: potTotal(plannedBy, id) };
  });

  const categories = input.categories.map((c) => {
    const target = month.categoryTargets[c.id]?.amount;
    const spent = spentBy.get(c.id) ?? 0;
    return { categoryId: c.id, ...(target !== undefined && { target }), spent, band: categoryBand(spent, target) };
  });

  return {
    ym, plannedIncome, actualIncome, pots, targetsPctTotal: pct(targetsPctTotal),
    surplus: pots.reduce((sum, p) => sum + p.unused, 0), categories,
  };
}

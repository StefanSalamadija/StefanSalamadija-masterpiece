import { daysBetween } from '../domain/dates';
import type { BudgetGoal, BudgetRecurring, BudgetSettings, Cents, Ym } from '../domain/types';
import { POTS } from './catalog';
import type { BudgetData } from './forecast';
import { fundLedger, fundStatus } from './funds';
import { goalProgress } from './goals';
import { formatMoney } from './money';
import { monthTargetsWarning, summariseMonth } from './month';
import { monthLabel, ymOf } from './months';
import { plannedItemsFor } from './planned';
import { effectiveMonth } from './targets';
import type { MonthPlan } from './targets';

/*
 * The personal budget warnings (base §3.8, v2 §3.2), as short lines for this device's Home and the dashboard. Pure.
 *
 *  - Items to confirm: the planned entries of the current month and earlier ones (later months' are not due yet), and
 *    the set-asides the funds ask for this month that are not confirmed.
 *  - A sinking fund due within the reminder days (the assumptions', 30 by default) of the 1st of its due month, or
 *    due already, until its bill is paid.
 *  - A pot, then a category, over its target this month.
 *  - A savings goal behind plan.
 *  - This month's targets not adding up to 100%, once any pot has a target and the month has planned income.
 */

export interface BudgetAlert { key: string; text: string; href: string }


/** What the plan puts towards a goal each month: its category's target and the templates booked to it. */
export function goalPlannedMonthly(goal: BudgetGoal, plan: MonthPlan, recurring: BudgetRecurring[], ym: Ym): Cents {
  if (goal.categoryId === undefined) return 0;
  return (plan.categoryTargets[goal.categoryId]?.amount ?? 0) + recurring
    .filter((t) => !t.deleted && t.categoryId === goal.categoryId && t.startYm <= ym && (t.endYm === undefined || t.endYm >= ym))
    .reduce((sum, t) => sum + t.amount, 0);
}

/** The planned items still to confirm: in months before the current one, and in it; the earliest month with one. */
export function itemsToConfirm(data: BudgetData, ym: Ym): { earlier: number; now: number; firstYm?: Ym } {
  let earlier = 0;
  let now = 0;
  let firstYm: Ym | undefined;
  for (const e of data.budgetEntries) {
    if (e.deleted || e.status !== 'planned') continue;
    const at = ymOf(e.date);
    if (at > ym) continue;
    if (at < ym) earlier += 1;
    else now += 1;
    if (firstYm === undefined || at < firstYm) firstYm = at;
  }
  const { setAsides } = plannedItemsFor(ym, {
    recurring: [], funds: data.budgetFunds.filter((f) => !f.deleted), fundMoves: data.budgetFundMoves, existing: [], debts: [], debtBalances: {},
    corrections: data.budgetCorrections.filter((c) => !c.deleted),
  });
  now += setAsides.length;
  if (setAsides.length > 0 && firstYm === undefined) firstYm = ym;
  return { earlier, now, ...(firstYm !== undefined && { firstYm }) };
}

/** The sinking funds whose bill is due within `days` days of `today` (or already), with the days left (0 or less: due). */
export function fundsDue(data: BudgetData, today: string, days: number): { fundId: string; name: string; dueYm: Ym; amount: Cents; balance: Cents; daysLeft: number }[] {
  const ym = ymOf(today);
  const corrections = data.budgetCorrections.filter((c) => !c.deleted);
  const out = [];
  for (const f of data.budgetFunds) {
    if (f.deleted) continue;
    const repeats = f.repeatMonths !== undefined && f.repeatMonths > 0;
    if (!repeats && fundLedger(f, data.budgetFundMoves, ym, corrections).paidCount > 0) continue;
    const status = fundStatus(f, data.budgetFundMoves, ym, corrections);
    const daysLeft = daysBetween(today, `${status.dueYm}-01`);
    if (daysLeft <= days) out.push({ fundId: f.id, name: f.name, dueYm: status.dueYm, amount: f.amount, balance: status.balance, daysLeft });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft || (a.name < b.name ? -1 : 1));
}

export function budgetAlerts(input: { data: BudgetData; settings: BudgetSettings; today: string }): BudgetAlert[] {
  const { data, settings, today } = input;
  const ym = ymOf(today);
  const out: BudgetAlert[] = [];

  const confirm = itemsToConfirm(data, ym);
  const count = confirm.earlier + confirm.now;
  if (count > 0) {
    out.push({ key: 'confirm', text: `${count} ${count === 1 ? 'item' : 'items'} to confirm${confirm.earlier > 0 ? ` (${confirm.earlier} in earlier months)` : ''}`,
      href: `#/budget/month/${confirm.firstYm ?? ym}` });
  }

  for (const f of fundsDue(data, today, settings.assumptions.fundReminderDays)) {
    out.push({ key: `fund:${f.fundId}`, text: f.daysLeft <= 0 ? `${f.name} is due (${monthLabel(f.dueYm)})` : `${f.name} is due in ${monthLabel(f.dueYm)}`,
      href: '#/budget/plan/funds' });
  }

  const plan = effectiveMonth(data.budgetMonths.filter((m) => !m.deleted), ym);
  const categories = data.budgetCategories.filter((c) => !c.deleted);
  const summary = summariseMonth({
    month: plan, entries: data.budgetEntries, categories, fundMoves: data.budgetFundMoves, funds: data.budgetFunds.filter((f) => !f.deleted),
    corrections: data.budgetCorrections.filter((c) => !c.deleted),
  });
  for (const p of summary.pots) {
    if (p.target > 0 && p.spent > p.target) {
      out.push({ key: `pot:${p.pot}`, text: `${POTS.find((x) => x.id === p.pot)!.label} over target by ${formatMoney(p.spent - p.target)}`, href: `#/budget/month/${ym}` });
    }
  }
  const names = new Map(categories.map((c) => [c.id, c.name]));
  for (const c of summary.categories) {
    if (c.band === 'red') out.push({ key: `cat:${c.categoryId}`, text: `${names.get(c.categoryId)} over target by ${formatMoney(c.spent - c.target!)}`, href: `#/budget/month/${ym}` });
  }

  for (const g of data.budgetGoals) {
    if (g.deleted) continue;
    if (goalProgress(g, data.budgetEntries, ym, goalPlannedMonthly(g, plan, data.budgetRecurring, ym)).behind) {
      out.push({ key: `goal:${g.id}`, text: `${g.name} is behind plan`, href: '#/budget/plan/goals' });
    }
  }

  const warning = monthTargetsWarning(summary, plan);
  if (warning !== undefined) {
    out.push({ key: 'targets', text: warning, href: '#/budget/plan/targets' });
  }
  return out;
}

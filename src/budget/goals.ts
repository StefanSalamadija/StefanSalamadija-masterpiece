import type { BudgetCategory, BudgetEntry, BudgetGoal, Cents, Ym } from '../domain/types';
import { addMonths, monthsBetween, ymOf } from './months';

/*
 * Savings goals and the emergency fund target (base §3.7).
 *
 *  - A goal's saved so far is the actual expenses in its linked category, up to the end of the month (a goal without a
 *    category has saved nothing). Its suggested monthly amount is what is left ÷ the months left, counted from the month
 *    to the target month, both included (as a fund's are), rounded up to the cent so the goal is reached on time. Past
 *    the target month with money missing, the whole remainder is asked for. It is behind when the plan puts less than
 *    that aside each month, or when the target month has passed with money still missing.
 *  - The emergency fund target is N × the average monthly Needs spending of the last 6 tracked months (months before
 *    this one with an actual entry), one-offs left out.
 */

export interface GoalProgress { saved: Cents; remaining: Cents; progressPct: number; monthsLeft: number; suggestedMonthly: Cents; behind: boolean }

/** A goal in `ym`; `plannedMonthly` is what the plan puts towards it each month (its category's target, its templates). */
export function goalProgress(goal: BudgetGoal, entries: BudgetEntry[], ym: Ym, plannedMonthly: Cents): GoalProgress {
  const saved = goal.categoryId === undefined ? 0 : entries
    .filter((e) => !e.deleted && e.kind === 'expense' && e.status === 'actual' && e.categoryId === goal.categoryId && ymOf(e.date) <= ym)
    .reduce((sum, e) => sum + e.amount, 0);
  const remaining = Math.max(0, goal.amount - saved);
  const monthsLeft = Math.max(0, monthsBetween(ym, goal.targetYm) + 1);
  const suggestedMonthly = remaining === 0 ? 0 : monthsLeft === 0 ? remaining : Math.ceil(remaining / monthsLeft);
  const progressPct = goal.amount > 0 ? Math.min(100, Math.floor((saved * 100) / goal.amount)) : 100;
  const behind = remaining > 0 && (monthsLeft === 0 || plannedMonthly < suggestedMonthly);
  return { saved, remaining, progressPct, monthsLeft, suggestedMonthly, behind };
}

/** The average monthly Needs spending of the last `months` tracked months before `ym`; 0 with none. */
export function averageMonthlyNeeds(entries: BudgetEntry[], categories: BudgetCategory[], ym: Ym, months = 6): Cents {
  const needs = new Set(categories.filter((c) => c.pot === 'needs').map((c) => c.id));
  const byMonth = new Map<Ym, Cents>();
  for (const e of entries) {
    if (e.deleted || e.status !== 'actual') continue;
    const m = ymOf(e.date);
    if (m >= ym) continue;
    const add = e.kind === 'expense' && e.oneOff !== true && e.categoryId !== undefined && needs.has(e.categoryId) ? e.amount : 0;
    byMonth.set(m, (byMonth.get(m) ?? 0) + add);
  }
  const tracked = [...byMonth.keys()].sort().slice(-months);
  if (tracked.length === 0) return 0;
  return Math.round(tracked.reduce((sum, m) => sum + byMonth.get(m)!, 0) / tracked.length);
}

/**
 * The emergency fund against its target: the progress, and the month the target is reached at `monthlyContribution`
 * from `ym` on (the month before `ym` when it is reached already; none without a contribution).
 */
export function emergencyOutlook(input: { balance: Cents; target: Cents; monthlyContribution: Cents; ym: Ym }): { progressPct: number; reachedYm?: Ym } {
  const { balance, target, monthlyContribution, ym } = input;
  const progressPct = target > 0 ? Math.max(0, Math.min(100, Math.floor((balance * 100) / target))) : 100;
  if (balance >= target) return { progressPct, reachedYm: addMonths(ym, -1) };
  if (monthlyContribution <= 0) return { progressPct };
  return { progressPct, reachedYm: addMonths(ym, Math.ceil((target - balance) / monthlyContribution) - 1) };
}

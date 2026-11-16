import type { Assumptions, BudgetCategory, BudgetEntry, Cents, Ym } from '../domain/types';
import { ymOf } from './months';

/*
 * The yearly spending the freedom date is worked out from (v2 §3.4): the user's own amount, when the assumptions give
 * one; else the average Needs + Wants spending of the last 12 tracked months, times 12.
 *
 *  - A tracked month is a month before the current one with an actual entry (as for the forecast's average).
 *  - Its spending is its actual expense entries in Needs and Wants categories, one-offs left out (they are not the
 *    life the freedom number pays for). A bill paid from a sinking fund is counted when it is paid; set-asides are
 *    fund records, not entries, so a bill is never counted twice.
 *  - No tracked month: 0 (`months: 0`), and the screens ask for the amount instead of showing a date from nothing.
 */

export interface YearlySpending { amount: Cents; source: 'fixed' | 'average'; months: number }

export function yearlySpending(input: { entries: BudgetEntry[]; categories: BudgetCategory[]; assumptions: Assumptions; currentYm: Ym }): YearlySpending {
  const fixed = input.assumptions.yearlySpendingCents;
  if (fixed !== undefined) return { amount: fixed, source: 'fixed', months: 0 };
  const living = new Set(input.categories.filter((c) => c.pot === 'needs' || c.pot === 'wants').map((c) => c.id));
  const byMonth = new Map<Ym, Cents>();
  for (const e of input.entries) {
    if (e.deleted || e.status !== 'actual') continue;
    const ym = ymOf(e.date);
    if (ym >= input.currentYm) continue;
    const spent = e.kind === 'expense' && e.oneOff !== true && e.categoryId !== undefined && living.has(e.categoryId) ? e.amount : 0;
    byMonth.set(ym, (byMonth.get(ym) ?? 0) + spent);
  }
  const tracked = [...byMonth.keys()].sort().slice(-12);
  if (tracked.length === 0) return { amount: 0, source: 'average', months: 0 };
  const total = tracked.reduce((sum, ym) => sum + byMonth.get(ym)!, 0);
  return { amount: Math.round((total * 12) / tracked.length), source: 'average', months: tracked.length };
}

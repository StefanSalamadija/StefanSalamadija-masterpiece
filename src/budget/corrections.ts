import type { BudgetCorrection, Ym } from '../domain/types';

/*
 * Which correction counts. A correction sets an account's balance at the end of its month. Of several corrections of
 * one account in one month, the last one saved counts (by `updatedAt`, then `createdAt`, then `id`). Deleted ones
 * never count.
 */

/** `a` was saved after `b`. */
export function laterCorrection(a: BudgetCorrection, b: BudgetCorrection): boolean {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt;
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt;
  return a.id > b.id;
}

/** The account's correction that counts in the latest month at or before `ym` that has one. */
export function latestCorrection(corrections: BudgetCorrection[], account: BudgetCorrection['account'], ym: Ym): BudgetCorrection | undefined {
  let best: BudgetCorrection | undefined;
  for (const c of corrections) {
    if (c.deleted || c.account !== account || c.ym > ym) continue;
    if (best === undefined || c.ym > best.ym || (c.ym === best.ym && laterCorrection(c, best))) best = c;
  }
  return best;
}

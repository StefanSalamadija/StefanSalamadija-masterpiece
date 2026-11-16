import type { BudgetAccount, BudgetCorrection, Cents, Ym } from '../domain/types';

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

/**
 * What saving balances for several accounts at the end of `ym` writes (starting balances, a value): for each account, a
 * change to the correction that counts in that month when it holds another balance, else a new correction. An account
 * whose correction already holds the balance is left alone.
 */
export function correctionChanges(existing: BudgetCorrection[], ym: Ym, values: Partial<Record<BudgetAccount, Cents>>):
  { create: { account: BudgetAccount; ym: Ym; balance: Cents }[]; update: { id: string; balance: Cents }[] } {
  const create: { account: BudgetAccount; ym: Ym; balance: Cents }[] = [];
  const update: { id: string; balance: Cents }[] = [];
  for (const [account, balance] of Object.entries(values) as [BudgetAccount, Cents | undefined][]) {
    if (balance === undefined) continue;
    const held = latestCorrection(existing, account, ym);
    if (held && held.ym === ym) {
      if (held.balance !== balance) update.push({ id: held.id, balance });
    } else {
      create.push({ account, ym, balance });
    }
  }
  return { create, update };
}

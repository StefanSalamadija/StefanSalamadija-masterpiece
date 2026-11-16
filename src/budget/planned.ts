import type { BaseRecord, BudgetCorrection, BudgetDebt, BudgetEntry, BudgetFund, BudgetFundMove, BudgetRecurring, Cents, Ym } from '../domain/types';
import { fundStatus } from './funds';
import { ymOf } from './months';

/*
 * The planned items of a month (base §3.5, v2 §3.2): a planned entry, to confirm, for each recurring template due in the
 * month, and the set-aside each sinking fund asks for. Both are confirmed by the user; nothing here is spent.
 *
 * It is idempotent:
 *  - a template that already has an entry in the month is skipped. That includes a deleted one (pass the tombstones in
 *    `existing`), so a planned entry the user removed does not come back;
 *  - a fund that already has a live set-aside in the month is skipped. A set-aside is only a fund record once it is
 *    confirmed, so one that was undone is asked for again.
 */

/** The number of days in a month. */
function daysIn(ym: Ym): number {
  const [year, month] = ym.split('-').map(Number);
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** A template runs in `ym`: from its start month to its end month, and while the debt it pays (if any) is not paid off. */
function runsIn(t: BudgetRecurring, ym: Ym, debts: BudgetDebt[], debtBalances: Record<string, Cents>): boolean {
  if (t.deleted || ym < t.startYm || (t.endYm !== undefined && ym > t.endYm)) return false;
  if (t.untilDebtId === undefined) return true;
  const balance = debtBalances[t.untilDebtId] ?? debts.find((d) => d.id === t.untilDebtId && !d.deleted)?.startBalance;
  // A debt whose balance is not known keeps the template running: it is never stopped by a guess.
  return balance === undefined || balance > 0;
}

export function plannedItemsFor(ym: Ym, input: {
  recurring: BudgetRecurring[]; funds: BudgetFund[]; fundMoves: BudgetFundMove[]; existing: BudgetEntry[]; debts: BudgetDebt[];
  /** Each debt's balance at the start of the month. */
  debtBalances: Record<string, Cents>;
  /** The corrections, so that the funds start from their own (see `fundStatus`). */
  corrections?: BudgetCorrection[];
}): { entries: Omit<BudgetEntry, keyof BaseRecord>[]; setAsides: { fundId: string; amount: Cents }[] } {
  const made = new Set(input.existing.filter((e) => e.recurringId !== undefined && ymOf(e.date) === ym).map((e) => e.recurringId));
  const entries: Omit<BudgetEntry, keyof BaseRecord>[] = [];
  for (const t of input.recurring) {
    if (made.has(t.id) || !runsIn(t, ym, input.debts, input.debtBalances)) continue;
    const day = String(Math.min(Math.max(1, t.day), daysIn(ym))).padStart(2, '0');
    entries.push({
      kind: t.incomeSource !== undefined ? 'income' : 'expense', date: `${ym}-${day}`, amount: t.amount,
      ...(t.categoryId !== undefined && { categoryId: t.categoryId }), ...(t.incomeSource !== undefined && { incomeSource: t.incomeSource }),
      note: t.name, status: 'planned', recurringId: t.id,
    });
  }

  const setAsides: { fundId: string; amount: Cents }[] = [];
  for (const fund of input.funds) {
    if (fund.deleted) continue;
    if (input.fundMoves.some((m) => m.fundId === fund.id && !m.deleted && m.ym === ym && m.kind === 'setaside')) continue;
    const { setAside } = fundStatus(fund, input.fundMoves, ym, input.corrections);
    if (setAside > 0) setAsides.push({ fundId: fund.id, amount: setAside });
  }
  return { entries, setAsides };
}

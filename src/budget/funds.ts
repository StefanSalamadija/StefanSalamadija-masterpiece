import type { BudgetCorrection, BudgetFund, BudgetFundMove, Cents, Ym } from '../domain/types';
import { latestCorrection } from './corrections';
import { addMonths, monthsBetween, ymOf } from './months';

/*
 * Sinking funds (design v2 §3.2 and §3.9.6). A fund's balance is its start balance, plus what was set aside, less the
 * bills paid from it. Its records are taken in month order, and in the order they were made within a month.
 *
 *  - The monthly set-aside is (amount − balance) ÷ the months left, rounded up to the cent so the fund is full on time.
 *    The months left count from the month to the due month, both included. It is worked out from the balance before
 *    the month's own set-asides (those after a bill paid that month), so it stays the same once they are confirmed.
 *  - A fund already at or above its amount needs nothing. An overdue fund asks for the whole remainder at once.
 *  - Paying the bill starts a repeating fund's next cycle (each bill paid moves the due month on by `repeatMonths`,
 *    however early or late it was paid), and what is left over stays in the fund. A one-off fund is done once paid.
 *  - A bill bigger than the fund empties it: the fund gives only what it holds, and the rest is overspend.
 *  - A fund is behind when it is overdue with money still missing, or when last month's set-aside fell short of what
 *    last month asked for (from the month the fund was made).
 *  - A correction of the fund (`fund:<id>`) sets its balance at the end of its month, and the fund runs on from the
 *    latest one at or before the month: its set-aside, "behind" and what a bill takes all use the corrected balance.
 *    The bills paid before it still count towards a repeating fund's cycle. In the corrected month itself, that
 *    month's set-asides are inside the corrected balance, so the set-aside asked for starts from it.
 */

/** A fund's live records up to and including `ym`, in order. */
function movesUpTo(fund: BudgetFund, moves: BudgetFundMove[], ym: Ym): BudgetFundMove[] {
  return moves
    .filter((m) => m.fundId === fund.id && !m.deleted && m.ym <= ym)
    .sort((a, b) => (a.ym !== b.ym ? (a.ym < b.ym ? -1 : 1) : a.createdAt !== b.createdAt ? (a.createdAt < b.createdAt ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Runs through a fund's records up to the end of `ym`: its balance after them, how many bills were paid, what each bill
 * record actually took from the fund (never more than the fund held), and what was set aside in `ym` after its last
 * bill (the set-asides of the cycle that is running).
 */
export function fundLedger(fund: BudgetFund, moves: BudgetFundMove[], ym: Ym, corrections: BudgetCorrection[] = []):
  { balance: Cents; paidCount: number; taken: Map<string, Cents>; setAsideThisCycle: Cents } {
  let balance = fund.startBalance;
  let paidCount = 0;
  let setAsideThisCycle = 0;
  const taken = new Map<string, Cents>();
  let pending = latestCorrection(corrections, `fund:${fund.id}`, ym);
  const applyCorrection = () => {
    balance = pending!.balance;
    if (pending!.ym === ym) setAsideThisCycle = 0;
    pending = undefined;
  };
  for (const m of movesUpTo(fund, moves, ym)) {
    if (pending !== undefined && m.ym > pending.ym) applyCorrection();
    if (m.kind === 'setaside') {
      balance += m.amount;
      if (m.ym === ym) setAsideThisCycle += m.amount;
    } else {
      const take = Math.max(0, Math.min(m.amount, balance));
      taken.set(m.id, take);
      balance -= take;
      paidCount += 1;
      if (m.ym === ym) setAsideThisCycle = 0;
    }
  }
  if (pending !== undefined) applyCorrection();
  return { balance, paidCount, taken, setAsideThisCycle };
}

interface Need { balance: Cents; dueYm: Ym; monthsLeft: number; setAside: Cents; overdue: boolean; done: boolean }

/** What the fund asks for in `ym`, from its balance before that month's set-asides. */
function need(fund: BudgetFund, moves: BudgetFundMove[], ym: Ym, corrections: BudgetCorrection[]): Need {
  const ledger = fundLedger(fund, moves, ym, corrections);
  const before = { balance: ledger.balance - ledger.setAsideThisCycle, paidCount: ledger.paidCount };
  const repeats = fund.repeatMonths !== undefined && fund.repeatMonths > 0;
  const done = !repeats && before.paidCount > 0;
  const dueYm = repeats ? addMonths(fund.dueYm, fund.repeatMonths! * before.paidCount) : fund.dueYm;
  const left = monthsBetween(ym, dueYm) + 1;
  const missing = Math.max(0, fund.amount - before.balance);
  const overdue = left <= 0;
  const setAside = done || missing === 0 ? 0 : overdue ? missing : Math.ceil(missing / left);
  return { balance: before.balance, dueYm, monthsLeft: Math.max(0, left), setAside, overdue: overdue && !done && missing > 0, done };
}

/** Set aside in a month. */
function setAsideIn(fund: BudgetFund, moves: BudgetFundMove[], ym: Ym): Cents {
  return moves.filter((m) => m.fundId === fund.id && !m.deleted && m.ym === ym && m.kind === 'setaside').reduce((sum, m) => sum + m.amount, 0);
}

/**
 * A fund in a month: its balance at the end of the month, the month its bill is due (this cycle's, for a repeating
 * fund), the months left (the due month included; 0 when overdue), the set-aside it asks for this month, and whether
 * it is behind plan.
 */
export function fundStatus(fund: BudgetFund, moves: BudgetFundMove[], ym: Ym, corrections: BudgetCorrection[] = []):
  { balance: Cents; dueYm: Ym; monthsLeft: number; setAside: Cents; behind: boolean } {
  const now = need(fund, moves, ym, corrections);
  const balance = fundLedger(fund, moves, ym, corrections).balance;
  let behind = now.overdue;
  if (!behind && !now.done && now.setAside > 0) {
    const last = addMonths(ym, -1);
    const made = fund.createdAt ? ymOf(fund.createdAt) : undefined;
    if (made === undefined || last >= made) behind = setAsideIn(fund, moves, last) < need(fund, moves, last, corrections).setAside;
  }
  return { balance, dueYm: now.dueYm, monthsLeft: now.monthsLeft, setAside: now.setAside, behind };
}

/**
 * Paying a bill of `bill` from the fund in `ym`: what the fund gives (the amount of the `paid` record to write) and the
 * rest, which is overspend in the month.
 */
export function fundPayment(fund: BudgetFund, moves: BudgetFundMove[], ym: Ym, bill: Cents, corrections: BudgetCorrection[] = []):
  { fromFund: Cents; overspend: Cents } {
  const fromFund = Math.max(0, Math.min(bill, fundLedger(fund, moves, ym, corrections).balance));
  return { fromFund, overspend: bill - fromFund };
}

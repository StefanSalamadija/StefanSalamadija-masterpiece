import type { BudgetAsset, Cents, Ym } from '../domain/types';
import type { Account } from './ledger';
import type { MonthSummary } from './month';

/*
 * Net worth and the savings rate (v2 §3.4, §3.9.7).
 *
 *  - Net worth = bank + investments + emergency fund + the assets included in it − debts. Sinking-fund money is inside
 *    the bank, so it is counted once (the `fund:` balances are not parts). The parts are signed: a debt is negative,
 *    so the net worth is always the sum of its parts.
 *  - Savings rate = (income − spending on Needs and Wants) ÷ income, from the actual income. Debt repayment and
 *    investing count as saving. A month (or a span) with no income has no rate.
 */

export function netWorthSeries(balances: Map<Ym, Record<Account, Cents>>, assets: BudgetAsset[]):
  { ym: Ym; netWorth: Cents; parts: Record<string, Cents> }[] {
  const included = new Set(assets.filter((a) => !a.deleted && a.includeInNetWorth).map((a) => `asset:${a.id}`));
  return [...balances].map(([ym, record]) => {
    const parts: Record<string, Cents> = {};
    for (const [account, balance] of Object.entries(record)) {
      if (account === 'bank' || account === 'investments' || account === 'emergency' || included.has(account)) parts[account] = balance;
      else if (account.startsWith('debt:')) parts[account] = -balance;
    }
    return { ym, netWorth: Object.values(parts).reduce((sum, v) => sum + v, 0), parts };
  });
}

const spending = (s: MonthSummary) => s.pots.reduce((sum, p) => (p.pot === 'needs' || p.pot === 'wants' ? sum + p.spent : sum), 0);

/** Each month's savings rate, as a fraction (0.25 is 25%); null in a month with no income. */
export function savingsRate(summaries: MonthSummary[]): { ym: Ym; rate: number | null }[] {
  return summaries.map((s) => ({ ym: s.ym, rate: s.actualIncome > 0 ? (s.actualIncome - spending(s)) / s.actualIncome : null }));
}

/** The savings rate over several months (the last 12, say): their total saving ÷ their total income; null with none. */
export function savingsRateOver(summaries: MonthSummary[]): number | null {
  const income = summaries.reduce((sum, s) => sum + s.actualIncome, 0);
  return income > 0 ? (income - summaries.reduce((sum, s) => sum + spending(s), 0)) / income : null;
}

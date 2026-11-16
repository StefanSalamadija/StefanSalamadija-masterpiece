import type { Cents, Ym } from '../domain/types';
import { formatMoney } from './money';
import { addMonths, monthLabel, monthsBetween } from './months';

/*
 * Paying off a debt (base §3.7, v2 §3.9.2).
 *
 *  - The monthly rate is the yearly rate ÷ 12. Each month's interest is worked out on the balance at the start of the
 *    month and rounded to the cent (half up).
 *  - The instalment includes the interest, so only the principal (payment − interest) lowers the debt. With no rate,
 *    the whole payment lowers it. An extra payment is all principal.
 *  - The last payment is only what is left (balance + that month's interest).
 *  - Total interest is the sum of the monthly interest.
 */

/** A month's interest on `balance` at `yearlyRatePct`, rounded to the cent. None on a balance of zero or below. */
export function monthlyInterest(balance: Cents, yearlyRatePct: number): Cents {
  if (balance <= 0 || yearlyRatePct <= 0) return 0;
  return Math.round((balance * yearlyRatePct) / 1200);
}

/**
 * The debt's payoff, month by month from `fromYm`, for at most `maxMonths` months. `debtFreeYm` is the month of the last
 * payment; a debt that is already paid off was debt-free the month before `fromYm`. When the payments never pay the debt
 * off within `maxMonths` (they don't cover the interest, say), there is no `debtFreeYm`.
 */
export function amortise(
  debt: { balance: Cents; yearlyRatePct: number; instalment: Cents; extra?: (ym: Ym) => Cents },
  fromYm: Ym,
  maxMonths = 720,
): { months: { ym: Ym; interest: Cents; principal: Cents; balance: Cents }[]; debtFreeYm?: Ym; totalInterest: Cents } {
  const months: { ym: Ym; interest: Cents; principal: Cents; balance: Cents }[] = [];
  let balance = debt.balance;
  let totalInterest = 0;
  if (balance <= 0) return { months, debtFreeYm: addMonths(fromYm, -1), totalInterest };
  for (let i = 0; i < maxMonths; i += 1) {
    const ym = addMonths(fromYm, i);
    const interest = monthlyInterest(balance, debt.yearlyRatePct);
    const payment = Math.min(debt.instalment + (debt.extra?.(ym) ?? 0), balance + interest);
    const principal = payment - interest;
    balance -= principal;
    totalInterest += interest;
    months.push({ ym, interest, principal, balance });
    if (balance <= 0) return { months, debtFreeYm: ym, totalInterest };
  }
  return { months, totalInterest };
}

/** "With an extra €X/month you'd be debt-free in <month> (<n> months sooner)"; none when the extra never pays it off. */
export function extraDebtLine(extra: Cents, debtFreeYm: Ym | undefined, withExtraYm: Ym | undefined): string | undefined {
  if (withExtraYm === undefined) return undefined;
  const line = `With an extra ${formatMoney(extra)}/month you'd be debt-free in ${monthLabel(withExtraYm)}`;
  if (debtFreeYm === undefined) return line;
  const sooner = monthsBetween(withExtraYm, debtFreeYm);
  return sooner > 0 ? `${line} (${sooner} ${sooner === 1 ? 'month' : 'months'} sooner)` : line;
}

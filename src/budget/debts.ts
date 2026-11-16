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

/** A step of a debt's planned extra: `monthly` from `fromYm` on, until the next step. */
export type ExtraStep = { fromYm: Ym; monthly: Cents };

/** The planned extra in `ym`: the latest step at or before it; nothing before the first step. */
export function extraFor(steps: readonly ExtraStep[] | undefined, ym: Ym): Cents {
  let best: ExtraStep | undefined;
  for (const s of steps ?? []) if (s.fromYm <= ym && (best === undefined || s.fromYm >= best.fromYm)) best = s;
  return best?.monthly ?? 0;
}

/**
 * The steps with `monthly` more from `fromYm` on: a step at `fromYm` of what was paid then plus `monthly`, and every
 * later step raised by it. The steps before `fromYm` stay as they are, so no extra already planned starts earlier.
 */
export function addExtra(steps: readonly ExtraStep[] | undefined, fromYm: Ym, monthly: Cents): ExtraStep[] {
  const held = [...(steps ?? [])].sort((a, b) => (a.fromYm < b.fromYm ? -1 : a.fromYm > b.fromYm ? 1 : 0));
  const before = held.filter((s) => s.fromYm < fromYm);
  const later = held.filter((s) => s.fromYm > fromYm).map((s) => ({ fromYm: s.fromYm, monthly: s.monthly + monthly }));
  return [...before, { fromYm, monthly: extraFor(held, fromYm) + monthly }, ...later];
}

/**
 * The steps with `monthly` less from `fromYm` on (never below 0): what `addExtra` added, taken back. Steps that then
 * plan the same as the step before them (or 0 before any) are dropped, so adding and taking back give the steps again.
 */
export function removeExtra(steps: readonly ExtraStep[] | undefined, fromYm: Ym, monthly: Cents): ExtraStep[] {
  const held = [...(steps ?? [])].sort((a, b) => (a.fromYm < b.fromYm ? -1 : a.fromYm > b.fromYm ? 1 : 0));
  const before = held.filter((s) => s.fromYm < fromYm);
  const later = held.filter((s) => s.fromYm > fromYm).map((s) => ({ fromYm: s.fromYm, monthly: Math.max(0, s.monthly - monthly) }));
  return tidySteps([...before, { fromYm, monthly: Math.max(0, extraFor(held, fromYm) - monthly) }, ...later]);
}

/** The steps in month order without the ones that change nothing (the same as the step before, or 0 before any). */
export function tidySteps(steps: readonly ExtraStep[]): ExtraStep[] {
  const out: ExtraStep[] = [];
  for (const s of [...steps].sort((a, b) => (a.fromYm < b.fromYm ? -1 : a.fromYm > b.fromYm ? 1 : 0))) {
    const last = out[out.length - 1];
    if (last ? last.monthly === s.monthly : s.monthly === 0) continue;
    if (last && last.fromYm === s.fromYm) out[out.length - 1] = s;
    else out.push(s);
  }
  return out;
}

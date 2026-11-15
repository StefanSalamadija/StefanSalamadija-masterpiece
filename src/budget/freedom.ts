import type { Assumptions, Cents, Ym } from '../domain/types';
import type { ForecastResult } from './forecast';
import { addMonths, monthsBetween, ymOf } from './months';

/*
 * The freedom date (v2 §3.4, §3.9.8): the first month the investments reach the freedom number.
 *
 *  - It uses investments only: they start at the forecast's `startInvestments` (the end of last month).
 *  - Each month they grow by (1 + r)^(1/12), r the expected yearly return, rounded to the cent, and the month's planned
 *    contribution is added: the forecast's (templates and pot targets), not escalated. Past the forecast's horizon
 *    each month adds the average contribution of its last 12 months (or of all of them, when fewer), rounded.
 *  - The freedom number = yearly spending ÷ the withdrawal rate. Yearly spending grows with inflation, i a year, so in
 *    month t (0 = the current month) the number is yearly spending × (1 + i)^(t/12) ÷ the rate, rounded to the cent.
 *    `number` is today's; `numberAt` is the one at the freedom month.
 *  - The 60 years (720 months) count from today: a date after the current month + 720 is "not within 60 years", and
 *    there is no `ym`.
 *  - Today's euros: value ÷ (1 + i)^(years from the current month), rounded to the cent.
 *  - Nothing is guessed: without an expected return or inflation (0% is allowed, an empty one is not), or with no
 *    withdrawal rate above 0, the result is `needsAssumptions`, naming what is missing. Without the forecast's bank
 *    start there are no contributions to project: `needsBankStart`.
 */

export const FREEDOM_MAX_MONTHS = 720;

export type FreedomResult =
  | { status: 'needsAssumptions'; missing: ('yearlyReturnPct' | 'inflationPct' | 'withdrawalRatePct')[] }
  | { status: 'needsBankStart' }
  | {
    status: 'ok';
    /** The freedom number today. */
    number: Cents;
    /** The freedom month, and how far it is from the current month; none when not within 60 years. */
    ym?: Ym; years?: number; months?: number;
    /** The (nominal) freedom number in the freedom month. */
    numberAt?: Cents;
    /** An amount of month `ym` in today's euros. */
    todayEuros: (c: Cents, ym: Ym) => Cents;
  };

export function freedom(input: { forecast: ForecastResult; yearlySpending: Cents; assumptions: Assumptions; today: string }): FreedomResult {
  const { forecast, assumptions } = input;
  const missing: ('yearlyReturnPct' | 'inflationPct' | 'withdrawalRatePct')[] = [];
  const r = assumptions.yearlyReturnPct;
  const i = assumptions.inflationPct;
  const wr = assumptions.withdrawalRatePct;
  if (r === undefined || !Number.isFinite(r)) missing.push('yearlyReturnPct');
  if (i === undefined || !Number.isFinite(i)) missing.push('inflationPct');
  if (!(Number.isFinite(wr) && wr > 0)) missing.push('withdrawalRatePct');
  if (missing.length > 0) return { status: 'needsAssumptions', missing };
  if (forecast.needsBankStart) return { status: 'needsBankStart' };

  const cur = ymOf(input.today);
  const inflation = 1 + i! / 100;
  const growth = (1 + r! / 100) ** (1 / 12);
  const numberIn = (t: number) => Math.round((input.yearlySpending * inflation ** (t / 12) * 100) / wr);
  const todayEuros = (c: Cents, ym: Ym) => Math.round(c / inflation ** (monthsBetween(cur, ym) / 12));

  // The forecast's contributions by month from the current month; then their recent average.
  const contributions = new Map(forecast.months.map((m) => [m.ym, m.contribution]));
  const recent = forecast.months.slice(-12);
  const later = recent.length > 0 ? Math.round(recent.reduce((s, m) => s + m.contribution, 0) / recent.length) : 0;
  const lastYm = forecast.months.length > 0 ? forecast.months[forecast.months.length - 1].ym : undefined;

  let balance = forecast.startInvestments;
  for (let t = 0; t <= FREEDOM_MAX_MONTHS; t += 1) {
    const ym = addMonths(cur, t);
    balance = Math.round(balance * growth) + (contributions.get(ym) ?? (lastYm !== undefined && ym > lastYm ? later : 0));
    const target = numberIn(t);
    if (balance >= target) return { status: 'ok', number: numberIn(0), ym, years: Math.floor(t / 12), months: t % 12, numberAt: target, todayEuros };
  }
  return { status: 'ok', number: numberIn(0), todayEuros };
}

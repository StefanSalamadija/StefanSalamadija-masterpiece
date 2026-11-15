import type { Cents, RotationSettings, Ym } from '../domain/types';
import { addMonths } from './months';

/*
 * The rotation and its pay rule (v2 §3.3, §3.9.4).
 *
 *  - A day is onboard when it falls between a period's sign-on and sign-off, both included. The dates are ship's-time
 *    calendar dates (`YYYY-MM-DD`), counted as plain calendar days: no time zone enters.
 *  - The schedule is the entered periods, then the pattern (`patternOn` months on, `patternOff` months off) repeated
 *    after the latest sign-off: home leave starts the day after it and lasts `patternOff` months, the next contract
 *    starts on the day home leave ends and lasts `patternOn` months, and so on. Each generated date is worked out from
 *    that one anchor day (its day of the month clamped to the month's length), so the pattern never drifts. Without an
 *    entered period there is nothing to repeat, so nothing is made up.
 *  - Salary earned in a calendar month = monthly salary × (days onboard + paid-at-home % × days at home) ÷ days in the
 *    month, rounded once to the cent. The monthly salary is the one in force from its month on.
 *  - It lands in the bank in the same month, or in the next one with `paidNextMonth` (`salaryPaidIn`). Actual salary
 *    entries replacing the rule is the forecast's business (see `forecast.ts`).
 */

export type Period = { signOn: string; signOff: string };
export type MonthStatus = 'onboard' | 'home' | 'mixed';

const DAY_MS = 86_400_000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The number of days in a month. */
export function daysInMonth(ym: Ym): number {
  const [year, month] = ym.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** A date as a count of days, so that days can be counted and added. */
function dayNumber(date: string): number {
  const match = DATE.exec(date);
  if (!match) throw new Error(`Not a date (YYYY-MM-DD): ${date}`);
  return Math.round(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS);
}

function fromDayNumber(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/** The date `n` months after `date`, its day clamped to the length of that month (31 Jan + 1 month = 28 or 29 Feb). */
function addMonthsToDate(date: string, n: number): string {
  const ym = addMonths(date.slice(0, 7), n);
  const day = Math.min(Number(date.slice(8, 10)), daysInMonth(ym));
  return `${ym}-${String(day).padStart(2, '0')}`;
}

/** The entered periods (those whose sign-off is not before their sign-on), then the pattern up to the end of `untilYm`. */
export function rotationPeriods(rot: RotationSettings, untilYm: Ym): Period[] {
  const entered = rot.periods
    .filter((p) => DATE.test(p.signOn) && DATE.test(p.signOff) && p.signOff >= p.signOn)
    .map((p) => ({ signOn: p.signOn, signOff: p.signOff }))
    .sort((a, b) => (a.signOn < b.signOn ? -1 : a.signOn > b.signOn ? 1 : a.signOff < b.signOff ? -1 : a.signOff > b.signOff ? 1 : 0));
  if (entered.length === 0) return entered;
  const on = Math.floor(rot.patternOn);
  const off = Math.max(0, Math.floor(rot.patternOff));
  if (!(on > 0)) return entered;

  const lastSignOff = entered.reduce((latest, p) => (p.signOff > latest ? p.signOff : latest), entered[0].signOff);
  const homeFrom = fromDayNumber(dayNumber(lastSignOff) + 1);
  const end = `${untilYm}-${String(daysInMonth(untilYm)).padStart(2, '0')}`;
  const out = [...entered];
  for (let k = 0; ; k += 1) {
    const signOn = addMonthsToDate(homeFrom, off + k * (on + off));
    if (signOn > end) break;
    const signOff = fromDayNumber(dayNumber(addMonthsToDate(homeFrom, off + k * (on + off) + on)) - 1);
    out.push({ signOn, signOff });
  }
  return out;
}

/** The days of `ym` onboard in any of the periods, each day counted once. */
export function onboardDaysIn(periods: Period[], ym: Ym): number {
  const first = dayNumber(`${ym}-01`);
  const last = first + daysInMonth(ym) - 1;
  const spans = periods
    .map((p) => [Math.max(first, dayNumber(p.signOn)), Math.min(last, dayNumber(p.signOff))] as const)
    .filter(([a, b]) => a <= b)
    .sort((x, y) => x[0] - y[0]);
  let days = 0;
  let upTo = first - 1;
  for (const [a, b] of spans) {
    const from = Math.max(a, upTo + 1);
    if (b >= from) days += b - from + 1;
    upTo = Math.max(upTo, b);
  }
  return days;
}

/** The monthly salary in force in `ym`: the one from the latest month at or before it, else none. */
export function monthlySalary(rot: RotationSettings, ym: Ym): Cents {
  let best: { ym: Ym; amount: Cents } | undefined;
  for (const s of rot.salaryFrom) if (s.ym <= ym && (best === undefined || s.ym >= best.ym)) best = s;
  return best?.amount ?? 0;
}

/** The pay for a month from its onboard days (see the file comment): the periods are worked out once by the caller. */
export function salaryFromPeriods(rot: RotationSettings, periods: Period[], ym: Ym):
  { onboardDays: number; daysInMonth: number; amount: Cents; onboard: MonthStatus } {
  const days = daysInMonth(ym);
  const onboardDays = onboardDaysIn(periods, ym);
  const home = days - onboardDays;
  const monthly = monthlySalary(rot, ym);
  const homePct = Math.max(0, rot.paidAtHomePct || 0);
  const amount = Math.round((monthly * (onboardDays * 100 + homePct * home)) / (100 * days));
  return { onboardDays, daysInMonth: days, amount, onboard: onboardDays === 0 ? 'home' : onboardDays === days ? 'onboard' : 'mixed' };
}

/** The salary earned in the calendar month `ym`, by the pay rule, and whether the month is onboard, home or mixed. */
export function salaryForMonth(rot: RotationSettings, ym: Ym): { onboardDays: number; daysInMonth: number; amount: Cents; onboard: MonthStatus } {
  return salaryFromPeriods(rot, rotationPeriods(rot, ym), ym);
}

/** The salary (by the rule) that lands in the bank in `ym`: that month's, or the month before's when paid next month. */
export function salaryPaidIn(rot: RotationSettings, ym: Ym): Cents {
  return salaryForMonth(rot, rot.paidNextMonth ? addMonths(ym, -1) : ym).amount;
}

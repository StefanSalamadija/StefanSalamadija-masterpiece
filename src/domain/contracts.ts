import { addDays, addMonths, isValidIsoDate } from './dates';
import { expiryBand } from './expiry';
import type { Band, CrewMember, ShipProfile } from './types';

/** The most a seafarer may stay onboard under the Maritime Labour Convention; a ship can set a shorter limit. */
export const DEFAULT_MAX_MONTHS_ONBOARD = 11;

/** The ship's limit on the months a crew member stays onboard: its own when it has set one, else the default. */
export function maxMonthsOnboardOf(ship: Pick<ShipProfile, 'maxMonthsOnboard'>): number {
  return ship.maxMonthsOnboard ?? DEFAULT_MAX_MONTHS_ONBOARD;
}

/** A contract is amber from this many days before it ends. */
const CONTRACT_WARNING_DAYS = 30;
/** The onboard limit is amber from this many days before it is reached. */
const LIMIT_WARNING_DAYS = 30;

type Contract = Pick<CrewMember, 'signOnDate' | 'contractMonths'>;

/**
 * The day the contract ends: the sign-on date plus its length in months. Undefined when it has no length, or when the
 * length is not a whole number of months above zero or the sign-on is not a date (records from a file may be damaged).
 */
export function contractEndDate(m: Contract): string | undefined {
  const months = m.contractMonths;
  if (typeof months !== 'number' || !Number.isInteger(months) || months <= 0 || !isValidIsoDate(m.signOnDate)) return undefined;
  return addMonths(m.signOnDate, months);
}

/** The whole days from `from` to `to` (both real `YYYY-MM-DD` dates); negative when `to` is earlier. */
function daysBetween(from: string, to: string): number {
  const dayNumber = (date: string): number => {
    const [y, m, d] = date.split('-').map(Number);
    const t = new Date(0);
    t.setUTCFullYear(y, m - 1, d);
    return t.getTime() / 86_400_000;
  };
  return dayNumber(to) - dayNumber(from);
}

/**
 * How many days the contract has run at `asAt`, with the sign-on day as the first. It stops at the sign-off date, and is
 * 0 before the sign-on. 0 as well when a date is not a date, so that a screen never shows a made-up number.
 */
export function daysOnboard(m: Pick<CrewMember, 'signOnDate' | 'signOffDate'>, asAt: string): number {
  if (!isValidIsoDate(m.signOnDate) || !isValidIsoDate(asAt) || asAt < m.signOnDate) return 0;
  const end = m.signOffDate && isValidIsoDate(m.signOffDate) && m.signOffDate < asAt ? m.signOffDate : asAt;
  return daysBetween(m.signOnDate, end) + 1;
}

/** Red once the contract has ended, amber from 30 days before its last day (that day included), none without a length. */
export function contractBand(m: Contract, ref: string): Band {
  return expiryBand(contractEndDate(m), ref, { days: CONTRACT_WARNING_DAYS });
}

/** The day the crew member has been onboard for `maxMonths`: the sign-on date plus those months. */
export function onboardLimitDate(m: Pick<CrewMember, 'signOnDate'>, maxMonths: number): string {
  return addMonths(m.signOnDate, maxMonths);
}

/** Red from the day the limit is reached, amber from 30 days before, none when the sign-on is not a date. */
export function onboardLimitBand(m: Pick<CrewMember, 'signOnDate'>, ref: string, maxMonths = DEFAULT_MAX_MONTHS_ONBOARD): Band {
  if (!isValidIsoDate(m.signOnDate)) return 'none';
  const limit = onboardLimitDate(m, maxMonths);
  if (ref >= limit) return 'red';
  return ref >= addDays(limit, -LIMIT_WARNING_DAYS) ? 'amber' : 'ok';
}

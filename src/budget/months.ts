import type { Ym } from '../domain/types';

export type { Ym };

const YM = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE_START = /^(\d{4}-(?:0[1-9]|1[0-2]))-\d{2}/;

/** The month as a count of months since year 0, so that months can be added and subtracted. */
function index(ym: Ym): number {
  const match = YM.exec(ym);
  if (!match) throw new Error(`Not a month (YYYY-MM): ${ym}`);
  return Number(match[1]) * 12 + Number(match[2]) - 1;
}

function fromIndex(i: number): Ym {
  return `${String(Math.floor(i / 12)).padStart(4, '0')}-${String((i % 12) + 1).padStart(2, '0')}`;
}

/** The month `n` months after `ym` (before it, for a negative `n`). */
export function addMonths(ym: Ym, n: number): Ym {
  return fromIndex(index(ym) + n);
}

/** How many months `b` is after `a`: 3 from `2026-11` to `2027-02`, negative when `b` is earlier. */
export function monthsBetween(a: Ym, b: Ym): number {
  return index(b) - index(a);
}

/** The month of a `YYYY-MM-DD` date (or of a local date-time that starts with one). */
export function ymOf(date: string): Ym {
  const match = DATE_START.exec(date);
  if (!match) throw new Error(`Not a date (YYYY-MM-DD): ${date}`);
  return match[1];
}

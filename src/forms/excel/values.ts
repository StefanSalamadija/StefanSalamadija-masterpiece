import { isValidIsoDate } from '../../domain/dates';
import { parseDecimal } from '../../domain/numbers';
import type { FieldDef, FormValue } from '../types';
import { xmlText } from '../xml';

/*
 * Draft values (R2) as Excel holds them, both ways: dates as serials, times as fractions of a day, numbers as the
 * canonical JavaScript number text. Shared by the writer and the reader, so that what one writes the other reads.
 */

const DAY_MS = 86_400_000;
/** Day 0 of each date system, in days since 1970: 31 December 1899 (serial 1 is 1 January 1900) and 1 January 1904. */
const EPOCH_1900 = Date.UTC(1899, 11, 31) / DAY_MS;
const EPOCH_1904 = Date.UTC(1904, 0, 1) / DAY_MS;
/** Excel's 1900 system counts a 29 February 1900 that never was, as serial 60; every later date is one more. */
const FAKE_LEAP_DAY = 60;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * The serial of an ISO date in the workbook's date system (`date1904`), or `undefined` when the date is not valid or is
 * before the system's first day (1 January 1900, or 1 January 1904, which is serial 0). In the 1900 system serials from
 * 60 up are one more than the days counted, as Excel has them (it takes 1900 for a leap year).
 */
export function isoToSerial(iso: string, date1904: boolean): number | undefined {
  if (!isValidIsoDate(iso)) return undefined;
  const at = new Date(0);
  at.setUTCFullYear(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))); // Date.UTC would read year 50 as 1950
  const days = at.getTime() / DAY_MS;
  if (date1904) {
    const serial = days - EPOCH_1904;
    return serial >= 0 ? serial : undefined;
  }
  const serial = days - EPOCH_1900;
  if (serial < 1) return undefined;
  return serial >= FAKE_LEAP_DAY ? serial + 1 : serial;
}

/**
 * The ISO date of a serial (its whole days; a time of day in it is dropped), or `undefined` for a serial that is no
 * date: negative, 0 in the 1900 system, the 1900 system's 60 (29 February 1900), or past 9999.
 */
export function serialToIso(serial: number, date1904: boolean): string | undefined {
  if (!Number.isFinite(serial) || serial < 0) return undefined;
  let whole = Math.floor(serial);
  if (!date1904) {
    if (whole < 1 || whole === FAKE_LEAP_DAY) return undefined;
    if (whole > FAKE_LEAP_DAY) whole -= 1;
  }
  const date = new Date(((date1904 ? EPOCH_1904 : EPOCH_1900) + whole) * DAY_MS);
  const year = date.getUTCFullYear();
  if (year > 9999) return undefined;
  return `${String(year).padStart(4, '0')}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

const TIME = /^(\d{1,2}):(\d{2})$/;

/** `HH:mm` (or `H:mm`) as minutes after midnight, or `undefined` when it is not a time of day. */
export function minutesOf(time: string): number | undefined {
  const match = TIME.exec(time.trim());
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : undefined;
}

/** Minutes after midnight as `HH:mm`. */
export function timeText(minutes: number): string {
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

/** A time of day as Excel holds it: the fraction of a day, `h/24 + m/1440` (R15). */
export function timeToFraction(minutes: number): number {
  return minutes / 1440;
}

/** The time of day of a serial, as `HH:mm`, to the nearest minute (its whole days are dropped). */
export function fractionToTime(serial: number): string | undefined {
  if (!Number.isFinite(serial) || serial < 0) return undefined;
  return timeText(Math.round((serial - Math.floor(serial)) * 1440) % 1440);
}

/** A number as typed (`2,5` or `2.5`, a sign allowed) as the number Excel holds, or `undefined` when it is none. */
export function numberOf(text: string): number | undefined {
  const value = parseDecimal(text, { signed: true });
  return typeof value === 'number' ? value : undefined;
}

/**
 * What `readExcelValues` gives back for a field after `writeExcel` wrote `value` into it: the value the integrity check
 * (Task 9) compares the read-back with. `null` for a blank value (`null`, `''`), which is not written.
 * - `number`: the canonical number text (`2,5` → `2.5`, `007` → `7`), or the text as written when it is no number;
 * - `date`: the ISO date when it is one (written as a serial, or as `formatDate` text that reads back as the date);
 * - `time`: `HH:mm`, zero-padded, when it is a time of day;
 * - `checkbox`: the boolean;
 * - anything else: `xmlText(value)`, the text with `\r\n` as `\n` and without the characters XML cannot hold.
 *
 * Known limit: a date written as text with a hint `parseDate` cannot read back (no day, month or year in it, or a
 * 2-digit year before 2000) reads back as that text, not as the ISO date.
 */
export function canonicalExcelValue(field: FieldDef, value: FormValue): FormValue {
  if (value === null || value === '') return null;
  if (typeof value === 'boolean') return value;
  switch (field.kind) {
    case 'number': {
      const n = numberOf(value);
      return n === undefined ? xmlText(value) : String(n);
    }
    case 'date':
      return isValidIsoDate(value) ? value : xmlText(value);
    case 'time': {
      const minutes = minutesOf(value);
      return minutes === undefined ? xmlText(value) : timeText(minutes);
    }
    default:
      return xmlText(value);
  }
}

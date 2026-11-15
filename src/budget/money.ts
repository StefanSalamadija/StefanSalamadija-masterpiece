/*
 * Money is kept as whole euro cents (`Cents`, always an integer), never as a float. These read what a person types and
 * show an amount the way the budget shows every amount: `€1,234.56`.
 */

import type { Cents } from '../domain/types';

export type { Cents };

const MINUS = '−';
const DIGITS = /^\d+$/;
/** Groups of digits split by a thousands separator: 1 to 3 digits, then groups of exactly 3, the first not a lone 0. */
const GROUPED = /^[1-9]\d{0,2}$/;

/** The whole euros of `text`, in which `separator` (if any) separates thousands. Undefined when the groups are wrong. */
function wholeEuros(text: string, separator: string | undefined): number | undefined {
  if (separator === undefined || !text.includes(separator)) return DIGITS.test(text) ? Number(text) : undefined;
  const [first, ...rest] = text.split(separator);
  if (!GROUPED.test(first) || !rest.every((group) => /^\d{3}$/.test(group))) return undefined;
  return Number(first + rest.join(''));
}

/**
 * Reads an amount as typed: `1234,56`, `1.234,56`, `1234.56`, `1,234.56`, `12,5`, `€12`, `12 €`. An empty field gives
 * `undefined`; anything else that is not an amount gives `'invalid'`. A minus (`-` or `−`) is refused unless
 * `opts.negative` allows it.
 *
 * Which separator is the decimal one:
 *  - when both `.` and `,` appear, the last one is the decimal separator, and the other one separates thousands;
 *  - when only one kind appears, once, followed by 1 or 2 digits, it is the decimal separator (`12,5`, `0.05`);
 *  - when only one kind appears, followed by exactly 3 digits with 1 to 3 digits before it (`1.234`), or more than
 *    once in groups of 3 (`1.234.567`), it separates thousands: `1.234` is €1,234.00, never €1.234;
 *  - anything else (`1.2.3`, `1.2345`, `12,`) is invalid.
 * The decimal part has 1 or 2 digits: cents are the smallest amount.
 */
export function parseMoney(text: string, opts: { negative?: boolean } = {}): Cents | undefined | 'invalid' {
  let rest = text.trim();
  if (rest === '') return undefined;
  let negative = false;
  if (rest.startsWith('-') || rest.startsWith(MINUS)) {
    negative = true;
    rest = rest.slice(1).trim();
  }
  rest = rest.replace(/^€\s*/, '').replace(/\s*€$/, '');
  if (!/^[\d.,]+$/.test(rest)) return 'invalid';
  if (negative && opts.negative !== true) return 'invalid';

  const lastDot = rest.lastIndexOf('.');
  const lastComma = rest.lastIndexOf(',');
  let euros: number | undefined;
  let fraction = '';
  if (lastDot >= 0 && lastComma >= 0) {
    const decimalAt = Math.max(lastDot, lastComma);
    const thousands = decimalAt === lastDot ? ',' : '.';
    fraction = rest.slice(decimalAt + 1);
    if (!/^\d{1,2}$/.test(fraction)) return 'invalid';
    euros = wholeEuros(rest.slice(0, decimalAt), thousands);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const separator = lastDot >= 0 ? '.' : ',';
    const parts = rest.split(separator);
    if (parts.length === 2 && /^\d{1,2}$/.test(parts[1]) && DIGITS.test(parts[0])) {
      euros = Number(parts[0]);
      fraction = parts[1];
    } else {
      euros = wholeEuros(rest, separator);
    }
  } else {
    euros = wholeEuros(rest, undefined);
  }
  if (euros === undefined) return 'invalid';
  const cents = euros * 100 + (fraction === '' ? 0 : Number(fraction.padEnd(2, '0')));
  if (!Number.isSafeInteger(cents)) return 'invalid';
  return negative && cents !== 0 ? -cents : cents;
}

/** An amount as the budget shows it: `€1,234.56`, and `−€5.00` (with a true minus sign) below zero. */
export function formatMoney(c: Cents): string {
  const cents = Math.round(c);
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const text = `€${euros}.${String(abs % 100).padStart(2, '0')}`;
  return cents < 0 ? MINUS + text : text;
}

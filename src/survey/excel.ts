import type { HydroRow } from '../domain/types';

/*
 * The two spreadsheet functions the company workbook's survey formulas rest on, with Excel's behaviour.
 *
 * ROUND: Excel rounds the number's 15-significant-digit decimal value, so ROUND(2.675, 2) is 2.68 although the double
 * is 2.67499999….
 *
 * VLOOKUP: how Excel compares the looked-up y with the table's drafts is PENDING CONFIRMATION (a one-cell test the
 * user will run in Excel). The two candidate rules differ only when y, worked out in binary, falls just below a row's
 * draft: 4.965 + 0.1 is 5.0649999999999995, which matches the 5.065 row at 15 significant digits but not in a plain
 * binary compare. `LOOKUP_COMPARE` below holds the rule; until it is confirmed, the 15-digit compare is the default.
 */

/**
 * How `vlookupApprox` compares y with a row's draft: `'decimal15'` reads y at 15 significant digits first, `'binary'`
 * compares the doubles as they are. Pending confirmation in Excel; one of the two will remain.
 */
export type LookupCompare = 'decimal15' | 'binary';
let LOOKUP_COMPARE: LookupCompare = 'decimal15';

/** Tests only: sets the VLOOKUP compare rule and returns the previous one, to put back. */
export function setLookupCompare(rule: LookupCompare): LookupCompare {
  const previous = LOOKUP_COMPARE;
  LOOKUP_COMPARE = rule;
  return previous;
}

/** A number as Excel holds it for display and comparison: its value at 15 significant digits. */
export function decimal15(x: number): number {
  return Number.isFinite(x) ? Number(x.toPrecision(15)) : x;
}

/**
 * Excel `ROUND(x, digits)`: half away from zero, on the decimal value at 15 significant digits. `digits` may be
 * negative (tens, hundreds …). Never gives −0.
 */
export function excelRound(x: number, digits: number): number {
  if (!Number.isFinite(x) || x === 0) return x === 0 ? 0 : x;
  const [mantissa, exponentText] = Math.abs(x).toExponential(14).split('e');
  const significant = mantissa.replace('.', ''); // 15 digits: d.dddddddddddddd
  const exponent = Number(exponentText);
  const keep = exponent + 1 + digits; // how many of the significant digits stand before the rounding position
  if (keep >= significant.length) return x;
  if (keep < 0) return 0;
  let kept = keep === 0 ? 0 : Number(significant.slice(0, keep));
  if (significant.charCodeAt(keep) - 48 >= 5) kept += 1;
  const magnitude = Number(`${kept}e${-digits}`);
  return magnitude === 0 ? 0 : x < 0 ? -magnitude : magnitude;
}

/**
 * Excel `VLOOKUP(y, range, …)` with approximate match, on a range that starts at the table row of `fromDraft`: the last
 * row whose draft ≤ y. Where Excel would give #N/A (y below the range) or quietly the last row (y above the table), this
 * refuses with `'outOfRange'` (spec §4.2 item 9). `rows` are in increasing draft order.
 */
export function vlookupApprox(rows: readonly HydroRow[], fromDraft: number, y: number): HydroRow | 'outOfRange' {
  const target = LOOKUP_COMPARE === 'decimal15' ? decimal15(y) : y;
  const start = rows.findIndex((row) => row.draft >= fromDraft);
  const last = rows.at(-1);
  if (start < 0 || last === undefined || !(target >= rows[start].draft) || target > last.draft) return 'outOfRange';
  let found = start;
  for (let i = start + 1; i < rows.length && rows[i].draft <= target; i++) found = i;
  return rows[found];
}

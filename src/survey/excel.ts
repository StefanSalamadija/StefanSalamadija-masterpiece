import type { HydroRow } from '../domain/types';

/*
 * The two spreadsheet functions the company workbook's survey formulas rest on, with Excel's behaviour.
 *
 * Excel works on doubles but treats a number as its 15-significant-digit decimal value where it matters: ROUND(2.675, 2)
 * is 2.68 although the double is 2.67499999…, and a draft worked out as 3.6 + 0.1 matches the 3.70 table row. Both
 * functions here therefore read their number as that decimal value first.
 */

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
  const target = decimal15(y);
  const start = rows.findIndex((row) => row.draft >= fromDraft);
  const last = rows.at(-1);
  if (start < 0 || last === undefined || !(target >= rows[start].draft) || target > last.draft) return 'outOfRange';
  let found = start;
  for (let i = start + 1; i < rows.length && rows[i].draft <= target; i++) found = i;
  return rows[found];
}

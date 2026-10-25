const UNSIGNED = /^\d+(?:[.,]\d+)?$/;
const SIGNED = /^-?\d+(?:[.,]\d+)?$/;

/**
 * Reads a number someone typed. Ships' people type `229,5` as readily as `229.5`, so one `.` or one `,` is the
 * decimal separator; `type="number"` inputs get this wrong, so numeric fields are text inputs read with this.
 *
 * - An empty (or blank) entry has no value: `undefined`.
 * - Digits with at most one separator, and digits on both sides of it, give the number.
 * - Anything else gives `'invalid'`: an exponent (`2e`), a thousands separator (`1,000.5`), a second separator
 *   (`1.2.3`), a bare `.5` or `5.`, letters, or a sign. A leading `-` is accepted only with `{ signed: true }`, for
 *   callers whose own checks should be the ones to reject a negative number. `+` is never accepted.
 */
export function parseDecimal(text: string, options: { signed?: boolean } = {}): number | undefined | 'invalid' {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  if (!(options.signed ? SIGNED : UNSIGNED).test(trimmed)) return 'invalid';
  const value = Number(trimmed.replace(',', '.'));
  return Number.isFinite(value) ? value : 'invalid'; // hundreds of digits overflow to Infinity
}

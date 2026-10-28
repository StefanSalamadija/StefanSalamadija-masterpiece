const UNSIGNED = /^\d+(?:[.,]\d+)?$/;
const SIGNED = /^-?\d+(?:[.,]\d+)?$/;
/** One to three digits, one separator, exactly three digits: `32,500`, `32.500`, `1,000`. Never starts with 0, so `0.125` is not one. */
const THOUSANDS_LIKE = /^[1-9]\d{0,2}[.,]\d{3}$/;

export interface ParseDecimalOptions {
  /** Accept one leading `-`, for callers whose own checks should be the ones to refuse a negative number. */
  signed?: boolean;
  /**
   * Refuse an entry that has the shape of a whole number written with a thousands separator (`32,500` or `32.500`),
   * which would otherwise be read as 32.5, a thousand times too small. Only for fields that never hold three
   * decimals, such as tonnage: a density of 1.025 or a draft of 12.345 is written the same way.
   */
  rejectThousandsLike?: boolean;
}

/** True when `text` has the shape `parseDecimal` refuses with `rejectThousandsLike`, so a caller can say why it did. */
export function looksLikeThousands(text: string): boolean {
  return THOUSANDS_LIKE.test(text.trim().replace(/^-/, ''));
}

/**
 * Reads a number someone typed. Ships' people type `229,5` as readily as `229.5`, so one `.` or one `,` is the
 * decimal separator; `type="number"` inputs get this wrong, so numeric fields are text inputs read with this.
 *
 * - An empty (or blank) entry has no value: `undefined`.
 * - Digits with at most one separator, and digits on both sides of it, give the number.
 * - Anything else gives `'invalid'`: an exponent (`2e`), a thousands separator (`1,000.5`), a second separator
 *   (`1.2.3`), a bare `.5` or `5.`, letters, or a sign. A leading `-` is accepted only with `{ signed: true }`.
 *   `+` is never accepted. See `ParseDecimalOptions.rejectThousandsLike` for `32,500`.
 */
export function parseDecimal(text: string, options: ParseDecimalOptions = {}): number | undefined | 'invalid' {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  if (!(options.signed ? SIGNED : UNSIGNED).test(trimmed)) return 'invalid';
  if (options.rejectThousandsLike && looksLikeThousands(trimmed)) return 'invalid';
  const value = Number(trimmed.replace(',', '.'));
  return Number.isFinite(value) ? value : 'invalid'; // hundreds of digits overflow to Infinity
}

/**
 * `parseDecimal` for a field whose own range check takes the number: an entry that is not a number is `NaN`, which
 * any such check refuses (it is no whole number and is in no range). An empty entry has no value: `undefined`.
 */
export function parseNumberOrNaN(text: string, options: ParseDecimalOptions = {}): number | undefined {
  const value = parseDecimal(text, options);
  return value === 'invalid' ? Number.NaN : value;
}

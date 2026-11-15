const INCH = 0.0254;
const FRACTIONS: Record<string, number> = { '¼': 0.25, '½': 0.5, '¾': 0.75 };
const GLYPH: Record<number, string> = { 1: '¼', 2: '½', 3: '¾' };
/** Inches alone: a number marked with ", or a lone fraction, such as `6¼"`, `326"` or `¾`. */
const INCHES_ONLY = /^(?:(\d+(?:[.,]\d+)?)\s*([¼½¾])?\s*"|(\d+)?\s*([¼½¾])\s*"?)$/;
/** Feet, then optionally inches (whole or decimal, with an optional ¼ ½ ¾), with or without the ' and " marks. */
const FEET_INCHES = /^(\d+(?:[.,]\d+)?)\s*'?\s*(?:(\d+(?:[.,]\d+)?)?\s*([¼½¾])?\s*"?)?$/;

function num(text: string): number {
  return Number(text.replace(',', '.'));
}

/**
 * Reads a length written in feet and inches, such as `32' 6.5"`, `32'6"`, `32 6,5`, `32' 6¼"` or `32`, as metres.
 * A lone number marked `"` (or a lone fraction) is inches: `6¼"`, `326"`. After feet, inches must be under 12, and
 * decimal feet cannot be followed by inches.
 */
export function parseFeetInches(text: string): number | undefined | 'invalid' {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  const inchesOnly = INCHES_ONLY.exec(trimmed);
  if (inchesOnly && !trimmed.includes("'")) {
    const [, a, glyphA, b, glyphB] = inchesOnly;
    const whole = a ?? b;
    const glyph = glyphA ?? glyphB;
    if (whole !== undefined && glyph !== undefined && /[.,]/.test(whole)) return 'invalid';
    return ((whole === undefined ? 0 : num(whole)) + (glyph ? FRACTIONS[glyph] : 0)) * INCH;
  }
  const match = FEET_INCHES.exec(trimmed);
  if (!match) return 'invalid';
  const [, feetText, inchText, glyph] = match;
  const hasInches = inchText !== undefined || glyph !== undefined;
  if (hasInches && /[.,]/.test(feetText)) return 'invalid';
  const inches = (inchText === undefined ? 0 : num(inchText)) + (glyph ? FRACTIONS[glyph] : 0);
  if (inches >= 12) return 'invalid';
  const total = num(feetText) * 12 + inches;
  return Number.isFinite(total) ? total * INCH : 'invalid';
}

/** Metres as feet and inches to the nearest ¼ inch, e.g. `32' 6¼"`. A rounding to 12 inches carries into the feet. */
export function formatFeetInches(metres: number): string {
  const quarters = Math.round(metres / INCH / 0.25);
  const feet = Math.floor(quarters / 48);
  const rest = quarters - feet * 48;
  const whole = Math.floor(rest / 4);
  const fraction = GLYPH[rest % 4] ?? '';
  return `${feet}' ${whole}${fraction}"`;
}

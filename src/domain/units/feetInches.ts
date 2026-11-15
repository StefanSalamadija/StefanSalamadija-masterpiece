const INCH = 0.0254;
const FRACTIONS: Record<string, number> = { '¼': 0.25, '½': 0.5, '¾': 0.75 };
const GLYPH: Record<number, string> = { 1: '¼', 2: '½', 3: '¾' };
/** Feet, then optionally inches (whole or decimal, with an optional ¼ ½ ¾), with or without the ' and " marks. */
const FEET_INCHES = /^(\d+(?:[.,]\d+)?)\s*'?\s*(?:(\d+(?:[.,]\d+)?)?\s*([¼½¾])?\s*"?)?$/;

function num(text: string): number {
  return Number(text.replace(',', '.'));
}

/**
 * Reads a length written in feet and inches, such as `32' 6.5"`, `32'6"`, `32 6,5`, `32' 6¼"` or `32`, as metres.
 * Inches must be under 12, and decimal feet cannot be followed by inches.
 */
export function parseFeetInches(text: string): number | undefined | 'invalid' {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
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

import { parseDecimal } from '../numbers';
import { unitById, unitsOf, type UnitDef } from './table';

const KNOT = 1852 / 3600;
/** WMO Beaufort bands: the lowest whole knots of each force 0–12. */
const BEAUFORT_LOW_KN = [0, 1, 4, 7, 11, 17, 22, 28, 34, 41, 48, 56, 64];
const ABSOLUTE_ZERO_C = -273.15;

const MESSAGES = {
  nan: 'Not a number',
  negative: 'Must be 0 or more',
  belowZero: 'Below absolute zero',
  positive: 'Must be above 0',
  api: 'Must be above -131.5',
  beaufort: 'Whole number 0–12',
} as const;

/** Why `value` (in `unit`) is out of range, or undefined when it is fine. */
function rangeError(unit: UnitDef, value: number): string | undefined {
  switch (unit.kind) {
    case 'celsius':
    case 'fahrenheit':
    case 'kelvin':
      return (toBase(unit, value) as number) < ABSOLUTE_ZERO_C - 1e-9 ? MESSAGES.belowZero : undefined;
    case 'api':
      return value <= -131.5 ? MESSAGES.api : undefined;
    case 'beaufort':
      return Number.isInteger(value) && value >= 0 && value <= 12 ? undefined : MESSAGES.beaufort;
    default:
      if (value < 0) return MESSAGES.negative;
      if (unit.quantity === 'density' && value <= 0) return MESSAGES.positive;
      return undefined;
  }
}

/** `value` in `unit` expressed in the quantity's base unit, or `'invalid'` when out of range. */
export function toBase(unit: UnitDef, value: number): number | 'invalid' {
  switch (unit.kind) {
    case 'factor':
    case 'ftin':
      // ft + in values are carried in metres by the parser, so their factor is 1 (see `parseUnitInput`).
      return unit.kind === 'ftin' ? value : value * unit.factor!;
    case 'celsius':
      return value;
    case 'fahrenheit':
      return ((value - 32) * 5) / 9;
    case 'kelvin':
      return value - 273.15;
    case 'api':
      return value <= -131.5 ? 'invalid' : (141.5 / (value + 131.5)) * 1000;
    case 'beaufort': {
      if (!Number.isInteger(value) || value < 0 || value > 12) return 'invalid';
      if (value === 0) return 0;
      if (value === 12) return 64 * KNOT;
      const lo = BEAUFORT_LOW_KN[value];
      const hi = BEAUFORT_LOW_KN[value + 1] - 1;
      return ((lo + hi) / 2) * KNOT;
    }
  }
}

/** A base value expressed in `unit`. For ft + in the result is metres (formatting turns it into feet and inches). */
export function fromBase(unit: UnitDef, base: number): number {
  switch (unit.kind) {
    case 'factor':
      return base / unit.factor!;
    case 'ftin':
    case 'celsius':
      return base;
    case 'fahrenheit':
      return (base * 9) / 5 + 32;
    case 'kelvin':
      return base + 273.15;
    case 'api':
      return 141.5 / (base / 1000) - 131.5;
    case 'beaufort': {
      const kn = Math.round(base / KNOT);
      let force = 0;
      for (const [i, low] of BEAUFORT_LOW_KN.entries()) if (kn >= low) force = i;
      return force;
    }
  }
}

/** Reads what was typed in a unit's row. A sign is read, so that a negative value is refused by its range, not as "not a number". */
export function parseUnitInput(unit: UnitDef, text: string): number | undefined | 'invalid' {
  if (unit.kind === 'ftin') {
    // Placeholder until feet + inches parsing is wired in: decimal feet, carried in metres.
    const feet = parseDecimal(text, { signed: true });
    return typeof feet === 'number' ? feet * 0.3048 : feet;
  }
  return parseDecimal(text, { signed: true });
}

/** The value as shown in its row: the unit's decimals, never `-0`. */
export function formatUnit(unit: UnitDef, value: number): string {
  if (unit.kind === 'beaufort') return String(value);
  if (unit.kind === 'ftin') return (value / 0.3048).toFixed(2);
  const text = value.toFixed(unit.decimals);
  return /^-0(\.0+)?$/.test(text) ? text.slice(1) : text;
}

export type ConvertResult = { ok: true; values: Record<string, string> } | { ok: false; message: string };

/**
 * What every other unit of the same quantity shows when `text` is typed in `unitId`'s row. Empty text gives
 * undefined; text that is not a number, or out of range, gives the message for that row.
 */
export function convertFrom(unitId: string, text: string): ConvertResult | undefined {
  const source = unitById(unitId);
  const value = parseUnitInput(source, text);
  if (value === undefined) return undefined;
  if (value === 'invalid') return { ok: false, message: MESSAGES.nan };
  const error = rangeError(source, value);
  if (error) return { ok: false, message: error };
  const base = toBase(source, value);
  if (base === 'invalid') return { ok: false, message: MESSAGES.nan };
  const values: Record<string, string> = {};
  for (const unit of unitsOf(source.quantity)) if (unit.id !== source.id) values[unit.id] = formatUnit(unit, fromBase(unit, base));
  return { ok: true, values };
}

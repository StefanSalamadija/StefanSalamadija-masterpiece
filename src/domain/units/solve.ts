import { liveChanges, shipOffsetAt, toShipLocal } from '../shipTime';
import { parseDecimal } from '../numbers';
import type { ClockChange } from '../types';

const MS_PER_MINUTE = 60_000;
const PARTS = /^(?:(\d+(?:[.,]\d+)?)\s*d)?\s*(?:(\d+(?:[.,]\d+)?)\s*h)?\s*(?:(\d+(?:[.,]\d+)?)\s*m(?:in)?)?$/i;

const usable = (n: number | undefined): n is number => n !== undefined && Number.isFinite(n) && n > 0;

/** Reads a passage time as hours: `h:mm`, decimal hours (`28.5`, `28,5`) or parts such as `1d 4h 30m`. Zero or less is invalid. */
export function parseDuration(text: string): number | undefined | 'invalid' {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  let hours: number;
  const clock = /^(\d+):(\d{2})$/.exec(trimmed);
  if (clock) {
    const minutes = Number(clock[2]);
    if (minutes > 59) return 'invalid';
    hours = Number(clock[1]) + minutes / 60;
  } else if (/[dhm]/i.test(trimmed)) {
    const parts = PARTS.exec(trimmed);
    if (!parts) return 'invalid';
    const [, d, h, m] = parts.map((p) => (p === undefined ? 0 : Number(p.replace(',', '.'))));
    hours = d * 24 + h + m / 60;
  } else {
    const value = parseDecimal(trimmed);
    if (typeof value !== 'number') return 'invalid';
    hours = value;
  }
  return usable(hours) ? hours : 'invalid';
}

/** Hours to the minute as `h:mm`, with days spelled out from 24 h: `28:30 (1 d 4 h 30 min)`. */
export function formatDuration(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  const clock = `${h}:${String(m).padStart(2, '0')}`;
  if (h < 24) return clock;
  return `${clock} (${Math.floor(h / 24)} d ${h % 24} h ${m} min)`;
}

export type SdtSolveFor = 'speed' | 'distance' | 'time';

/** The third of speed (kn), distance (NM) and time (h) from the other two; `'invalid'` when one needed is missing or not above 0. */
export function solveSdt(v: { speedKn?: number; distanceNm?: number; hours?: number }, solveFor: SdtSolveFor): number | 'invalid' {
  const { speedKn, distanceNm, hours } = v;
  switch (solveFor) {
    case 'distance':
      return usable(speedKn) && usable(hours) ? speedKn * hours : 'invalid';
    case 'speed':
      return usable(distanceNm) && usable(hours) ? distanceNm / hours : 'invalid';
    case 'time':
      return usable(distanceNm) && usable(speedKn) ? distanceNm / speedKn : 'invalid';
  }
}

export interface Eta { eta: Date; shipLocal: string; offsetMinutes: number; utc: string; changesBefore: ClockChange[] }

/** The latest instant a JavaScript date can hold. */
const MAX_DATE_MS = 8.64e15;

/**
 * Arrival `hours` after `now` (to the minute), in ship's time as it will be then, and the clock changes due on the
 * way (a change to the offset already in force is left out). Undefined when the arrival is beyond any date.
 */
export function etaOf(now: Date, hours: number, changes: ClockChange[]): Eta | undefined {
  const ms = Math.round((now.getTime() + hours * 3_600_000) / MS_PER_MINUTE) * MS_PER_MINUTE;
  if (!Number.isFinite(ms) || Math.abs(ms) > MAX_DATE_MS) return undefined;
  const eta = new Date(ms);
  const offsetMinutes = shipOffsetAt(changes, eta);
  const changesBefore = liveChanges(changes).filter((c) => {
    const at = Date.parse(c.effectiveAt);
    return at > now.getTime() && at <= eta.getTime() && shipOffsetAt(changes, new Date(at - 1)) !== c.toOffsetMinutes;
  });
  return { eta, offsetMinutes, shipLocal: toShipLocal(eta, offsetMinutes).dateTime, utc: eta.toISOString().slice(0, 16), changesBefore };
}

export type VmSolveFor = 'volume' | 'density' | 'mass';

/** mass (kg) = volume (m³) × density (kg/m³), solved for any one; `'invalid'` when one needed is missing or not above 0. */
export function solveVolumeMass(v: { volumeM3?: number; densityKgM3?: number; massKg?: number }, solveFor: VmSolveFor): number | 'invalid' {
  const { volumeM3, densityKgM3, massKg } = v;
  switch (solveFor) {
    case 'mass':
      return usable(volumeM3) && usable(densityKgM3) ? volumeM3 * densityKgM3 : 'invalid';
    case 'volume':
      return usable(massKg) && usable(densityKgM3) ? massKg / densityKgM3 : 'invalid';
    case 'density':
      return usable(massKg) && usable(volumeM3) ? massKg / volumeM3 : 'invalid';
  }
}

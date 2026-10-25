import type { ClockChange } from './types';

const MIN_OFFSET = -720;
const MAX_OFFSET = 840;
const OFFSET_STEP = 15;
const MS_PER_MINUTE = 60_000;

/** Every offset a ship's clock can be set to, in minutes from UTC: −720…+840 in steps of 15. */
export const OFFSET_OPTIONS: number[] = Array.from(
  { length: (MAX_OFFSET - MIN_OFFSET) / OFFSET_STEP + 1 },
  (_, i) => MIN_OFFSET + i * OFFSET_STEP,
);

/** True for a whole number of minutes on the 15-minute grid between −720 and +840. */
export function isValidOffset(min: number): boolean {
  return Number.isInteger(min) && min >= MIN_OFFSET && min <= MAX_OFFSET && min % OFFSET_STEP === 0;
}

/** `180` → `UTC+03:00`, `-570` → `UTC-09:30`. */
export function formatOffset(min: number): string {
  const abs = Math.abs(min);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `UTC${min < 0 ? '-' : '+'}${hh}:${mm}`;
}

function byEffectiveThenCreated(a: ClockChange, b: ClockChange): number {
  return Date.parse(a.effectiveAt) - Date.parse(b.effectiveAt) || Date.parse(a.createdAt) - Date.parse(b.createdAt);
}

/** Live changes, earliest first; equal `effectiveAt` is ordered by `createdAt`, so the last of a tie wins. */
function liveChanges(changes: ClockChange[]): ClockChange[] {
  return changes.filter((c) => !c.deleted).sort(byEffectiveThenCreated);
}

/**
 * The ship's UTC offset (minutes) at `instant`: that of the latest non-deleted change effective at or before it.
 * Before the first change that change's offset applies; with no changes the offset is 0.
 */
export function shipOffsetAt(changes: ClockChange[], instant: Date): number {
  const live = liveChanges(changes);
  if (live.length === 0) return 0;
  // Clamping to the first effective time makes "before the first change" resolve to the first change's offset.
  const at = Math.max(instant.getTime(), Date.parse(live[0].effectiveAt));
  let offset = live[0].toOffsetMinutes;
  for (const change of live) {
    if (Date.parse(change.effectiveAt) > at) break;
    offset = change.toOffsetMinutes;
  }
  return offset;
}

/** The instant expressed as ship's local `YYYY-MM-DD`, `HH:mm` and `YYYY-MM-DDTHH:mm`. */
export function toShipLocal(instant: Date, offsetMin: number): { date: string; time: string; dateTime: string } {
  const iso = new Date(instant.getTime() + offsetMin * MS_PER_MINUTE).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16), dateTime: iso.slice(0, 16) };
}

/** Inverse of `toShipLocal`. Expects a well-formed `YYYY-MM-DDTHH:mm`. */
export function shipLocalToInstant(dateTime: string, offsetMin: number): Date {
  return new Date(Date.parse(`${dateTime}:00.000Z`) - offsetMin * MS_PER_MINUTE);
}

/** The earliest non-deleted change taking effect strictly after `now`, if any. */
export function nextScheduledChange(changes: ClockChange[], now: Date): ClockChange | undefined {
  return liveChanges(changes).find((c) => Date.parse(c.effectiveAt) > now.getTime());
}

/** This device's UTC offset in minutes, rounded to the nearest 15. */
export function deviceOffsetMinutes(now: Date = new Date()): number {
  // `+ 0` turns a -0 (UTC device) into 0.
  return Math.round(-now.getTimezoneOffset() / OFFSET_STEP) * OFFSET_STEP + 0;
}

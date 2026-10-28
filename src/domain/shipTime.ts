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

/** `offset` moved by `deltaMinutes` and held within the range, so an hour past the last offset stays on the last. */
export function stepOffset(offset: number, deltaMinutes: number): number {
  return Math.min(MAX_OFFSET, Math.max(MIN_OFFSET, offset + deltaMinutes));
}

/** `180` → `UTC+03:00`, `-570` → `UTC-09:30`. */
export function formatOffset(min: number): string {
  const abs = Math.abs(min);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `UTC${min < 0 ? '-' : '+'}${hh}:${mm}`;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Earlier effective time first; at the same time the one created later comes later, so it wins. Only when both are
 * equal (two devices, or two taps, in the same millisecond) the id decides, so that the result never depends on the
 * order the changes were read in and every device resolves a tie the same way.
 */
function byEffectiveThenCreated(a: ClockChange, b: ClockChange): number {
  return (
    Date.parse(a.effectiveAt) - Date.parse(b.effectiveAt) ||
    Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
    compareText(a.id, b.id)
  );
}

/** Live changes, earliest first; of equal `effectiveAt` the one created later comes later, so the last of a tie wins. */
export function liveChanges(changes: ClockChange[]): ClockChange[] {
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

/** Why a second clock change at the instant of an existing one is refused. */
export const DUPLICATE_CLOCK_CHANGE = 'A clock change is already set for that time.';

/** Where a time read off the ship's clocks falls on the timeline of clock changes. */
export type ShipLocalResolution =
  /** The clocks read that time at `instant`, on `offsetMinutes`. */
  | { kind: 'at'; instant: Date; offsetMinutes: number }
  /**
   * An advance skips that time: the clocks never show it. `clocksForwardAt` is the time (`HH:mm`) the clocks read
   * when they are moved forward over it, and `offsetMinutes` is the offset up to then.
   */
  | { kind: 'skipped'; clocksForwardAt: string; offsetMinutes: number };

/**
 * Finds the instant at which the ship's clocks read `dateTime` (`YYYY-MM-DDTHH:mm`), on the timeline of all its live
 * clock changes, scheduled ones included: the time is read with the offset that is in effect at that time, not the one
 * in effect now. A time that a retard makes the clocks show twice is taken at the first showing. A time that an
 * advance skips has no instant. With no changes the clocks are on UTC; before the first change they are on its offset,
 * as in `shipOffsetAt`.
 */
export function resolveShipLocal(changes: ClockChange[], dateTime: string): ShipLocalResolution {
  const wall = Date.parse(`${dateTime}:00.000Z`);   // what the clocks read, as if they were on UTC
  // Each stretch of the timeline with the offset it runs on; changes at one instant collapse into the last of them.
  const stretches: { start: number; offset: number }[] = [];
  for (const change of liveChanges(changes)) {
    const start = Date.parse(change.effectiveAt);
    if (!Number.isFinite(start)) continue;
    const last = stretches[stretches.length - 1];
    if (last?.start === start) last.offset = change.toOffsetMinutes;
    else stretches.push({ start, offset: change.toOffsetMinutes });
  }
  if (stretches.length === 0) return { kind: 'at', instant: new Date(wall), offsetMinutes: 0 };

  // Earliest first, so a repeated time is found at its first showing. The first stretch reaches back for ever.
  for (const [i, { offset }] of stretches.entries()) {
    const instant = wall - offset * MS_PER_MINUTE;
    const from = i === 0 ? -Infinity : stretches[i].start;
    const until = i + 1 < stretches.length ? stretches[i + 1].start : Infinity;
    if (instant >= from && instant < until) return { kind: 'at', instant: new Date(instant), offsetMinutes: offset };
  }

  // No stretch shows it: it lies in the hour(s) skipped where the clocks were moved forward.
  for (let i = 1; i < stretches.length; i++) {
    const { start } = stretches[i];
    const before = stretches[i - 1].offset;
    if (wall >= start + before * MS_PER_MINUTE && wall < start + stretches[i].offset * MS_PER_MINUTE) {
      return { kind: 'skipped', clocksForwardAt: toShipLocal(new Date(start), before).time, offsetMinutes: before };
    }
  }
  // Not reached for a well-formed time; read it with the offset of the last stretch rather than fail.
  const { offset } = stretches[stretches.length - 1];
  return { kind: 'at', instant: new Date(wall - offset * MS_PER_MINUTE), offsetMinutes: offset };
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

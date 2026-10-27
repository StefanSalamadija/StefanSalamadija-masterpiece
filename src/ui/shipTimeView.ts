import { isValidLocalDateTime } from '../domain/dates';
import { DUPLICATE_CLOCK_CHANGE, formatOffset, liveChanges, resolveShipLocal, shipOffsetAt, toShipLocal } from '../domain/shipTime';
import type { ClockChange, FieldError } from '../domain/types';

export const TIME_REQUIRED = 'Enter the date and time of the change.';
export const FUTURE_REQUIRED = 'Choose a time in the future.';

/** The message for a time that an advance skips, naming the time on the clocks when they go forward (`HH:mm`). */
export const timeSkipped = (clocksForwardAt: string): string =>
  `That time doesn't exist on board — clocks go forward at ${clocksForwardAt}.`;

/** One line of the history. */
export interface HistoryRow {
  id: string;
  /** `2026-10-26 02:00 → UTC+05:00` */
  text: string;
  /** The ship time of the change as `text` shows it: `2026-10-26 02:00`. */
  when: string;
  /** True while the change has not taken effect yet: it can still be cancelled. */
  scheduled: boolean;
}

/**
 * The clock changes of a ship, newest first, as the History lists them.
 *
 * Convention: each change is shown at the ship's time of the offset that was in effect just before it, that is, the
 * time on the clocks at the moment they were moved. An advance at 12:00 reads `12:00 → UTC+04:00` (not 13:00), and
 * the one after it, made at 13:00, reads `13:00 → UTC+05:00`. A scheduled change is read the same way when it is set
 * (see `resolveShipLocal`), so the history shows the time that was typed. The ship's first change has nothing before it
 * and is shown at its own offset. Cancelled changes are left out, as are any whose time cannot be read.
 */
export function historyRows(changes: ClockChange[], now: Date): HistoryRow[] {
  const ordered = liveChanges(changes.filter((c) => Number.isFinite(Date.parse(c.effectiveAt))));
  return ordered
    .map((change, i) => {
      const before = i === 0 ? change.toOffsetMinutes : ordered[i - 1].toOffsetMinutes;
      const { date, time } = toShipLocal(new Date(change.effectiveAt), before);
      return {
        id: change.id,
        text: `${date} ${time} → ${formatOffset(change.toOffsetMinutes)}`,
        when: `${date} ${time}`,
        scheduled: Date.parse(change.effectiveAt) > now.getTime(),
      };
    })
    .reverse();
}

const problem = (message: string): { problem: FieldError } => ({ problem: { field: 'when', severity: 'error', message } });

/**
 * The instant a scheduled change takes effect, from the ship time typed for it, or what is wrong with that time.
 * The time is read on the ship's timeline of clock changes, scheduled ones included, so it is the time on the clocks
 * then, with the offset that will be in effect then (not the one in effect now). It has to be a time the clocks show,
 * after `now`, and not the instant of a change that is already set.
 */
export function scheduleTarget(
  when: string, changes: ClockChange[], now: Date,
): { instant: Date; offsetMinutes: number } | { problem: FieldError } {
  if (!isValidLocalDateTime(when)) return problem(TIME_REQUIRED);
  const found = resolveShipLocal(changes, when);
  if (found.kind === 'skipped') return problem(timeSkipped(found.clocksForwardAt));
  if (found.instant.getTime() <= now.getTime()) return problem(FUTURE_REQUIRED);
  if (liveChanges(changes).some((c) => Date.parse(c.effectiveAt) === found.instant.getTime())) return problem(DUPLICATE_CLOCK_CHANGE);
  return { instant: found.instant, offsetMinutes: found.offsetMinutes };
}

/**
 * `Read at UTC+04:00.`, the hint under the time field: the offset the typed time is read with. Until a time that the
 * clocks show is typed, it is the offset in effect now.
 */
export function readingHint(when: string, changes: ClockChange[], now: Date): string {
  const found = isValidLocalDateTime(when) ? resolveShipLocal(changes, when) : undefined;
  return `Read at ${formatOffset(found ? found.offsetMinutes : shipOffsetAt(changes, now))}.`;
}

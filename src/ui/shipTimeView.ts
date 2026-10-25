import { isValidLocalDateTime } from '../domain/dates';
import { formatOffset, liveChanges, shipLocalToInstant, toShipLocal } from '../domain/shipTime';
import type { ClockChange, FieldError } from '../domain/types';

export const TIME_REQUIRED = 'Enter the date and time of the change.';
export const FUTURE_REQUIRED = 'Choose a time in the future.';

/** One line of the history. */
export interface HistoryRow {
  id: string;
  /** `2026-10-26 02:00 → UTC+05:00` */
  text: string;
  /** True while the change has not taken effect yet: it can still be cancelled. */
  scheduled: boolean;
}

/**
 * The clock changes of a ship, newest first, as the History lists them.
 *
 * Convention: each change is shown at the ship's time of the offset that was in effect just before it, that is, the
 * time on the clocks at the moment they were moved. An advance at 12:00 reads `12:00 → UTC+04:00` (not 13:00), and
 * the one after it, made at 13:00, reads `13:00 → UTC+05:00`. This is also the time that was typed for a scheduled
 * change. The ship's first change has nothing before it and is shown at its own offset. Cancelled changes are left
 * out, as are any whose time cannot be read.
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
        scheduled: Date.parse(change.effectiveAt) > now.getTime(),
      };
    })
    .reverse();
}

/**
 * What is wrong with the time typed for a scheduled change, if anything. The time is the ship's time, taken at
 * `offsetNow` (the offset in effect now, as the form says) and it has to be after `now`.
 */
export function schedulingProblem(when: string, offsetNow: number, now: Date): FieldError | undefined {
  if (!isValidLocalDateTime(when)) return { field: 'when', severity: 'error', message: TIME_REQUIRED };
  if (shipLocalToInstant(when, offsetNow).getTime() <= now.getTime()) {
    return { field: 'when', severity: 'error', message: FUTURE_REQUIRED };
  }
  return undefined;
}

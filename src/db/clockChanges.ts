import { formatOffset, isValidOffset, OFFSET_OPTIONS, shipOffsetAt, stepOffset } from '../domain/shipTime';
import type { ClockChange } from '../domain/types';
import { createRecord, listForShip, softDelete } from './records';
import type { MasterpieceDB } from './schema';
import { guardWrite } from './storage';

const LOWEST = formatOffset(OFFSET_OPTIONS[0]);
const HIGHEST = formatOffset(OFFSET_OPTIONS[OFFSET_OPTIONS.length - 1]);

/** Writes a change of the ship's clock to `toOffsetMinutes`, taking effect at `effectiveAt` (now, or later for a scheduled one). */
export async function addClockChange(
  db: MasterpieceDB, shipId: string, toOffsetMinutes: number, effectiveAt: Date,
): Promise<ClockChange> {
  if (!isValidOffset(toOffsetMinutes)) {
    throw new RangeError(`Choose a UTC offset from ${LOWEST} to ${HIGHEST} in steps of 15 minutes.`);
  }
  return createRecord<ClockChange>(db, 'clockChanges', { shipId, effectiveAt: effectiveAt.toISOString(), toOffsetMinutes });
}

/**
 * Moves the ship's clock by `deltaMinutes` (60 to advance, −60 to retard) from the offset in effect at `now`, taking
 * effect at `now`. The offset is read from the stored changes in the same transaction as the write, so steps asked
 * for one after the other, or from a screen that has not caught up, stack. An hour past the end of the range stops at
 * the end; a clock already there cannot be moved further, and the step is refused.
 */
export function stepClock(db: MasterpieceDB, shipId: string, deltaMinutes: number, now: Date = new Date()): Promise<ClockChange> {
  return guardWrite(() =>
    db.transaction('rw', [db.clockChanges, db.settings], async () => {
      const current = shipOffsetAt(await listForShip<ClockChange>(db, 'clockChanges', shipId), now);
      const next = stepOffset(current, deltaMinutes);
      if (next === current) {
        throw new Error(`The ship's clock is already at ${formatOffset(current)}, the end of the range.`);
      }
      return addClockChange(db, shipId, next, now);
    }),
  );
}

/**
 * Cancels a change that has not taken effect yet by soft-deleting it, so the cancellation reaches other devices. A
 * change that has taken effect (at `now` or before) stays in the history for good and is refused. One that is
 * already cancelled, or not there, needs nothing.
 */
export function cancelScheduledChange(db: MasterpieceDB, id: string, now: Date = new Date()): Promise<void> {
  return guardWrite(() =>
    db.transaction('rw', [db.clockChanges, db.settings], async () => {
      const change = await db.clockChanges.get(id);
      if (!change || change.deleted) return;
      if (Date.parse(change.effectiveAt) <= now.getTime()) {
        throw new Error('This clock change has already taken effect, so it stays in the history.');
      }
      await softDelete(db, 'clockChanges', id);
    }),
  );
}

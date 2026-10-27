import {
  DUPLICATE_CLOCK_CHANGE, formatOffset, isValidOffset, OFFSET_OPTIONS, shipOffsetAt, stepOffset,
} from '../domain/shipTime';
import type { ClockChange } from '../domain/types';
import { createRecord, listForShip, softDelete } from './records';
import type { MasterpieceDB } from './schema';
import { guardWrite } from './storage';

const LOWEST = formatOffset(OFFSET_OPTIONS[0]);
const HIGHEST = formatOffset(OFFSET_OPTIONS[OFFSET_OPTIONS.length - 1]);

/**
 * Writes a change of the ship's clock to `toOffsetMinutes`, taking effect at `effectiveAt` (a scheduled one is later
 * than now). Two live changes of a ship never take effect at the same instant: that would leave it to chance which
 * one wins, so a second one there is refused.
 */
export function addClockChange(
  db: MasterpieceDB, shipId: string, toOffsetMinutes: number, effectiveAt: Date,
): Promise<ClockChange> {
  if (!isValidOffset(toOffsetMinutes)) {
    return Promise.reject(new RangeError(`Choose a UTC offset from ${LOWEST} to ${HIGHEST} in steps of 15 minutes.`));
  }
  return guardWrite(() =>
    db.transaction('rw', [db.clockChanges, db.settings], async () => {
      const live = await listForShip<ClockChange>(db, 'clockChanges', shipId);
      if (live.some((c) => Date.parse(c.effectiveAt) === effectiveAt.getTime())) throw new Error(DUPLICATE_CLOCK_CHANGE);
      return createRecord<ClockChange>(db, 'clockChanges', { shipId, effectiveAt: effectiveAt.toISOString(), toOffsetMinutes });
    }),
  );
}

/**
 * Writes a change that takes effect now. Everything is decided inside one transaction: the instant is taken when the
 * write begins (not when it was asked for, which may be before an earlier write finished), and the offset it starts
 * from is read from the stored changes. So changes made one after the other stack, even from a screen that has not
 * caught up. If a change already takes effect at that very millisecond, this one takes effect a millisecond later (and
 * so on past any chain of them), so that it is the one in effect afterwards and no two share an instant.
 */
function changeNow(
  db: MasterpieceDB, shipId: string, offsetFrom: (current: number) => number, now: Date | undefined,
): Promise<ClockChange> {
  return guardWrite(() =>
    db.transaction('rw', [db.clockChanges, db.settings], async () => {
      const changes = await listForShip<ClockChange>(db, 'clockChanges', shipId);
      const taken = new Set(changes.map((c) => Date.parse(c.effectiveAt)));
      let at = (now ?? new Date()).getTime();
      while (taken.has(at)) at += 1;
      const effectiveAt = new Date(at);
      return addClockChange(db, shipId, offsetFrom(shipOffsetAt(changes, effectiveAt)), effectiveAt);
    }),
  );
}

/**
 * Moves the ship's clock by `deltaMinutes` (60 to advance, −60 to retard) from the offset in effect now, taking
 * effect now. An hour past the end of the range stops at the end; a clock already there cannot be moved further, and
 * the step is refused. `now` is for tests.
 */
export function stepClock(db: MasterpieceDB, shipId: string, deltaMinutes: number, now?: Date): Promise<ClockChange> {
  return changeNow(db, shipId, (current) => {
    const next = stepOffset(current, deltaMinutes);
    if (next === current) throw new Error(`The ship's clock is already at ${formatOffset(current)}, the end of the range.`);
    return next;
  }, now);
}

/** Sets the ship's clock to `toOffsetMinutes`, taking effect now. `now` is for tests. */
export function setClockOffset(db: MasterpieceDB, shipId: string, toOffsetMinutes: number, now?: Date): Promise<ClockChange> {
  return changeNow(db, shipId, () => toOffsetMinutes, now);
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

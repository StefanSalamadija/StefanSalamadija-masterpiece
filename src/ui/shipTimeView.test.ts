import { describe, expect, it } from 'vitest';
import type { ClockChange } from '../domain/types';
import { DUPLICATE_CLOCK_CHANGE } from '../domain/shipTime';
import { FUTURE_REQUIRED, historyRows, readingHint, scheduleTarget, timeSkipped, TIME_REQUIRED } from './shipTimeView';

let seq = 0;
function change(effectiveAt: string, toOffsetMinutes: number, over: Partial<ClockChange> = {}): ClockChange {
  seq += 1;
  return {
    id: `cc-${String(seq).padStart(3, '0')}`, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'device', deleted: false, scope: 'ship', shipId: 'ship-1', effectiveAt, toOffsetMinutes, ...over,
  };
}

const NOW = new Date('2026-10-25T09:00:00.000Z');

describe('historyRows', () => {
  it('lists the changes newest first', () => {
    const rows = historyRows([
      change('2026-10-01T00:00:00.000Z', 180), change('2026-10-20T00:00:00.000Z', 240), change('2026-10-10T00:00:00.000Z', 120),
    ], NOW);
    expect(rows.map((r) => r.text)).toEqual([
      '2026-10-20 02:00 → UTC+04:00',
      '2026-10-10 03:00 → UTC+02:00',
      '2026-10-01 03:00 → UTC+03:00',
    ]);
  });

  describe('shows each change at the ship time of the offset in effect just before it', () => {
    // Clocks go from 12:00 to 13:00 at +03:00: the change is "12:00 → UTC+04:00", not "13:00".
    it('so an advance reads as the time the clocks were at when they were moved', () => {
      const rows = historyRows([change('2026-10-01T00:00:00.000Z', 180), change('2026-10-25T09:00:00.000Z', 240)], NOW);
      expect(rows[0].text).toBe('2026-10-25 12:00 → UTC+04:00');
    });
    it('and a retard across midnight reads as the date the clocks were at before it', () => {
      // 21:30Z: 00:30 on the 26th at +03:00, retarded to +02:00 (23:30 on the 25th).
      const rows = historyRows([change('2026-10-01T00:00:00.000Z', 180), change('2026-10-25T21:30:00.000Z', 120)], new Date('2026-10-26T00:00:00Z'));
      expect(rows[0].text).toBe('2026-10-26 00:30 → UTC+02:00');
    });
    it('and the very first change at its own offset, there being none before it', () => {
      expect(historyRows([change('2026-10-25T08:00:00.000Z', 180)], NOW)[0].text).toBe('2026-10-25 11:00 → UTC+03:00');
    });
    it('and two changes at one instant in the order they were made', () => {
      const first = change('2026-10-25T08:00:00.000Z', 180);
      const a = change('2026-10-25T09:00:00.000Z', 240, { createdAt: '2026-10-25T09:00:00.100Z' });
      const b = change('2026-10-25T09:00:00.000Z', 300, { createdAt: '2026-10-25T09:00:00.200Z' });
      expect(historyRows([b, first, a], NOW).map((r) => r.text)).toEqual([
        '2026-10-25 13:00 → UTC+05:00', '2026-10-25 12:00 → UTC+04:00', '2026-10-25 11:00 → UTC+03:00',
      ]);
    });
    it('and a scheduled change at the offset in effect before it, whether it is now or an earlier scheduled one', () => {
      const rows = historyRows([
        change('2026-10-01T00:00:00.000Z', 180), change('2026-10-26T00:00:00.000Z', 240), change('2026-10-27T00:00:00.000Z', 300),
      ], NOW);
      expect(rows.map((r) => r.text)).toEqual([
        '2026-10-27 04:00 → UTC+05:00', '2026-10-26 03:00 → UTC+04:00', '2026-10-01 03:00 → UTC+03:00',
      ]);
    });
  });

  it('marks the changes that have not taken effect yet as scheduled', () => {
    const rows = historyRows([
      change('2026-10-01T00:00:00.000Z', 180), change('2026-10-25T09:00:00.000Z', 240), change('2026-10-25T09:00:00.001Z', 300),
    ], NOW);
    expect(rows.map((r) => r.scheduled)).toEqual([true, false, false]);   // a change at exactly now has taken effect
  });

  it('carries the id of the change, to cancel it by', () => {
    const c = change('2026-10-26T00:00:00.000Z', 240);
    expect(historyRows([c], NOW)[0].id).toBe(c.id);
  });

  it('carries the ship time of the change, as shown, to name its Cancel button by', () => {
    const rows = historyRows([change('2026-10-01T00:00:00.000Z', 180), change('2026-10-26T00:00:00.000Z', 240)], NOW);
    expect(rows.map((r) => r.when)).toEqual(['2026-10-26 03:00', '2026-10-01 03:00']);
  });

  it('leaves out cancelled changes, which neither show nor count for the offset before the next one', () => {
    const rows = historyRows([
      change('2026-10-01T00:00:00.000Z', 180), change('2026-10-10T00:00:00.000Z', 600, { deleted: true }),
      change('2026-10-20T00:00:00.000Z', 240),
    ], NOW);
    expect(rows.map((r) => r.text)).toEqual(['2026-10-20 03:00 → UTC+04:00', '2026-10-01 03:00 → UTC+03:00']);
  });

  it('leaves out a change whose time is unreadable, instead of failing the screen', () => {
    const rows = historyRows([change('2026-10-01T00:00:00.000Z', 180), change('not a time', 240)], NOW);
    expect(rows.map((r) => r.text)).toEqual(['2026-10-01 03:00 → UTC+03:00']);
  });

  it('is empty without changes', () => {
    expect(historyRows([], NOW)).toEqual([]);
  });
});

describe('scheduleTarget', () => {
  // The ship went to +03:00 on the 1st: 2026-10-25T09:00Z is 12:00 on board.
  const ship = () => change('2026-10-01T00:00:00.000Z', 180);
  const problemOf = (target: ReturnType<typeof scheduleTarget>) => ('problem' in target ? target.problem : undefined);
  const instantOf = (target: ReturnType<typeof scheduleTarget>) => ('instant' in target ? target.instant.toISOString() : undefined);

  it('gives the instant for a time in the future, read with the offset in effect then', () => {
    expect(scheduleTarget('2026-10-25T12:01', [ship()], NOW)).toEqual({ instant: new Date('2026-10-25T09:01:00.000Z'), offsetMinutes: 180 });
    expect(instantOf(scheduleTarget('2026-10-26T02:00', [ship()], NOW))).toBe('2026-10-25T23:00:00.000Z');
  });

  it('reads the time with the offset that will be in effect at that time, scheduled changes included', () => {
    // At 21:00Z the clocks go from 00:00 to 01:00 (+04:00), so 02:00 on the 26th comes at 22:00Z, not at 23:00Z.
    const scheduled = change('2026-10-25T21:00:00.000Z', 240);
    const target = scheduleTarget('2026-10-26T02:00', [ship(), scheduled], NOW);
    expect(target).toEqual({ instant: new Date('2026-10-25T22:00:00.000Z'), offsetMinutes: 240 });
  });

  it('refuses a time that is now or past, on board time and not UTC', () => {
    // 12:00 on board is 09:00Z, which is now.
    expect(problemOf(scheduleTarget('2026-10-25T12:00', [ship()], NOW))).toEqual({ field: 'when', severity: 'error', message: FUTURE_REQUIRED });
    expect(problemOf(scheduleTarget('2026-10-25T10:00', [ship()], NOW))?.message).toBe('Choose a time in the future.');
    // Ahead as a UTC time, past as board time at +03:00.
    expect(problemOf(scheduleTarget('2026-10-25T09:30', [ship()], NOW))?.message).toBe(FUTURE_REQUIRED);
    // The same wall-clock time is ahead at a ship further west.
    expect(problemOf(scheduleTarget('2026-10-25T09:30', [change('2026-10-01T00:00:00.000Z', -180)], NOW))).toBeUndefined();
  });

  it('asks for a time when there is none', () => {
    expect(problemOf(scheduleTarget('', [ship()], NOW))).toEqual({ field: 'when', severity: 'error', message: TIME_REQUIRED });
    expect(problemOf(scheduleTarget('2026-02-30T10:00', [ship()], NOW))?.message).toBe(TIME_REQUIRED);
  });

  it("refuses a time the clocks skip, and says when they go forward", () => {
    const scheduled = change('2026-10-25T21:00:00.000Z', 240);   // 00:00 → 01:00 on the 26th
    const target = scheduleTarget('2026-10-26T00:30', [ship(), scheduled], NOW);
    expect(problemOf(target)).toEqual({
      field: 'when', severity: 'error', message: "That time doesn't exist on board — clocks go forward at 00:00.",
    });
    expect(timeSkipped('00:00')).toBe("That time doesn't exist on board — clocks go forward at 00:00.");
    expect(problemOf(scheduleTarget('2026-10-26T01:30', [ship(), scheduled], NOW))).toBeUndefined();
  });

  it('takes the first showing of a time that a retard makes the clocks show twice', () => {
    const scheduled = change('2026-10-25T21:00:00.000Z', 120);   // 00:00 → 23:00 on the 25th, from +03:00 to +02:00
    expect(instantOf(scheduleTarget('2026-10-25T23:30', [ship(), scheduled], NOW))).toBe('2026-10-25T20:30:00.000Z');
  });

  it('refuses a second change at the instant of one that is already set', () => {
    // The clocks go from 02:00 to 04:00 on the 26th at 23:00Z; 04:00 is the time that comes at that very instant.
    const scheduled = change('2026-10-25T23:00:00.000Z', 300);
    expect(problemOf(scheduleTarget('2026-10-26T04:00', [ship(), scheduled], NOW))).toEqual({
      field: 'when', severity: 'error', message: DUPLICATE_CLOCK_CHANGE,
    });
    expect(DUPLICATE_CLOCK_CHANGE).toBe('A clock change is already set for that time.');
  });

  it('does not count a cancelled change as being set', () => {
    const cancelled = { ...change('2026-10-25T23:00:00.000Z', 300), deleted: true };
    expect(instantOf(scheduleTarget('2026-10-26T02:00', [ship(), cancelled], NOW))).toBe('2026-10-25T23:00:00.000Z');
    expect(problemOf(scheduleTarget('2026-10-26T04:00', [ship(), cancelled], NOW))).toBeUndefined();
  });
});

describe('readingHint', () => {
  const ship = () => change('2026-10-01T00:00:00.000Z', 180);

  it('names the offset in effect now when no time is typed yet, or the time is not one', () => {
    expect(readingHint('', [ship()], NOW)).toBe('Read at UTC+03:00.');
    expect(readingHint('2026-02-30T10:00', [ship()], NOW)).toBe('Read at UTC+03:00.');
  });
  it('names the offset in effect now for a time before any scheduled change', () => {
    expect(readingHint('2026-10-25T20:00', [ship(), change('2026-10-26T00:00:00.000Z', 240)], NOW)).toBe('Read at UTC+03:00.');
  });
  it('names the offset the typed time will be read with, after a scheduled change', () => {
    expect(readingHint('2026-10-26T02:00', [ship(), change('2026-10-25T21:00:00.000Z', 240)], NOW)).toBe('Read at UTC+04:00.');
  });
  it('names the offset before the move for a time the clocks skip', () => {
    expect(readingHint('2026-10-26T00:30', [ship(), change('2026-10-25T21:00:00.000Z', 240)], NOW)).toBe('Read at UTC+03:00.');
  });
});

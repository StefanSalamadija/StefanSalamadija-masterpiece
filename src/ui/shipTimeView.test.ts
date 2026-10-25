import { describe, expect, it } from 'vitest';
import type { ClockChange } from '../domain/types';
import { FUTURE_REQUIRED, historyRows, schedulingProblem, TIME_REQUIRED } from './shipTimeView';

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

describe('schedulingProblem', () => {
  // The ship is at +03:00: 2026-10-25T09:00Z is 12:00 on board.
  it('is none for a time in the future, converted with the offset in effect now', () => {
    expect(schedulingProblem('2026-10-25T12:01', 180, NOW)).toBeUndefined();
    expect(schedulingProblem('2026-10-26T02:00', 180, NOW)).toBeUndefined();
  });
  it('refuses a time that is now or past, on board time and not UTC', () => {
    // 12:00 on board is 09:00Z, which is now.
    expect(schedulingProblem('2026-10-25T12:00', 180, NOW)).toEqual({ field: 'when', severity: 'error', message: FUTURE_REQUIRED });
    expect(schedulingProblem('2026-10-25T10:00', 180, NOW)?.message).toBe('Choose a time in the future.');
    // Ahead as a UTC time, past as board time at +03:00.
    expect(schedulingProblem('2026-10-25T09:30', 180, NOW)?.message).toBe(FUTURE_REQUIRED);
    // The same wall-clock time is ahead at a ship further west.
    expect(schedulingProblem('2026-10-25T09:30', -180, NOW)).toBeUndefined();
  });
  it('asks for a time when there is none', () => {
    expect(schedulingProblem('', 180, NOW)).toEqual({ field: 'when', severity: 'error', message: TIME_REQUIRED });
    expect(schedulingProblem('2026-02-30T10:00', 180, NOW)?.message).toBe(TIME_REQUIRED);
  });
});

import { describe, expect, it } from 'vitest';
import {
  OFFSET_OPTIONS,
  deviceOffsetMinutes,
  formatOffset,
  isValidOffset,
  nextScheduledChange,
  shipLocalToInstant,
  shipOffsetAt,
  toShipLocal,
} from './shipTime';
import type { ClockChange } from './types';

let seq = 0;
function cc(effectiveAt: string, toOffsetMinutes: number, createdAt = '2026-01-01T00:00:00.000Z'): ClockChange {
  seq += 1;
  return {
    id: `cc-${seq}`, createdAt, updatedAt: createdAt, updatedBy: 'test-device', deleted: false, scope: 'ship',
    shipId: 'ship-1', effectiveAt, toOffsetMinutes,
  };
}

describe('formatOffset', () => {
  it('formats whole-hour, half-hour and quarter-hour offsets with a sign', () => {
    expect(formatOffset(180)).toBe('UTC+03:00');
    expect(formatOffset(-570)).toBe('UTC-09:30');
    expect(formatOffset(0)).toBe('UTC+00:00');
    expect(formatOffset(345)).toBe('UTC+05:45');
  });
});

describe('isValidOffset', () => {
  it('accepts multiples of 15 from -720 to +840', () => {
    expect([840, -720, 330].every(isValidOffset)).toBe(true);
  });
  it('rejects out-of-range and non-multiples of 15', () => {
    expect([845, 855, 20].some(isValidOffset)).toBe(false);
    expect([-735, 7.5, NaN].some(isValidOffset)).toBe(false);
  });
});

describe('OFFSET_OPTIONS', () => {
  it('runs from -720 to +840 in steps of 15, all valid', () => {
    expect(OFFSET_OPTIONS[0]).toBe(-720);
    expect(OFFSET_OPTIONS[OFFSET_OPTIONS.length - 1]).toBe(840);
    expect(OFFSET_OPTIONS).toHaveLength((840 + 720) / 15 + 1);
    expect(OFFSET_OPTIONS.every((o, i) => i === 0 || o - OFFSET_OPTIONS[i - 1] === 15)).toBe(true);
    expect(OFFSET_OPTIONS.every(isValidOffset)).toBe(true);
  });
});

describe('shipOffsetAt', () => {
  const c1 = cc('2026-10-20T00:00:00.000Z', 60);
  const c2 = cc('2026-10-24T23:00:00.000Z', 120);

  it('uses the latest change at or before the instant', () => {
    expect(shipOffsetAt([c1, c2], new Date('2026-10-22T12:00:00Z'))).toBe(60);
    expect(shipOffsetAt([c1, c2], new Date('2026-10-24T23:00:00Z'))).toBe(120);
  });
  it('does not depend on the order of the changes', () => {
    expect(shipOffsetAt([c2, c1], new Date('2026-10-22T12:00:00Z'))).toBe(60);
    expect(shipOffsetAt([c2, c1], new Date('2026-10-25T12:00:00Z'))).toBe(120);
  });
  it('uses the first change offset before the first change', () => {
    expect(shipOffsetAt([c1, c2], new Date('2026-10-19T00:00:00Z'))).toBe(60);
  });
  it('is 0 with no changes', () => {
    expect(shipOffsetAt([], new Date())).toBe(0);
  });
  it('ignores deleted changes', () => {
    expect(shipOffsetAt([c1, { ...c2, deleted: true }], new Date('2026-10-25T00:00:00Z'))).toBe(60);
  });
  it('is 0 when every change is deleted', () => {
    expect(shipOffsetAt([{ ...c1, deleted: true }], new Date('2026-10-25T00:00:00Z'))).toBe(0);
  });
  it('lets the later createdAt win when effectiveAt is equal', () => {
    const a = cc('2026-10-24T00:00:00.000Z', 60, '2026-10-01T00:00:00.000Z');
    const b = cc('2026-10-24T00:00:00.000Z', 120, '2026-10-02T00:00:00.000Z');
    expect(shipOffsetAt([b, a], new Date('2026-10-25T00:00:00Z'))).toBe(120);
    expect(shipOffsetAt([a, b], new Date('2026-10-25T00:00:00Z'))).toBe(120);
  });
});

describe('toShipLocal', () => {
  it('shifts forward across midnight', () => {
    expect(toShipLocal(new Date('2026-10-25T22:30:00Z'), 180)).toEqual({
      date: '2026-10-26', time: '01:30', dateTime: '2026-10-26T01:30',
    });
  });
  it('shifts backward across midnight with a negative offset', () => {
    expect(toShipLocal(new Date('2026-10-25T01:15:00Z'), -570)).toEqual({
      date: '2026-10-24', time: '15:45', dateTime: '2026-10-24T15:45',
    });
  });
  it('handles a retard across midnight', () => {
    // local 00:30 on 26 Oct at +3 is 21:30Z; retard to +2 at that instant
    const t = new Date('2026-10-25T21:30:00Z');
    const changes = [cc('2026-10-01T00:00:00.000Z', 180), cc(t.toISOString(), 120)];
    expect(toShipLocal(t, shipOffsetAt(changes, t))).toMatchObject({ date: '2026-10-25', time: '23:30' });
  });
});

describe('shipLocalToInstant', () => {
  it('converts ship local date-time to a UTC instant', () => {
    expect(shipLocalToInstant('2026-10-26T02:00', 180).toISOString()).toBe('2026-10-25T23:00:00.000Z');
  });
  it('handles a negative offset and a date rollover', () => {
    expect(shipLocalToInstant('2026-10-24T20:00', -330).toISOString()).toBe('2026-10-25T01:30:00.000Z');
  });
  it('round-trips with toShipLocal', () => {
    const instant = new Date('2026-03-01T04:45:00.000Z');
    expect(shipLocalToInstant(toShipLocal(instant, 345).dateTime, 345).toISOString()).toBe(instant.toISOString());
  });
});

describe('nextScheduledChange', () => {
  const c1 = cc('2026-10-20T00:00:00.000Z', 60);
  const c2 = cc('2026-10-24T23:00:00.000Z', 120);

  it('returns the next change after now', () => {
    expect(nextScheduledChange([c1, c2], new Date('2026-10-22T00:00:00Z'))?.id).toBe(c2.id);
  });
  it('is undefined when nothing is in the future', () => {
    expect(nextScheduledChange([c1, c2], new Date('2026-10-25T00:00:00Z'))).toBeUndefined();
  });
  it('is strictly after now: a change effective exactly now is not scheduled', () => {
    expect(nextScheduledChange([c1, c2], new Date('2026-10-24T23:00:00Z'))).toBeUndefined();
  });
  it('returns the earliest of several future changes, whatever the order', () => {
    const c3 = cc('2026-10-27T00:00:00.000Z', 180);
    expect(nextScheduledChange([c3, c2, c1], new Date('2026-10-19T00:00:00Z'))?.id).toBe(c1.id);
    expect(nextScheduledChange([c3, c2], new Date('2026-10-19T00:00:00Z'))?.id).toBe(c2.id);
  });
  it('ignores deleted changes', () => {
    expect(nextScheduledChange([{ ...c2, deleted: true }], new Date('2026-10-22T00:00:00Z'))).toBeUndefined();
  });
});

describe('deviceOffsetMinutes', () => {
  it('is a valid offset on the 15-minute grid', () => {
    const offset = deviceOffsetMinutes();
    expect(Number.isInteger(offset / 15)).toBe(true);
    expect(isValidOffset(offset)).toBe(true);
  });
});

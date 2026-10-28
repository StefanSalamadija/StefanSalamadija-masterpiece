import { describe, expect, it } from 'vitest';
import {
  OFFSET_OPTIONS,
  deviceOffsetMinutes,
  formatOffset,
  isValidOffset,
  liveChanges,
  nextScheduledChange,
  resolveShipLocal,
  shipLocalToInstant,
  shipOffsetAt,
  stepOffset,
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

describe('shipOffsetAt, changes with the same effectiveAt and createdAt', () => {
  // Two devices (or two quick taps) can write at the same millisecond: the winner must not depend on the order read.
  const at = '2026-10-24T00:00:00.000Z';
  const a = { ...cc(at, 60), id: 'aaa' };
  const b = { ...cc(at, 120), id: 'bbb' };

  it('is decided by id, so every device and every reading order agrees', () => {
    const now = new Date('2026-10-25T00:00:00Z');
    expect(shipOffsetAt([a, b], now)).toBe(120);
    expect(shipOffsetAt([b, a], now)).toBe(120);
  });
  it('orders them the same way in liveChanges', () => {
    expect(liveChanges([b, a]).map((c) => c.id)).toEqual(['aaa', 'bbb']);
  });
});

describe('liveChanges', () => {
  it('drops deleted changes and puts the rest earliest first, ties by createdAt', () => {
    const late = cc('2026-10-24T00:00:00.000Z', 60, '2026-10-02T00:00:00.000Z');
    const early = cc('2026-10-24T00:00:00.000Z', 120, '2026-10-01T00:00:00.000Z');
    const first = cc('2026-10-20T00:00:00.000Z', 180);
    const gone = { ...cc('2026-10-21T00:00:00.000Z', 240), deleted: true };
    expect(liveChanges([late, gone, first, early])).toEqual([first, early, late]);
  });
  it('does not change the list it is given', () => {
    const list = [cc('2026-10-24T00:00:00.000Z', 60), cc('2026-10-20T00:00:00.000Z', 120)];
    const copy = [...list];
    liveChanges(list);
    expect(list).toEqual(copy);
  });
});

describe('stepOffset', () => {
  it('moves by the step', () => {
    expect(stepOffset(180, 60)).toBe(240);
    expect(stepOffset(180, -60)).toBe(120);
    expect(stepOffset(-30, 60)).toBe(30);
    expect(stepOffset(330, 60)).toBe(390);
  });
  it('stops at the ends of the range instead of leaving it', () => {
    expect(stepOffset(840, 60)).toBe(840);
    expect(stepOffset(810, 60)).toBe(840);
    expect(stepOffset(-720, -60)).toBe(-720);
    expect(stepOffset(-690, -60)).toBe(-720);
  });
  it('gives an offset that is always valid', () => {
    expect(OFFSET_OPTIONS.every((o) => isValidOffset(stepOffset(o, 60)) && isValidOffset(stepOffset(o, -60)))).toBe(true);
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

describe('resolveShipLocal', () => {
  const at = (dateTime: string, changes: ClockChange[]) => {
    const found = resolveShipLocal(changes, dateTime);
    if (found.kind !== 'at') throw new Error(`expected a time on board, got ${JSON.stringify(found)}`);
    return { instant: found.instant.toISOString(), offsetMinutes: found.offsetMinutes };
  };
  // The ship went to +03:00 at 08:00Z on the 25th.
  const first = () => cc('2026-10-25T08:00:00.000Z', 180);

  describe('with nothing scheduled', () => {
    it('reads the time with the offset the ship is on, like shipLocalToInstant', () => {
      const changes = [first()];
      expect(at('2026-10-26T02:00', changes)).toEqual({ instant: '2026-10-25T23:00:00.000Z', offsetMinutes: 180 });
      expect(at('2026-10-26T02:00', changes).instant).toBe(shipLocalToInstant('2026-10-26T02:00', 180).toISOString());
    });
    it('reads the time with the offset of the last change, however many there are', () => {
      const changes = [first(), cc('2026-10-25T09:00:00.000Z', 240), cc('2026-10-25T10:00:00.000Z', 300)];
      expect(at('2026-10-26T02:00', changes)).toEqual({ instant: '2026-10-25T21:00:00.000Z', offsetMinutes: 300 });
    });
    it('is UTC for a ship that has no changes at all', () => {
      expect(at('2026-10-26T02:00', [])).toEqual({ instant: '2026-10-26T02:00:00.000Z', offsetMinutes: 0 });
    });
    it("reads a time before the first change with the first change's offset, as shipOffsetAt does", () => {
      expect(at('2026-10-20T12:00', [first()])).toEqual({ instant: '2026-10-20T09:00:00.000Z', offsetMinutes: 180 });
    });
  });

  describe('with changes scheduled', () => {
    // At 21:00Z on the 25th the clocks go from 00:00 (+03:00) to 01:00 (+04:00).
    const advance = () => cc('2026-10-25T21:00:00.000Z', 240);

    it('reads a time after the scheduled change with the offset that will be in effect then', () => {
      // 02:00 on the 26th comes at 22:00Z, an hour after the clocks moved: not at 23:00Z, which is 03:00 on board.
      const found = at('2026-10-26T02:00', [first(), advance()]);
      expect(found).toEqual({ instant: '2026-10-25T22:00:00.000Z', offsetMinutes: 240 });
      expect(toShipLocal(new Date(found.instant), 240).dateTime).toBe('2026-10-26T02:00');
    });
    it('reads a time before the scheduled change with the offset in effect until then', () => {
      expect(at('2026-10-25T23:59', [first(), advance()])).toEqual({ instant: '2026-10-25T20:59:00.000Z', offsetMinutes: 180 });
    });
    it('is the first time shown after the clocks move, 01:00, in the new offset', () => {
      expect(at('2026-10-26T01:00', [first(), advance()])).toEqual({ instant: '2026-10-25T21:00:00.000Z', offsetMinutes: 240 });
    });
    it('does not depend on the order of the changes', () => {
      expect(at('2026-10-26T02:00', [advance(), first()]).instant).toBe('2026-10-25T22:00:00.000Z');
    });
    it('follows several scheduled changes one after the other', () => {
      // +03:00 → +04:00 at 21:00Z, → +05:00 at 22:00Z (clocks 02:00 → 03:00).
      const changes = [first(), advance(), cc('2026-10-25T22:00:00.000Z', 300)];
      expect(at('2026-10-26T03:00', changes)).toEqual({ instant: '2026-10-25T22:00:00.000Z', offsetMinutes: 300 });
      expect(at('2026-10-26T04:00', changes)).toEqual({ instant: '2026-10-25T23:00:00.000Z', offsetMinutes: 300 });
      expect(at('2026-10-26T01:30', changes)).toEqual({ instant: '2026-10-25T21:30:00.000Z', offsetMinutes: 240 });
    });
    it('ignores a cancelled change', () => {
      expect(at('2026-10-26T02:00', [first(), { ...advance(), deleted: true }]).instant).toBe('2026-10-25T23:00:00.000Z');
    });
    it('lets the change made later win when two take effect at the same instant', () => {
      const a = cc('2026-10-25T21:00:00.000Z', 240, '2026-10-25T09:00:00.100Z');
      const b = cc('2026-10-25T21:00:00.000Z', 300, '2026-10-25T09:00:00.200Z');
      expect(at('2026-10-26T03:00', [first(), b, a])).toEqual({ instant: '2026-10-25T22:00:00.000Z', offsetMinutes: 300 });
      expect(at('2026-10-26T03:00', [first(), a, b])).toEqual({ instant: '2026-10-25T22:00:00.000Z', offsetMinutes: 300 });
    });
  });

  describe('a time the clocks skip (an advance)', () => {
    const advance = () => cc('2026-10-25T21:00:00.000Z', 240);   // 00:00 → 01:00 on the 26th

    it('does not exist on board, and says when the clocks go forward', () => {
      for (const skipped of ['2026-10-26T00:00', '2026-10-26T00:30', '2026-10-26T00:59']) {
        expect(resolveShipLocal([first(), advance()], skipped)).toEqual({ kind: 'skipped', clocksForwardAt: '00:00', offsetMinutes: 180 });
      }
    });
    it('is only the hour that is skipped: the minute before, and 01:00 itself, are fine', () => {
      expect(resolveShipLocal([first(), advance()], '2026-10-25T23:59').kind).toBe('at');
      expect(resolveShipLocal([first(), advance()], '2026-10-26T01:00').kind).toBe('at');
    });
    it('names the time on the clocks when they were moved, in the offset before the move', () => {
      // A two hour advance at 21:30Z (00:30 at +03:00) to +05:00: 00:30 to 02:30 never shows.
      const changes = [first(), cc('2026-10-25T21:30:00.000Z', 300)];
      expect(resolveShipLocal(changes, '2026-10-26T01:45')).toEqual({ kind: 'skipped', clocksForwardAt: '00:30', offsetMinutes: 180 });
      expect(resolveShipLocal(changes, '2026-10-26T02:30').kind).toBe('at');
    });
  });

  describe('a time the clocks repeat (a retard)', () => {
    const start = () => cc('2026-10-25T08:00:00.000Z', 240);
    const retard = () => cc('2026-10-25T21:00:00.000Z', 180);   // 01:00 → 00:00 on the 26th, from +04:00 to +03:00

    it('takes the first time it shows', () => {
      // 00:30 shows at 20:30Z (+04:00) and again at 21:30Z (+03:00).
      expect(at('2026-10-26T00:30', [start(), retard()])).toEqual({ instant: '2026-10-25T20:30:00.000Z', offsetMinutes: 240 });
    });
    it('takes the first time for the whole repeated hour, 00:00 up to 00:59', () => {
      expect(at('2026-10-26T00:00', [start(), retard()]).instant).toBe('2026-10-25T20:00:00.000Z');
      expect(at('2026-10-26T00:59', [start(), retard()]).instant).toBe('2026-10-25T20:59:00.000Z');
    });
    it('reads a time after the repeated hour only once, at the new offset', () => {
      expect(at('2026-10-26T01:00', [start(), retard()])).toEqual({ instant: '2026-10-25T22:00:00.000Z', offsetMinutes: 180 });
    });
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

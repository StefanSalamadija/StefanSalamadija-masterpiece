import { describe, expect, it } from 'vitest';
import { msUntilNextTick } from './tick';

describe('msUntilNextTick', () => {
  const T = Date.parse('2026-10-25T09:00:00.000Z');

  it('waits for the next 30-second mark of the wall clock', () => {
    expect(msUntilNextTick(T + 10_250, 30_000)).toBe(19_750);
    expect(msUntilNextTick(T + 29_999, 30_000)).toBe(1);
    expect(msUntilNextTick(T + 45_000, 30_000)).toBe(15_000);
  });

  it('waits a whole step when it is exactly on a mark, so it never fires twice at once', () => {
    expect(msUntilNextTick(T, 30_000)).toBe(30_000);
    expect(msUntilNextTick(T + 30_000, 30_000)).toBe(30_000);
  });
});

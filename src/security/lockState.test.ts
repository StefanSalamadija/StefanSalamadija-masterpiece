import { describe, expect, it } from 'vitest';
import type { LockoutState, PinSettings } from '../domain/types';
import { DEFAULT_RELOCK_MINUTES, FULL_LOCK_MS, evaluateLockout, relockMinutesOf } from './lockState';
import { lockRemainingMs, registerFailure } from './pin';

const t0 = new Date('2026-10-25T12:00:00Z');
const after = (ms: number): string => new Date(t0.getTime() + ms).toISOString();

describe('evaluateLockout', () => {
  it('leaves a state with no lock exactly as it is, and says nothing is to be saved', () => {
    const s: LockoutState = { failures: 3 };
    const view = evaluateLockout(s, t0);
    expect(view.state).toBe(s);
    expect(view.remainingMs).toBe(0);
    expect(view.persist).toBe(false);
  });

  it('counts down an active lock', () => {
    const s: LockoutState = { failures: 5, lockedUntil: after(30_000) };
    expect(evaluateLockout(s, t0).remainingMs).toBe(30_000);
    expect(evaluateLockout(s, new Date(t0.getTime() + 12_345)).remainingMs).toBe(17_655);
    expect(evaluateLockout(s, new Date(t0.getTime() + 30_000)).remainingMs).toBe(0);
    expect(evaluateLockout(s, t0).persist).toBe(false);
  });

  it('treats an end of lock that has passed as not locked', () => {
    expect(evaluateLockout({ failures: 5, lockedUntil: after(-1) }, t0)).toMatchObject({ remainingMs: 0, persist: false });
  });

  it('moves a lock that is further away than the longest one to 300 s from now, and says to save it, before the countdown is taken', () => {
    const fast = new Date(t0.getTime() + 6 * 3600_000);
    const s = registerFailure({ failures: 6 }, fast); // taken while the clock was 6 h fast
    const view = evaluateLockout(s, t0);
    expect(view.state).toEqual({ failures: 7, lockedUntil: after(300_000) });
    expect(view.remainingMs).toBe(300_000);
    expect(view.persist).toBe(true);
    // Once saved, the same state needs no further change.
    expect(evaluateLockout(view.state, t0).persist).toBe(false);
  });

  describe('fails closed', () => {
    it('is locked for the full 300 s when the time now cannot be read, and saves nothing it cannot date', () => {
      const s: LockoutState = { failures: 5, lockedUntil: after(30_000) };
      const view = evaluateLockout(s, new Date('not a date'));
      expect(view.remainingMs).toBe(FULL_LOCK_MS);
      expect(view.persist).toBe(false);
    });

    it('hands back a state that is still locked when it is looked at again, even if the time now could not be read and the stored state was garbage', () => {
      const view = evaluateLockout('garbage', new Date(Number.NaN));
      expect(view).toMatchObject({ remainingMs: FULL_LOCK_MS, persist: false });
      const later = evaluateLockout(view.state, t0);
      expect(later.remainingMs).toBe(FULL_LOCK_MS);
      expect(later.persist).toBe(true);
    });

    it('is locked for the full 300 s when clampLockout itself throws (an Invalid Date goes through it)', () => {
      const view = evaluateLockout({ failures: 7, lockedUntil: after(10_000_000) }, new Date(Number.NaN));
      expect(view.remainingMs).toBe(FULL_LOCK_MS);
    });

    const unreadable: [string, unknown][] = [
      ['nothing stored', undefined],
      ['null', null],
      ['a string', 'locked'],
      ['a number', 5],
      ['an array', []],
      ['no failure count', {}],
      ['a failure count that is not a number', { failures: '5' }],
      ['a failure count that is NaN', { failures: Number.NaN }],
      ['a negative failure count', { failures: -1 }],
      ['a fractional failure count', { failures: 2.5 }],
      ['an end of lock that is not a date', { failures: 5, lockedUntil: 'garbage' }],
      ['an end of lock that is empty', { failures: 5, lockedUntil: '' }],
      ['an end of lock that is a number', { failures: 5, lockedUntil: 12345 }],
      ['an end of lock that is null', { failures: 5, lockedUntil: null }],
    ];

    it.each(unreadable)('locks for the full 300 s from now, and says to save it, for %s', (_name, stored) => {
      const view = evaluateLockout(stored, t0);
      expect(view.remainingMs).toBe(FULL_LOCK_MS);
      expect(view.persist).toBe(true);
      expect(view.state.lockedUntil).toBe(after(FULL_LOCK_MS));
      // The repaired state is a normal one: the 300 s level, so the next wrong passcode locks for 300 s again.
      expect(view.state.failures).toBeGreaterThanOrEqual(7);
      expect(lockRemainingMs(view.state, t0)).toBe(FULL_LOCK_MS);
      expect(registerFailure(view.state, t0).lockedUntil).toBe(after(FULL_LOCK_MS));
    });

    it('keeps a failure count that is higher than the 300 s level', () => {
      expect(evaluateLockout({ failures: 12, lockedUntil: 'garbage' }, t0).state.failures).toBe(12);
    });

    it('never unlocks: no input at all gives zero time remaining while the time now is readable', () => {
      for (const [, stored] of unreadable) expect(evaluateLockout(stored, t0).remainingMs).toBeGreaterThan(0);
    });
  });
});

describe('relockMinutesOf', () => {
  const pin = (relockMinutes: unknown): PinSettings =>
    ({ hash: { salt: '', hash: '', iterations: 1 }, relockMinutes, lockout: { failures: 0 } }) as PinSettings;

  it('is the stored number of minutes', () => {
    expect(DEFAULT_RELOCK_MINUTES).toBe(5);
    expect(relockMinutesOf(pin(5))).toBe(5);
    expect(relockMinutesOf(pin(0))).toBe(0);
    expect(relockMinutesOf(pin(30))).toBe(30);
  });

  it('is the default when the stored value cannot be used, so that a bad value never means never locking', () => {
    for (const bad of [undefined, null, 'five', Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      expect(relockMinutesOf(pin(bad))).toBe(DEFAULT_RELOCK_MINUTES);
    }
  });
});

import { describe, expect, it } from 'vitest';
import {
  clampLockout, constantTimeEqual, hashPin, isValidPin, lockRemainingMs, registerFailure, registerSuccess, shouldRelock, verifyPin,
} from './pin';
import type { LockoutState, PinHash } from '../domain/types';

const FAST = { iterations: 1000 };
const t0 = new Date('2026-10-25T12:00:00Z');

describe('isValidPin', () => {
  it('accepts exactly four digits', () => {
    expect(isValidPin('2580')).toBe(true);
    expect(isValidPin('0000')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(['123', '12345', '12a4', '', ' 258', '2580 ', '2580\n', '٢٥٨٠'].some(isValidPin)).toBe(false);
  });
});

describe('hashPin / verifyPin', () => {
  it('verifies the right passcode and refuses a wrong one', async () => {
    const h = await hashPin('2580', FAST);
    expect(await verifyPin('2580', h)).toBe(true);
    expect(await verifyPin('2581', h)).toBe(false);
  });

  it('uses a fresh random salt each time', async () => {
    const a = await hashPin('2580', FAST);
    const b = await hashPin('2580', FAST);
    expect(b.salt).not.toBe(a.salt);
    expect(b.hash).not.toBe(a.hash);
  });

  it('records PBKDF2 parameters: 100000 iterations by default, 16-byte salt, 32-byte hash', async () => {
    const h = await hashPin('2580');
    expect(h.iterations).toBe(100_000);
    expect(atob(h.salt)).toHaveLength(16);
    expect(atob(h.hash)).toHaveLength(32);
    expect(await verifyPin('2580', h)).toBe(true);
  });

  it('is PBKDF2-SHA-256 over the passcode text with the stored salt and iteration count', async () => {
    const h = await hashPin('2580', FAST);
    const { subtle } = globalThis.crypto;
    const salt = Uint8Array.from(atob(h.salt), (c) => c.charCodeAt(0));
    const material = await subtle.importKey('raw', new TextEncoder().encode('2580'), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 1000 }, material, 256));
    expect(h.hash).toBe(btoa(String.fromCharCode(...bits)));
  });

  it('refuses to hash anything but exactly four digits', async () => {
    for (const pin of ['', '123', '12345', '12a4', ' 258', '2580 ', '2580\n']) {
      await expect(hashPin(pin, FAST)).rejects.toThrow('Passcode must be exactly 4 digits');
    }
  });

  it('answers false, never throws, for a stored hash that cannot be used', async () => {
    const good = await hashPin('2580', FAST);
    const broken: PinHash[] = [
      { ...good, iterations: 0 },
      { ...good, salt: '%%%not base64%%%' },
      { ...good, hash: '' },
    ];
    for (const h of broken) expect(await verifyPin('2580', h)).toBe(false);
  });
});

describe('constantTimeEqual', () => {
  it('compares contents, and different lengths are never equal', () => {
    expect(constantTimeEqual(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 3))).toBe(true);
    expect(constantTimeEqual(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 4))).toBe(false);
    expect(constantTimeEqual(Uint8Array.of(9, 2, 3), Uint8Array.of(1, 2, 3))).toBe(false);
    expect(constantTimeEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 2, 3))).toBe(false);
    expect(constantTimeEqual(new Uint8Array(0), new Uint8Array(0))).toBe(true);
  });
});

describe('lockout', () => {
  it('locks from the 5th wrong passcode: 30 s, then 60 s, then 300 s', () => {
    let s: LockoutState = { failures: 0 };
    for (let i = 0; i < 4; i++) s = registerFailure(s, t0);
    expect(s.failures).toBe(4);
    expect(lockRemainingMs(s, t0)).toBe(0);
    s = registerFailure(s, t0); expect(lockRemainingMs(s, t0)).toBe(30_000);
    s = registerFailure(s, t0); expect(lockRemainingMs(s, t0)).toBe(60_000);
    s = registerFailure(s, t0); expect(lockRemainingMs(s, t0)).toBe(300_000);
    s = registerFailure(s, t0); expect(lockRemainingMs(s, t0)).toBe(300_000);
    expect(s.failures).toBe(8);
    expect(lockRemainingMs(s, new Date(t0.getTime() + 300_001))).toBe(0);
  });

  it('counts down and stores the end of the lock as an ISO instant', () => {
    let s: LockoutState = { failures: 4 };
    s = registerFailure(s, t0);
    expect(s.lockedUntil).toBe('2026-10-25T12:00:30.000Z');
    expect(lockRemainingMs(s, new Date(t0.getTime() + 10_000))).toBe(20_000);
    expect(lockRemainingMs(s, new Date(t0.getTime() + 30_000))).toBe(0);
  });

  it('does not mutate the state it was given', () => {
    const s: LockoutState = { failures: 4 };
    registerFailure(s, t0);
    expect(s).toEqual({ failures: 4 });
  });

  it('a lock taken while the clock was 6 h fast ends 300 s after the clock is corrected, once clampLockout is applied', () => {
    const fast = new Date(t0.getTime() + 6 * 3600_000);
    let s: LockoutState = { failures: 6 };
    s = registerFailure(s, fast);
    expect(lockRemainingMs(s, fast)).toBe(300_000);
    // The clock is corrected: the stored end of lock is now hours away.
    expect(lockRemainingMs(s, t0)).toBe(6 * 3600_000 + 300_000);
    s = clampLockout(s, t0);
    expect(s.failures).toBe(7);
    expect(lockRemainingMs(s, t0)).toBe(300_000);
    expect(lockRemainingMs(s, new Date(t0.getTime() + 299_999))).toBe(1);
    expect(lockRemainingMs(s, new Date(t0.getTime() + 300_000))).toBe(0);
  });

  describe('clampLockout', () => {
    it('leaves a lock that is at most the longest lock away exactly as it is', () => {
      for (const ms of [1, 30_000, 299_999, 300_000]) {
        const s: LockoutState = { failures: 7, lockedUntil: new Date(t0.getTime() + ms).toISOString() };
        expect(clampLockout(s, t0)).toBe(s);
      }
    });

    it('moves the end of a lock that is further away to 300 s from now, keeping the failure count', () => {
      const s: LockoutState = { failures: 9, lockedUntil: new Date(t0.getTime() + 300_001).toISOString() };
      expect(clampLockout(s, t0)).toEqual({ failures: 9, lockedUntil: '2026-10-25T12:05:00.000Z' });
      expect(s.lockedUntil).toBe('2026-10-25T12:05:00.001Z');
    });

    it('leaves a state with no lock, an expired lock or an unreadable end of lock unchanged', () => {
      const none: LockoutState = { failures: 3 };
      const expired: LockoutState = { failures: 5, lockedUntil: new Date(t0.getTime() - 1000).toISOString() };
      const garbage: LockoutState = { failures: 5, lockedUntil: 'garbage' };
      expect(clampLockout(none, t0)).toBe(none);
      expect(clampLockout(expired, t0)).toBe(expired);
      expect(clampLockout(garbage, t0)).toBe(garbage);
    });
  });

  it('treats a missing or unreadable end of lock as not locked', () => {
    expect(lockRemainingMs({ failures: 3 }, t0)).toBe(0);
    expect(lockRemainingMs({ failures: 5, lockedUntil: 'garbage' }, t0)).toBe(0);
  });

  it('a success clears everything', () => {
    expect(registerSuccess()).toEqual({ failures: 0 });
  });
});

describe('shouldRelock', () => {
  it('relocks only once the app has been hidden for more than the chosen minutes', () => {
    expect(shouldRelock('2026-10-25T12:00:00.000Z', new Date('2026-10-25T12:04:00Z'), 5)).toBe(false);
    expect(shouldRelock('2026-10-25T12:00:00.000Z', new Date('2026-10-25T12:05:00Z'), 5)).toBe(false);
    expect(shouldRelock('2026-10-25T12:00:00.000Z', new Date('2026-10-25T12:06:00Z'), 5)).toBe(true);
  });

  it('does not relock an app that was never hidden', () => {
    expect(shouldRelock(undefined, t0, 5)).toBe(false);
  });

  it('relocks when the hidden time cannot be read', () => {
    expect(shouldRelock('not a date', t0, 5)).toBe(true);
  });
});

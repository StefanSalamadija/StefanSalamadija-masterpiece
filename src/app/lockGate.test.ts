import { describe, expect, it } from 'vitest';
import type { PinSettings } from '../domain/types';
import { gateScreen, relockDue } from './lockGate';

const base = { hasShip: true, hasPin: true, locked: true, lockPrompted: undefined as boolean | undefined };

describe('gateScreen', () => {
  it('shows the welcome screen, never the lock, while there is no ship', () => {
    expect(gateScreen({ ...base, hasShip: false })).toBe('welcome');
    expect(gateScreen({ ...base, hasShip: false, hasPin: false, locked: false })).toBe('welcome');
  });

  it('shows the lock, and nothing of the app, while the app is locked', () => {
    expect(gateScreen(base)).toBe('lock');
    // The lock comes before the protect step and before the app.
    expect(gateScreen({ ...base, lockPrompted: false })).toBe('lock');
  });

  it('shows the app once it is unlocked', () => {
    expect(gateScreen({ ...base, locked: false })).toBe('app');
  });

  it('is not locked when no passcode is set, whatever the in-memory flag says', () => {
    expect(gateScreen({ ...base, hasPin: false, locked: true, lockPrompted: true })).toBe('app');
  });

  it('offers the protect step when a ship exists, no lock is set and it has not been answered (lockPrompted not true)', () => {
    for (const lockPrompted of [undefined, false]) {
      expect(gateScreen({ ...base, hasPin: false, locked: false, lockPrompted })).toBe('protect');
    }
    // Also when the in-memory flag still says locked (a passcode that was removed).
    expect(gateScreen({ ...base, hasPin: false, locked: true, lockPrompted: undefined })).toBe('protect');
  });

  it('does not offer it again once answered', () => {
    expect(gateScreen({ ...base, hasPin: false, locked: false, lockPrompted: true })).toBe('app');
  });

  it('never offers it with a ship missing, and never with a passcode set', () => {
    expect(gateScreen({ ...base, hasShip: false, hasPin: false, locked: false, lockPrompted: undefined })).toBe('welcome');
    expect(gateScreen({ ...base, hasPin: true, locked: false, lockPrompted: undefined })).toBe('app');
  });
});

describe('relockDue', () => {
  const pin = (relockMinutes: number): PinSettings =>
    ({ hash: { salt: '', hash: '', iterations: 1 }, relockMinutes, lockout: { failures: 0 } });
  const hiddenAt = '2026-10-25T09:00:00.000Z';
  const later = (minutes: number): Date => new Date(Date.parse(hiddenAt) + minutes * 60_000);

  it('is true once the app has been in the background for longer than the lock time', () => {
    expect(relockDue(pin(5), hiddenAt, later(6))).toBe(true);
    expect(relockDue(pin(5), hiddenAt, later(5.01))).toBe(true);
  });

  it('is false up to and including the lock time', () => {
    expect(relockDue(pin(5), hiddenAt, later(4))).toBe(false);
    expect(relockDue(pin(5), hiddenAt, later(5))).toBe(false);
  });

  it('is false when the app was never hidden, and when there is no passcode', () => {
    expect(relockDue(pin(5), undefined, later(60))).toBe(false);
    expect(relockDue(undefined, hiddenAt, later(60))).toBe(false);
  });

  it('is true for a time that cannot be read (stay locked)', () => {
    expect(relockDue(pin(5), 'garbage', later(1))).toBe(true);
  });

  it('uses 5 minutes when the stored lock time is unusable, never "never"', () => {
    const broken = { ...pin(5), relockMinutes: Number.NaN };
    expect(relockDue(broken, hiddenAt, later(6))).toBe(true);
    expect(relockDue(broken, hiddenAt, later(4))).toBe(false);
  });

  it('locks at once on return with a lock time of 0', () => {
    expect(relockDue(pin(0), hiddenAt, later(0.01))).toBe(true);
  });

  describe('when the clock was changed while the app was in the background', () => {
    it('is true when the clock now reads earlier than when the app was hidden (set back to hide a long absence)', () => {
      expect(relockDue(pin(5), hiddenAt, later(-1))).toBe(true);
      expect(relockDue(pin(5), hiddenAt, later(-30))).toBe(true);
      expect(relockDue(pin(5), hiddenAt, later(0))).toBe(false); // no time at all has passed
    });

    const mono = (hidden: number, now: number) => ({ hiddenAt: hidden, now });

    it('is true when the monotonic time says the lock time has passed, whatever the wall clock says', () => {
      // 30 minutes in the background and the wall clock then set back to 1 minute after hiding.
      expect(relockDue(pin(5), hiddenAt, later(1), mono(1_000, 1_000 + 30 * 60_000))).toBe(true);
    });

    it('is true when the wall clock says it, even if the monotonic clock did not run while the device slept', () => {
      expect(relockDue(pin(5), hiddenAt, later(30), mono(1_000, 1_000 + 2_000))).toBe(true);
    });

    it('is false when both clocks agree that the lock time has not passed', () => {
      expect(relockDue(pin(5), hiddenAt, later(4), mono(1_000, 1_000 + 4 * 60_000))).toBe(false);
      expect(relockDue(pin(5), hiddenAt, later(5), mono(1_000, 1_000 + 5 * 60_000))).toBe(false);
    });

    it('is true when the monotonic time cannot be read or runs backwards (stay locked)', () => {
      expect(relockDue(pin(5), hiddenAt, later(1), mono(Number.NaN, 5))).toBe(true);
      expect(relockDue(pin(5), hiddenAt, later(1), mono(5_000, 1_000))).toBe(true);
    });

    it('leaves the monotonic time out of it when there is none, and when the app was never hidden or has no passcode', () => {
      expect(relockDue(pin(5), hiddenAt, later(4), undefined)).toBe(false);
      expect(relockDue(pin(5), undefined, later(60), mono(1_000, 1_000 + 60 * 60_000))).toBe(false);
      expect(relockDue(undefined, hiddenAt, later(60), mono(1_000, 1_000 + 60 * 60_000))).toBe(false);
    });
  });

  it('keeps the app locked, not open, for a damaged passcode setting', () => {
    expect(relockDue(null as unknown as PinSettings, hiddenAt, later(60))).toBe(false); // no setting at all: nothing to lock by
    expect(() => relockDue('x' as unknown as PinSettings, hiddenAt, later(60))).not.toThrow();
  });
});

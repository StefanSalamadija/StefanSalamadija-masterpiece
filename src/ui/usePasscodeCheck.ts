import { useEffect, useRef, useState } from 'preact/hooks';
import { reportError } from '../app/errors';
import type { MasterpieceDB } from '../db/schema';
import type { PinSettings } from '../domain/types';
import { saveLockout } from '../security/appLock';
import { evaluateLockout } from '../security/lockState';
import type { LockoutView } from '../security/lockState';
import { registerFailure, registerSuccess, verifyPin } from '../security/pin';

const COUNTDOWN_STEP_MS = 1000;

/** `ignored`: a check was already running. */
export type CheckResult = 'right' | 'wrong' | 'locked' | 'ignored';

export interface PasscodeCheck {
  /** The lockout once it has been looked at and saved; `undefined` until then, so no passcode is taken before. */
  lockout: LockoutView | undefined;
  /** Another passcode may not be tried yet. The countdown is `lockout.remainingMs`; it is kept up to date every second. */
  lockedOut: boolean;
  /** A passcode is being checked. */
  checking: boolean;
  /**
   * Checks a passcode against the saved one, with the lockout every passcode check shares. The lockout is looked at (and
   * saved if it had to be repaired) first; while it is on, nothing is tried (`locked`). A wrong passcode is counted and
   * the count saved before `wrong` (or `locked`, when it was the one that started a lock) is returned. A right one
   * clears the failures, saved, and returns `right`.
   */
  check: (entered: string) => Promise<CheckResult>;
  /** The person was let in some other way (the fingerprint): the failures are cleared, saved. */
  recordSuccess: () => Promise<void>;
}

/**
 * The passcode check of the lock screen and of the Settings confirmation: one lockout, saved in `settings.pin.lockout`, so
 * a wrong passcode typed in Settings counts against the lock screen and a reload gives nothing back. It fails closed: a
 * lockout that cannot be read is the longest lock (see `evaluateLockout`).
 */
export function usePasscodeCheck(db: MasterpieceDB, pin: PinSettings): PasscodeCheck {
  const [lockout, setLockout] = useState<LockoutView>();
  const [checking, setChecking] = useState(false);
  const alive = useRef(true);
  const stored = useRef<unknown>(pin.lockout);
  const latestPin = useRef(pin);
  latestPin.current = pin;
  // Set at once, where the state is only seen by the next render: a second try in between must not start a second check.
  const checkingNow = useRef(false);

  useEffect(() => () => {
    alive.current = false;
  }, []);

  /** Looks at the lockout now, saves it if it had to be repaired or cut short, and only then lets the countdown show. */
  async function settle(): Promise<LockoutView> {
    const next = evaluateLockout(stored.current, new Date());
    if (next.persist) {
      stored.current = next.state;
      try {
        await saveLockout(db, next.state);
      } catch (err) {
        reportError(err); // the lock holds in memory all the same
      }
    }
    if (alive.current) setLockout(next);
    return next;
  }

  async function recordSuccess(): Promise<void> {
    const cleared = registerSuccess();
    stored.current = cleared;
    try {
      await saveLockout(db, cleared);
    } catch (err) {
      reportError(err); // the way in was right; failing to forget the failures must not keep the person out
    }
  }

  async function check(entered: string): Promise<CheckResult> {
    if (checkingNow.current) return 'ignored';
    checkingNow.current = true;
    setChecking(true);
    try {
      const before = await settle();
      if (before.remainingMs > 0) return 'locked';
      if (await verifyPin(entered, latestPin.current.hash)) {
        await recordSuccess();
        return 'right';
      }
      const at = new Date();
      const failed = registerFailure(before.state, at);
      stored.current = failed;
      try {
        await saveLockout(db, failed); // saved before the result is shown
      } catch (err) {
        reportError(err);
      }
      const now = evaluateLockout(failed, at);
      if (alive.current) setLockout(now);
      return now.remainingMs > 0 ? 'locked' : 'wrong';
    } finally {
      checkingNow.current = false;
      if (alive.current) setChecking(false);
    }
  }

  // Once, on opening.
  useEffect(() => {
    void settle();
  }, []);

  const lockedOut = lockout !== undefined && lockout.remainingMs > 0;
  useEffect(() => {
    if (!lockedOut) return;
    const timer = window.setInterval(() => void settle(), COUNTDOWN_STEP_MS);
    return () => window.clearInterval(timer);
  }, [lockedOut]);

  return { lockout, lockedOut, checking, check, recordSuccess };
}

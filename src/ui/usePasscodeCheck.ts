import { useEffect, useRef, useState } from 'preact/hooks';
import { reportError } from '../app/errors';
import type { MasterpieceDB } from '../db/schema';
import type { PinSettings } from '../domain/types';
import { registerPasscodeFailure, registerPasscodeSuccess, saveLockout, settleLockout } from '../security/appLock';
import { FULL_LOCK_MS, evaluateLockout } from '../security/lockState';
import { registerSuccess, verifyPin } from '../security/pin';
import { LOCK_ENDED_ANNOUNCEMENT, lockStartedAnnouncement } from './lockView';

const COUNTDOWN_STEP_MS = 1000;

/** `ignored`: a check was already running. */
export type CheckResult = 'right' | 'wrong' | 'locked' | 'ignored';

export interface PasscodeCheck {
  /** The stored lockout has been looked at (and saved if it had to be repaired); no passcode is taken before. */
  ready: boolean;
  /** Another passcode may not be tried yet. */
  lockedOut: boolean;
  /** Milliseconds until another passcode may be tried (0 when not locked out). Kept up to date every second while locked out. */
  remainingMs: number;
  /** The lock is one held in memory only, because a wrong passcode could not be saved: it is the longest lock. */
  unsaved: boolean;
  /** A passcode is being checked. */
  checking: boolean;
  /** Said once to a screen reader when a lock starts and when it ends; empty before. Show it in a visually hidden polite live region. */
  announcement: string;
  /**
   * Checks a passcode against the saved one, with the lockout every passcode check shares, in every tab. The stored
   * lockout is read first, so a lock that another tab has taken is seen: nothing is tried while it is on (`locked`).
   * A wrong passcode is counted against the stored lockout in one transaction and saved before `wrong` (or `locked`,
   * when it was the one that started a lock) is returned; a count that cannot be saved holds the longest lock in
   * memory (`unsaved`). A right one clears the failures, unless a lock was taken meanwhile (`locked`).
   */
  check: (entered: string) => Promise<CheckResult>;
  /** The person was let in some other way (the fingerprint): the failures are cleared, saved. */
  recordSuccess: () => Promise<void>;
}

/**
 * The passcode check of the lock screen and of the Settings confirmation: one lockout, saved in `settings.pin.lockout`,
 * shared by every screen and every tab. A tab works from the live `pin.lockout` (which follows what any tab saves) and
 * changes it only through transactions that start from what is stored at that moment, so a tab that has not looked for a
 * while can neither lose a count nor shorten a lock. It fails closed: a lockout that cannot be read is the longest
 * lock (see `evaluateLockout`).
 */
export function usePasscodeCheck(db: MasterpieceDB, pin: PinSettings): PasscodeCheck {
  const [now, setNow] = useState(() => new Date());
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  /** End of a lock held in memory because a wrong passcode could not be saved (a wall-clock instant, in ms). */
  const [unsavedUntil, setUnsavedUntil] = useState<number>();
  const alive = useRef(true);
  const latestPin = useRef(pin);
  latestPin.current = pin;
  // Set at once, where the state is only seen by the next render: a second try in between must not start a second check.
  const checkingNow = useRef(false);
  const wasLockedOut = useRef(false);

  useEffect(() => () => {
    alive.current = false;
  }, []);

  const view = evaluateLockout(pin.lockout, now);
  const unsavedMs = unsavedUntil === undefined ? 0 : Math.max(0, unsavedUntil - now.getTime());
  const remainingMs = Math.max(view.remainingMs, unsavedMs);
  const lockedOut = ready && remainingMs > 0;
  const unsaved = lockedOut && unsavedMs > 0 && unsavedMs >= view.remainingMs;

  /** Looks at what is stored now; a failure to save a repair is reported, and the lock holds in memory all the same. */
  async function settle(): Promise<void> {
    try {
      await settleLockout(db, new Date());
    } catch (err) {
      reportError(err);
    }
    if (alive.current) setNow(new Date());
  }

  // Once, on opening: the stored lockout is looked at, and saved if it had to be repaired, before any countdown shows.
  useEffect(() => {
    void settle().then(() => {
      if (alive.current) setReady(true);
    });
  }, []);

  // Another tab (or this one) has saved a lockout: take the time again, so that the countdown starts from now.
  useEffect(() => {
    setNow(new Date());
  }, [pin.lockout]);

  // A lock taken while the clock was fast, or a lockout that cannot be read: saved once as the state it is made into.
  const needsRepair = ready && view.persist;
  useEffect(() => {
    if (needsRepair) void settle();
  }, [needsRepair]);

  useEffect(() => {
    if (!lockedOut) return;
    const timer = window.setInterval(() => setNow(new Date()), COUNTDOWN_STEP_MS);
    return () => window.clearInterval(timer);
  }, [lockedOut]);

  // A screen reader hears of a lock once when it starts and once when it ends; the countdown in between is a timer.
  useEffect(() => {
    if (lockedOut) {
      wasLockedOut.current = true;
      setAnnouncement(lockStartedAnnouncement(remainingMs, unsaved));
    } else if (wasLockedOut.current) {
      wasLockedOut.current = false;
      setAnnouncement(LOCK_ENDED_ANNOUNCEMENT);
    }
  }, [lockedOut]);

  async function recordSuccess(): Promise<void> {
    try {
      await saveLockout(db, registerSuccess());
    } catch (err) {
      reportError(err); // the way in was right; failing to forget the failures must not keep the person out
    }
  }

  async function check(entered: string): Promise<CheckResult> {
    if (checkingNow.current) return 'ignored';
    checkingNow.current = true;
    setChecking(true);
    try {
      // What is stored now, not what this tab last saw: another tab may have locked the app since.
      let before = evaluateLockout(latestPin.current.lockout, new Date());
      try {
        before = await settleLockout(db, new Date());
      } catch (err) {
        reportError(err); // the lock this tab knows of still holds
      }
      if (alive.current) setNow(new Date());
      if (before.remainingMs > 0) return 'locked';

      if (await verifyPin(entered, latestPin.current.hash)) {
        let allowed = true;
        try {
          allowed = await registerPasscodeSuccess(db, new Date());
        } catch (err) {
          reportError(err); // the passcode was right; failing to forget the failures must not keep the person out
        }
        if (alive.current) setNow(new Date());
        return allowed ? 'right' : 'locked';
      }

      try {
        const after = await registerPasscodeFailure(db, new Date()); // counted and saved before the answer is given
        if (alive.current) setNow(new Date());
        return after.remainingMs > 0 ? 'locked' : 'wrong';
      } catch (err) {
        // A wrong passcode that is not counted could be tried again without end: hold the longest lock in memory instead.
        reportError(err);
        if (alive.current) {
          setUnsavedUntil(Date.now() + FULL_LOCK_MS);
          setNow(new Date());
        }
        return 'locked';
      }
    } finally {
      checkingNow.current = false;
      if (alive.current) setChecking(false);
    }
  }

  return { ready, lockedOut, remainingMs, unsaved, checking, announcement, check, recordSuccess };
}

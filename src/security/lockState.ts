/**
 * What the lock screen believes about the lockout, worked out so that it can only ever fail closed: a state that cannot
 * be read, or a time that cannot be worked with, means locked for the longest lock, never unlocked.
 */
import type { LockoutState, PinSettings } from '../domain/types';
import { clampLockout, lockRemainingMs } from './pin';

/** Relock after this many minutes in the background unless the person chose another number. */
export const DEFAULT_RELOCK_MINUTES = 5;
/** The longest lock (300 s), which is also what an unreadable state gets. */
export const FULL_LOCK_MS = 300_000;
/** The failure count at which the next wrong passcode locks for the longest time. */
const FULL_LOCK_FAILURES = 7;
/** The latest instant a Date can hold. Used as an end of lock when there is no readable time to count from: `clampLockout` cuts it to 300 s once there is one. */
const END_OF_TIME = new Date(8_640_000_000_000_000).toISOString();

export interface LockoutView {
  /** The state to go on with. Equal to the stored one unless it had to be repaired. Even when `persist` is false it never unlocks: evaluating it again later still gives a lock. */
  state: LockoutState;
  /** Milliseconds until another passcode may be tried; 0 only when the state was readable and the lock is over. */
  remainingMs: number;
  /** True when `state` differs from what was stored: the caller saves it before it shows a countdown. */
  persist: boolean;
}

function isLockoutState(value: unknown): value is LockoutState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { failures, lockedUntil } = value as Record<string, unknown>;
  if (typeof failures !== 'number' || !Number.isInteger(failures) || failures < 0) return false;
  return lockedUntil === undefined || (typeof lockedUntil === 'string' && !Number.isNaN(Date.parse(lockedUntil)));
}

function failuresOf(value: unknown): number {
  const failures = typeof value === 'object' && value !== null ? (value as { failures?: unknown }).failures : undefined;
  return typeof failures === 'number' && Number.isInteger(failures) && failures >= 0 ? failures : 0;
}

/**
 * The lockout as it stands at `now`. A lock taken while the clock was fast is cut to the longest lock first
 * (`clampLockout`), and `persist` says it has to be saved. A stored state that is not a lockout state at all, or an end of
 * lock that is not a date, is replaced by the longest lock from now. If `now` itself cannot be read, or the clamp throws,
 * the answer is the longest lock and nothing is saved.
 */
export function evaluateLockout(stored: unknown, now: Date): LockoutView {
  const failures = Math.max(failuresOf(stored), FULL_LOCK_FAILURES);
  // Nothing can be dated here, so nothing is saved; the state is one that stays locked when it is looked at again.
  const closed = (): LockoutView => ({
    state: isLockoutState(stored) ? stored : { failures, lockedUntil: END_OF_TIME },
    remainingMs: FULL_LOCK_MS,
    persist: false,
  });
  try {
    if (Number.isNaN(now.getTime())) return closed();
    if (!isLockoutState(stored)) {
      const state = { failures, lockedUntil: new Date(now.getTime() + FULL_LOCK_MS).toISOString() };
      return { state, remainingMs: FULL_LOCK_MS, persist: true };
    }
    const clamped = clampLockout(stored, now);
    return { state: clamped, remainingMs: lockRemainingMs(clamped, now), persist: clamped !== stored };
  } catch {
    return closed();
  }
}

/** Minutes in the background before the app locks again. A stored value that is not a usable number gives the default. */
export function relockMinutesOf(pin: PinSettings): number {
  const minutes: unknown = pin.relockMinutes;
  return typeof minutes === 'number' && Number.isFinite(minutes) && minutes >= 0 ? minutes : DEFAULT_RELOCK_MINUTES;
}

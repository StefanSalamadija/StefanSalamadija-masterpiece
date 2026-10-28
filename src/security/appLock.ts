/** Turning the app lock on and off, changing the passcode, and the small saves the lock screen makes. Everything here writes device settings only. */
import type { MasterpieceDB } from '../db/schema';
import { removePin, updatePin, updateSettings } from '../db/settings';
import type { FingerprintCredential, LockoutState } from '../domain/types';
import { registerFingerprint } from './fingerprint';
import { DEFAULT_RELOCK_MINUTES, evaluateLockout } from './lockState';
import type { LockoutView } from './lockState';
import { hashPin, registerFailure, registerSuccess } from './pin';

/** Asks the phone for a fingerprint key. `undefined` when it will not make one (cancelled, no sensor, an unusable key). */
async function tryRegisterFingerprint(): Promise<FingerprintCredential | undefined> {
  try {
    return await registerFingerprint();
  } catch {
    return undefined;
  }
}

/**
 * Turns the lock on with `pin` (exactly 4 digits, else it throws and nothing is saved) and marks the protect step answered.
 * With `withFingerprint` the phone is asked for a fingerprint key first; if it will not make one the passcode is saved
 * all the same, `onFingerprintFailed` is called (before the save) and `fingerprintFailed` says so.
 */
export async function turnOnLock(
  db: MasterpieceDB, pin: string, withFingerprint: boolean, onFingerprintFailed?: () => void,
): Promise<{ fingerprintFailed: boolean }> {
  const hash = await hashPin(pin);
  const fingerprint = withFingerprint ? await tryRegisterFingerprint() : undefined;
  // Told before the settings are written: the write is what makes the screen change, and the message is for the next one.
  if (withFingerprint && fingerprint === undefined) onFingerprintFailed?.();
  await updateSettings(db, {
    pin: { hash, relockMinutes: DEFAULT_RELOCK_MINUTES, lockout: registerSuccess(), ...(fingerprint && { fingerprint }) },
    lockPrompted: true,
  });
  return { fingerprintFailed: withFingerprint && fingerprint === undefined };
}

/** "Skip for now" on the protect step: no lock, and the step is not offered again. */
export async function skipProtect(db: MasterpieceDB): Promise<void> {
  await updateSettings(db, { lockPrompted: true });
}

/** A new passcode (exactly 4 digits, else it throws). The lockout is cleared; the lock time and the fingerprint stay. */
export async function changePasscode(db: MasterpieceDB, pin: string): Promise<void> {
  const hash = await hashPin(pin);
  await updatePin(db, (current) => ({ ...current, hash, lockout: registerSuccess() }));
}

/** Removes the passcode, the lockout and the fingerprint key. `lockPrompted` stays as it was, so the protect step is not offered again. */
export async function turnOffLock(db: MasterpieceDB): Promise<void> {
  await removePin(db);
}

/** Turns the fingerprint on (asks the phone) or off. False when the phone would not make a key; nothing changes then. */
export async function setFingerprint(db: MasterpieceDB, on: boolean): Promise<boolean> {
  if (!on) {
    await updatePin(db, ({ fingerprint: _removed, ...rest }) => rest);
    return true;
  }
  const fingerprint = await tryRegisterFingerprint();
  if (!fingerprint) return false;
  await updatePin(db, (current) => ({ ...current, fingerprint }));
  return true;
}

export async function setRelockMinutes(db: MasterpieceDB, relockMinutes: number): Promise<void> {
  await updatePin(db, (current) => ({ ...current, relockMinutes }));
}

/** Keeps the lockout, so that a reload does not reset it. */
export async function saveLockout(db: MasterpieceDB, lockout: LockoutState): Promise<void> {
  await updatePin(db, (current) => ({ ...current, lockout }));
}

/** What a tab is to believe when there is no passcode to read a lockout from: the longest lock, nothing to save. */
function noPinLock(now: Date): LockoutView {
  return { ...evaluateLockout(undefined, now), persist: false };
}

/**
 * Looks at the lockout as it is stored right now (not as this tab last saw it), and saves it if it had to be repaired or
 * cut short (`clampLockout`), all in one transaction. Nothing is written when it is fine. Every other tab sees what a
 * tab saves, so this is how a tab learns that another one has locked the app.
 */
export async function settleLockout(db: MasterpieceDB, now: Date): Promise<LockoutView> {
  const out: { view?: LockoutView } = {};
  await updatePin(db, (pin) => {
    out.view = evaluateLockout(pin.lockout, now);
    return out.view.persist ? { ...pin, lockout: out.view.state } : pin;
  });
  return out.view ?? noPinLock(now);
}

/**
 * Counts one wrong passcode against the stored lockout, in one transaction: the stored state is evaluated at that instant,
 * `registerFailure` is applied to it and the result written. A tab that worked from an old copy therefore cannot lose a
 * count or shorten a lock. A wrong passcode made while a lock is already on is not an attempt: the lock is left as it is.
 * Returns the lockout as it is after.
 */
export async function registerPasscodeFailure(db: MasterpieceDB, now: Date): Promise<LockoutView> {
  const out: { view?: LockoutView } = {};
  await updatePin(db, (pin) => {
    const before = evaluateLockout(pin.lockout, now);
    if (before.remainingMs > 0) {
      out.view = before;
      return before.persist ? { ...pin, lockout: before.state } : pin;
    }
    const failed = registerFailure(before.state, now);
    out.view = evaluateLockout(failed, now);
    return { ...pin, lockout: failed };
  });
  return out.view ?? noPinLock(now);
}

/**
 * A right passcode: clears the failures in the same kind of transaction. If another tab has locked the app in the
 * meantime the lock stays and this returns false: a lock that is on is not opened by a passcode that was checked before it.
 */
export async function registerPasscodeSuccess(db: MasterpieceDB, now: Date): Promise<boolean> {
  const out = { allowed: false };
  await updatePin(db, (pin) => {
    const before = evaluateLockout(pin.lockout, now);
    if (before.remainingMs > 0) return before.persist ? { ...pin, lockout: before.state } : pin;
    out.allowed = true;
    return { ...pin, lockout: registerSuccess() };
  });
  return out.allowed;
}

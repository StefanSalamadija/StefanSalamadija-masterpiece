/** Turning the app lock on and off, changing the passcode, and the small saves the lock screen makes. Everything here writes device settings only. */
import type { MasterpieceDB } from '../db/schema';
import { removePin, updatePin, updateSettings } from '../db/settings';
import type { FingerprintCredential, LockoutState } from '../domain/types';
import { registerFingerprint } from './fingerprint';
import { DEFAULT_RELOCK_MINUTES } from './lockState';
import { hashPin, registerSuccess } from './pin';

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

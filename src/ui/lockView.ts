import { isValidPin } from '../security/pin';

export const PASSCODE_FORMAT_ERROR = 'Use exactly 4 digits.';
export const PASSCODE_MISMATCH = "The passcodes don't match.";
export const WRONG_PASSCODE = 'Wrong passcode.';
export const FINGERPRINT_NOT_RECOGNISED = 'Fingerprint not recognised — enter your passcode.';
/** Said after the protect step saved the passcode but the phone would not make a fingerprint key. */
export const FINGERPRINT_SETUP_FAILED = "Fingerprint couldn't be set up. You can try again in Settings.";
/** Said in Settings, where "try again in Settings" would point at the place the person is already in. */
export const FINGERPRINT_TOGGLE_FAILED = "Fingerprint couldn't be set up. Try again.";
export const LOCK_MINUTES_ERROR = 'Enter a number of minutes from 0 to 60.';

export const LOCK_LIMITS_NOTE =
  "The lock stops casual access. It does not encrypt the data on this device — your phone's screen lock and encryption are the real protection.";
export const LOCK_FORGOTTEN_NOTE =
  "If you can't unlock (forgotten passcode and no fingerprint), the only way back in is to erase all data on this device and restore a backup.";
export const LOCK_NO_REUSE_NOTE = "Don't reuse your bank card or SIM PIN.";

const MAX_LOCK_MINUTES = 60;

/** What Settings asks the current passcode (or fingerprint) for: setting a new passcode, or turning the lock off. */
export type ConfirmPurpose = 'change' | 'off';

export function confirmTitle(purpose: ConfirmPurpose): string {
  return purpose === 'change' ? 'Change passcode?' : 'Turn off app lock?';
}

/** The line in the confirmation dialog, before the field. */
export function confirmIntro(purpose: ConfirmPurpose, fingerprint: boolean): string {
  const what = purpose === 'change' ? 'set a new passcode' : 'turn off the app lock';
  return `To ${what}, enter your current passcode${fingerprint ? ' or use your fingerprint' : ''}.`;
}

/** The line under the protect step's heading. The fingerprint sentence is only true on a phone with a sensor. */
export function protectIntro(fingerprint: boolean): string {
  return `Set a 4-digit passcode to open the app.${fingerprint ? ' You can also unlock with your fingerprint.' : ''}`;
}

/** "Too many attempts. Try again in 30 s." Whole seconds, rounded up, so a lock that is still on never reads 0 s. */
export function lockoutText(remainingMs: number): string {
  return `Too many attempts. Try again in ${Math.max(1, Math.ceil(remainingMs / 1000))} s.`;
}

export interface PasscodeProblem { field: 'pin' | 'repeat'; message: string }

/** What is wrong with a new passcode and its repeat: the passcode first, the mismatch only once the passcode itself is fine. */
export function passcodeProblem(pin: string, repeat: string): PasscodeProblem | undefined {
  if (!isValidPin(pin)) return { field: 'pin', message: PASSCODE_FORMAT_ERROR };
  if (pin !== repeat) return { field: 'repeat', message: PASSCODE_MISMATCH };
  return undefined;
}

/** What is kept of what was typed on the lock screen: ASCII digits only, at most four. */
export function passcodeDigits(text: string): string {
  return text.replace(/[^0-9]/g, '').slice(0, 4);
}

/** The minutes typed for "Lock after": a whole number from 0 to 60, else `undefined`. Digits only: no sign, decimal point or exponent. */
export function parseLockMinutes(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^[0-9]+$/.test(trimmed)) return undefined;
  const minutes = Number(trimmed);
  return minutes <= MAX_LOCK_MINUTES ? minutes : undefined;
}

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

/**
 * What Settings asks the current passcode (or fingerprint) for: setting a new passcode, turning the lock off, or turning
 * the fingerprint on (which only the passcode may confirm: a fingerprint added by whoever holds an unlocked phone would
 * otherwise be a way in that needs no passcode).
 */
export type ConfirmPurpose = 'change' | 'off' | 'fingerprint';

const CONFIRM_TITLES: Record<ConfirmPurpose, string> = {
  change: 'Change passcode?',
  off: 'Turn off app lock?',
  fingerprint: 'Turn on fingerprint unlock?',
};

const CONFIRM_ACTIONS: Record<ConfirmPurpose, string> = {
  change: 'set a new passcode',
  off: 'turn off the app lock',
  fingerprint: 'turn on fingerprint unlock',
};

export function confirmTitle(purpose: ConfirmPurpose): string {
  return CONFIRM_TITLES[purpose];
}

/** The line in the confirmation dialog, before the field. `fingerprint`: the fingerprint may be used instead of the passcode. */
export function confirmIntro(purpose: ConfirmPurpose, fingerprint: boolean): string {
  return `To ${CONFIRM_ACTIONS[purpose]}, enter your current passcode${fingerprint ? ' or use your fingerprint' : ''}.`;
}

/** The line under the protect step's heading. The fingerprint sentence is only true on a phone with a sensor. */
export function protectIntro(fingerprint: boolean): string {
  return `Set a 4-digit passcode to open the app.${fingerprint ? ' You can also unlock with your fingerprint.' : ''}`;
}

/** "Too many attempts. Try again in 30 s." Whole seconds, rounded up, so a lock that is still on never reads 0 s. */
export function lockoutText(remainingMs: number): string {
  return `Too many attempts. Try again in ${Math.max(1, Math.ceil(remainingMs / 1000))} s.`;
}

/** Said when a wrong passcode could not be saved: the app holds a full-length lock in memory, because a count that is not saved is not a count. */
export function unsavedLockText(remainingMs: number): string {
  return `Couldn't save \u2014 locked for safety. Try again in ${Math.max(1, Math.ceil(remainingMs / 1000))} s.`;
}

export const LOCK_ENDED_ANNOUNCEMENT = 'You can try again now.';

/**
 * What a screen reader is told, once, when a lock starts (through a polite live region; the countdown itself is a timer,
 * which is not announced every second). The words differ from the countdown on the screen on purpose: the same words in two
 * elements would be found twice by anything that looks the text up.
 */
export function lockStartedAnnouncement(remainingMs: number, unsaved: boolean): string {
  const seconds = Math.max(1, Math.ceil(remainingMs / 1000));
  const time = `You can try again in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`;
  return unsaved ? `Couldn't save the attempt, so the app is locked for safety. ${time}` : `Locked after too many attempts. ${time}`;
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

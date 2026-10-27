/** The rules that decide what the app shows before any of its data: the welcome screen, the lock, the protect step or the app. */
import type { PinSettings } from '../domain/types';
import { relockMinutesOf } from '../security/lockState';
import { shouldRelock } from '../security/pin';

export type GateScreen = 'welcome' | 'lock' | 'protect' | 'app';

export interface GateInput {
  hasShip: boolean;
  /** A passcode is set on this device. */
  hasPin: boolean;
  /** The app is locked in this session (it starts locked whenever a passcode is set, and locks again after a time in the background). */
  locked: boolean;
  /** `true` once the person has answered the protect step (lock turned on, or skipped). */
  lockPrompted: boolean | undefined;
}

/**
 * What the app shows. The lock is checked before anything else except the missing ship (there is nothing to protect
 * then), so no ship name, header or screen is rendered while the app is locked. The protect step is shown whenever there
 * is a ship, no passcode and no answer to it yet: after the first ship is made, after a backup is restored onto an empty
 * device, and again after a restart if the person left in the middle of it.
 */
export function gateScreen(input: GateInput): GateScreen {
  if (!input.hasShip) return 'welcome';
  if (input.hasPin && input.locked) return 'lock';
  if (!input.hasPin && input.lockPrompted !== true) return 'protect';
  return 'app';
}

/** When the app went to the background, on both clocks: the wall clock (an ISO instant) and the monotonic one (`performance.now()`). */
export interface HiddenMonotonic { hiddenAt: number; now: number }

/**
 * True when the app has to lock on coming back to the front. No passcode: never; never hidden: no. Anything that cannot be
 * read stays on the side of locking. The wall clock can be set back to hide a long absence, so a clock that reads earlier
 * than when the app was hidden counts as due, and so does the monotonic time (if given) passing the lock time: either
 * clock saying so is enough. (The monotonic clock may stand still while a device sleeps; the wall clock covers that.)
 */
export function relockDue(pin: PinSettings | undefined, hiddenAt: string | undefined, now: Date, mono?: HiddenMonotonic): boolean {
  if (pin === undefined || pin === null) return false;
  if (hiddenAt === undefined) return false;
  if (shouldRelock(hiddenAt, now, relockMinutesOf(pin))) return true;
  if (now.getTime() < Date.parse(hiddenAt)) return true;
  if (mono === undefined) return false;
  const away = mono.now - mono.hiddenAt;
  return Number.isNaN(away) || away < 0 || away > relockMinutesOf(pin) * 60_000;
}

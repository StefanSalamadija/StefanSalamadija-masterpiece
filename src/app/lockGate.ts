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

/** True when the app has to lock on coming back to the front. No passcode: never. Unreadable times and lock times stay on the side of locking. */
export function relockDue(pin: PinSettings | undefined, hiddenAt: string | undefined, now: Date): boolean {
  return pin !== undefined && shouldRelock(hiddenAt, now, relockMinutesOf(pin));
}

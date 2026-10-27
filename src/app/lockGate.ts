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
  /**
   * `false` from the moment the first ship is made on the welcome screen until the person answers the protect step
   * (`true`). `undefined` on a device whose ship did not come from the welcome screen, such as one filled by an import.
   */
  lockPrompted: boolean | undefined;
}

/**
 * What the app shows. The lock is checked before anything else except the missing ship (there is nothing to protect
 * then), so no ship name, header or screen is rendered while the app is locked. The protect step is shown while it is
 * due and unanswered, and so comes back after a restart if the person left in the middle of it.
 */
export function gateScreen(input: GateInput): GateScreen {
  if (!input.hasShip) return 'welcome';
  if (input.hasPin && input.locked) return 'lock';
  if (!input.hasPin && input.lockPrompted === false) return 'protect';
  return 'app';
}

/** True when the app has to lock on coming back to the front. No passcode: never. Unreadable times and lock times stay on the side of locking. */
export function relockDue(pin: PinSettings | undefined, hiddenAt: string | undefined, now: Date): boolean {
  return pin !== undefined && shouldRelock(hiddenAt, now, relockMinutesOf(pin));
}

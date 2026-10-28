import type { ConnectionProblem } from '../db/connection';
import { isQuotaExceeded, STORAGE_FULL_MESSAGE, StorageFullError } from '../db/storage';

export const OUTDATED_MESSAGE = 'Masterpiece was updated in another tab. Reload to continue.';
export const BLOCKED_MESSAGE = 'Close Masterpiece in your other tabs to finish the update.';
export const OPEN_FAILED_MESSAGE = "Masterpiece couldn't open its data. Restart the app; if it keeps happening, free some storage.";

/** Whether the app has its data yet. A failure carries the guidance to show, not the error: the error's own text is not for a person. */
export type StartupState = { status: 'opening' } | { status: 'ready' } | { status: 'failed'; message: string };

/** What to tell the person when the data could not be opened: the storage-full text for a full disk, else plain guidance. */
export function openFailureMessage(err: unknown): string {
  return err instanceof StorageFullError || isQuotaExceeded(err) ? STORAGE_FULL_MESSAGE : OPEN_FAILED_MESSAGE;
}

/** A message that takes the whole screen in place of the app. `action` is the one button it has, if any. */
export interface StartupNotice {
  message: string;
  action?: 'Reload' | 'Try again';
  /** Announced at once, rather than politely. */
  urgent: boolean;
}

/**
 * What stands in the way of the app, if anything, most serious first: the database was updated by another tab (nothing may
 * go on in this one), the data could not be opened, an upgrade waits for other tabs to let go. Once the app is open an
 * upgrade is no longer waited for.
 */
export function startupNotice(problem: ConnectionProblem | undefined, startup: StartupState): StartupNotice | undefined {
  if (problem === 'outdated') return { message: OUTDATED_MESSAGE, action: 'Reload', urgent: true };
  if (startup.status === 'failed') return { message: startup.message, action: 'Try again', urgent: true };
  if (problem === 'blocked' && startup.status === 'opening') return { message: BLOCKED_MESSAGE, urgent: false };
  return undefined;
}

let current: StartupState = { status: 'opening' };
const listeners = new Set<() => void>();

export function startupState(): StartupState {
  return current;
}

export function setStartup(next: StartupState): void {
  current = next;
  listeners.forEach((listener) => listener());
}

/** Calls `listener` whenever the startup state changes. Returns an unsubscribe function. */
export function subscribeStartup(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

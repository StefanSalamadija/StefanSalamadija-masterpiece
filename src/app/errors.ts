import { StorageFullError } from '../db/storage';

/** What the error toast shows: a message and, for some errors, one link to a way out. */
export interface ErrorNotice {
  message: string;
  action?: { label: string; href: string };
}

const GENERIC_MESSAGE = 'Something went wrong. Please try again.';

/** The notice for anything that was thrown or rejected. A full disk offers the backup export. */
export function describeError(err: unknown): ErrorNotice {
  if (err instanceof StorageFullError) return { message: err.message, action: { label: 'Export backup', href: '#/settings' } };
  if (err instanceof Error && err.message.trim() !== '') return { message: err.message };
  if (typeof err === 'string' && err.trim() !== '') return { message: err };
  return { message: GENERIC_MESSAGE };
}

let current: ErrorNotice | undefined;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

/** Shows `err` in the error toast, replacing any earlier one. Safe to call from anywhere, before or after the UI mounts. */
export function reportError(err: unknown): void {
  current = describeError(err);
  emit();
}

/** Hides the error toast. */
export function dismissError(): void {
  if (current === undefined) return;
  current = undefined;
  emit();
}

/** The error being shown, if any. */
export function currentError(): ErrorNotice | undefined {
  return current;
}

/** Calls `listener` whenever the shown error changes. Returns an unsubscribe function. */
export function subscribeErrors(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

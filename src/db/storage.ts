/** What the app says when the disk is full. */
export const STORAGE_FULL_MESSAGE = 'Storage on this device is full. The change was not saved. Export a backup and free up space.';

export class StorageFullError extends Error {
  constructor(options?: ErrorOptions) {
    super(STORAGE_FULL_MESSAGE, options);
    this.name = 'StorageFullError'; // a literal, not `new.target.name`, which a minifier would mangle
  }
}

const MAX_CAUSE_DEPTH = 5;

/**
 * True for a `QuotaExceededError` as the browser raises it, or as Dexie reports it: a Dexie error that carries the
 * original in `inner`, or a `BulkError` whose `failures` include one.
 */
export function isQuotaExceeded(error: unknown, depth = 0): boolean {
  if (typeof error !== 'object' || error === null || depth >= MAX_CAUSE_DEPTH) return false;
  const { name, inner, failures } = error as { name?: unknown; inner?: unknown; failures?: unknown };
  return (
    name === 'QuotaExceededError' ||
    isQuotaExceeded(inner, depth + 1) ||
    (Array.isArray(failures) && failures.some((f) => isQuotaExceeded(f, depth + 1)))
  );
}

/** Runs a database write. A full disk becomes `StorageFullError`; any other error passes through unchanged. */
export async function guardWrite<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    throw isQuotaExceeded(error) ? new StorageFullError({ cause: error }) : error;
  }
}

/** Asks the browser to keep this site's data when the device runs low on space. `unsupported` where there is no such API. */
export async function requestPersistentStorage(): Promise<'granted' | 'denied' | 'unsupported'> {
  if (typeof navigator === 'undefined' || typeof navigator.storage?.persist !== 'function') return 'unsupported';
  return (await navigator.storage.persist()) ? 'granted' : 'denied';
}

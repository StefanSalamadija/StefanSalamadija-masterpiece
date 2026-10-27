import { forgetPassword } from '../backup/passwordCache';
import type { MasterpieceDB } from '../db/schema';
import { THEME_STORAGE_KEY } from '../ui/theme';

/** What the erase dialog says when another open page keeps the database from being deleted. */
export const ERASE_BLOCKED_MESSAGE = 'Close Masterpiece in other tabs, then try again.';

class EraseBlockedError extends Error {
  constructor() {
    super(ERASE_BLOCKED_MESSAGE);
    this.name = 'EraseBlockedError'; // a literal, not `new.target.name`, which a minifier would mangle
  }
}

/** The traces of the data that live outside the database: the mirrored theme, and the backup password held in memory. */
function forgetLocalTraces(): void {
  try {
    localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    // Storage blocked: only the first paint of the next start is affected.
  }
  forgetPassword();
}

/**
 * "Erase everything" on the lock screen: deletes the whole database (every ship, snapshot and setting, the passcode and
 * the fingerprint key with them), the mirrored theme and the backup password held in memory. The connection is closed
 * first, so that the delete is not blocked by the app's own connection. The caller reloads the page afterwards.
 *
 * If the delete fails the database is opened again and nothing else is touched, so the app still works.
 *
 * If another page keeps the database open (`blocked`; the app's own tabs close their connections when asked, so this is
 * a page that does not, such as an old version), this rejects at once with `ERASE_BLOCKED_MESSAGE`, so that the dialog is
 * free again. A delete that has been asked for cannot be taken back: it goes through when that page lets go, and then
 * `onErasedLater` is called, so that the page starts again from nothing instead of going on with data that is gone.
 * Opening the database again waits behind that delete, so it is not waited for.
 */
export async function eraseDeviceData(db: MasterpieceDB, opts: { onErasedLater?: () => void } = {}): Promise<void> {
  db.close();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(db.name);
      let blocked = false;
      request.onsuccess = () => {
        forgetLocalTraces();
        if (blocked) opts.onErasedLater?.();
        else resolve();
      };
      request.onerror = () => reject(request.error ?? new Error('The data on this device could not be erased.'));
      request.onblocked = () => {
        blocked = true;
        reject(new EraseBlockedError());
      };
    });
  } catch (err) {
    const reopened = db.open().catch(() => undefined);
    if (!(err instanceof EraseBlockedError)) await reopened;
    throw err;
  }
}

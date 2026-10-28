import { forgetPassword } from '../backup/passwordCache';
import type { MasterpieceDB } from '../db/schema';
import { THEME_STORAGE_KEY } from '../ui/theme';

/** What the erase dialog says while another open page keeps the database from being deleted. The erase cannot be cancelled by then. */
export const ERASE_WAITING_MESSAGE = 'The erase will finish when Masterpiece is closed in your other tabs.';

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
 * a page that does not, such as an old version), `onBlocked` is called and the promise stays pending. A delete that has
 * been asked for cannot be taken back, so there is no failure to report and nothing to try again: it goes through when
 * that page lets go, and then the promise resolves like any other erase, so that the caller starts again from nothing
 * instead of going on with data that is gone. The database is not opened again meanwhile: that would wait behind the delete.
 */
export async function eraseDeviceData(db: MasterpieceDB, opts: { onBlocked?: () => void } = {}): Promise<void> {
  db.close();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(db.name);
      request.onsuccess = () => {
        forgetLocalTraces();
        resolve();
      };
      request.onerror = () => reject(request.error ?? new Error('The data on this device could not be erased.'));
      request.onblocked = () => opts.onBlocked?.();
    });
  } catch (err) {
    await db.open().catch(() => undefined);
    throw err;
  }
}

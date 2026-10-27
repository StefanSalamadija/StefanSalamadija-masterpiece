import { forgetPassword } from '../backup/passwordCache';
import type { MasterpieceDB } from '../db/schema';
import { THEME_STORAGE_KEY } from '../ui/theme';

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('The data on this device could not be erased.'));
    // `blocked` is not an end: the delete goes through when another open window lets go of the database (Dexie
    // closes its connection when it hears of the delete). Rejecting here would leave a delete that is still going to happen.
  });
}

/**
 * "Erase everything" on the lock screen: deletes the whole database (every ship, snapshot and setting, the passcode and
 * the fingerprint key with them), the mirrored theme and the backup password held in memory. The connection is closed
 * first, so that the delete is not blocked by the app's own connection. The caller reloads the page afterwards.
 * If the delete fails the database is opened again and nothing else is touched, so the app still works.
 */
export async function eraseDeviceData(db: MasterpieceDB): Promise<void> {
  db.close();
  try {
    await deleteDatabase(db.name);
  } catch (err) {
    await db.open().catch(() => undefined);
    throw err;
  }
  try {
    localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    // Storage blocked: only the first paint of the next start is affected.
  }
  forgetPassword();
}

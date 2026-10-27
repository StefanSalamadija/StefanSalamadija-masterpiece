import type { PinSettings, Settings } from '../domain/types';
import type { MasterpieceDB } from './schema';
import { guardWrite } from './storage';

const DEVICE_KEY = 'device';

export function guessDeviceName(ua: string): string {
  return ua.includes('Android') ? 'Android device' : 'Laptop';
}

function defaultSettings(): Settings {
  return {
    key: DEVICE_KEY,
    deviceId: crypto.randomUUID(),
    deviceName: guessDeviceName(typeof navigator === 'undefined' ? '' : navigator.userAgent),
    backupReminderDays: 7,
    lastSync: {},
    theme: 'day',
  };
}

/** The stored settings, created with defaults if there are none yet. Runs inside a read-write transaction on `settings`. */
async function readOrCreate(db: MasterpieceDB): Promise<Settings> {
  const found = await db.settings.get(DEVICE_KEY);
  if (found) return found;
  const created = defaultSettings();
  await db.settings.put(created);
  return created;
}

/** This device's settings. The first call creates them (including the device id); later calls return what is stored. */
export async function getSettings(db: MasterpieceDB): Promise<Settings> {
  const found = await db.settings.get(DEVICE_KEY);
  if (found) return found;
  // Checked again inside the transaction, so two callers that both found nothing still create one device id.
  return guardWrite(() => db.transaction('rw', db.settings, async () => readOrCreate(db)));
}

/** Merges `patch` into the stored settings. The device id (and the record key) never change. */
export function updateSettings(db: MasterpieceDB, patch: Partial<Settings>): Promise<Settings> {
  return guardWrite(() =>
    db.transaction('rw', db.settings, async () => {
      const current = await readOrCreate(db);
      const updated: Settings = { ...current, ...patch, key: DEVICE_KEY, deviceId: current.deviceId };
      await db.settings.put(updated);
      return updated;
    }),
  );
}

/**
 * Changes the stored passcode settings (lockout, lock time, fingerprint, hash) from what is stored now, in one
 * transaction, so a stale copy held by the screen never overwrites a newer one. Does nothing when no passcode is set.
 * `change` runs inside the transaction: it must be synchronous.
 */
export function updatePin(db: MasterpieceDB, change: (pin: PinSettings) => PinSettings): Promise<Settings> {
  return guardWrite(() =>
    db.transaction('rw', db.settings, async () => {
      const current = await readOrCreate(db);
      if (!current.pin) return current;
      const updated: Settings = { ...current, pin: change(current.pin) };
      await db.settings.put(updated);
      return updated;
    }),
  );
}

/** Takes the passcode settings away: the `pin` key itself goes, not just its value. */
export function removePin(db: MasterpieceDB): Promise<Settings> {
  return guardWrite(() =>
    db.transaction('rw', db.settings, async () => {
      const { pin: _removed, ...rest } = await readOrCreate(db);
      await db.settings.put(rest);
      return rest;
    }),
  );
}

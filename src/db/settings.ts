import type { Settings } from '../domain/types';
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

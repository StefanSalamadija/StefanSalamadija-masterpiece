import type { PinSettings, Settings } from '../domain/types';
import { isValidLocalDateTime } from '../domain/dates';
import { readTheme, THEMES } from '../domain/theme';
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
    ...NIGHT_DEFAULTS,
  };
}

/** Automatic night is off until it is turned on, and runs from 18:00 to 06:00 ship's time (spec §8). */
export const NIGHT_DEFAULTS = { nightAuto: false, nightFrom: '18:00', nightTo: '06:00' } as const;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const isOverride = (value: unknown): value is NonNullable<Settings['themeOverride']> => {
  const o = value as Settings['themeOverride'];
  return typeof o === 'object' && o !== null && THEMES.includes(o.theme) && typeof o.until === 'string' && isValidLocalDateTime(o.until);
};

/**
 * Stored settings as the app uses them, so every read of the settings goes through here:
 * - a theme stored before piece 7 (`night`), or one that is not known, is read as `readTheme` reads it;
 * - the automatic-night fields of a record from before they existed get their defaults, and a time that is not `HH:MM`
 *   is replaced by its default;
 * - an override with an unknown theme, or an end that is not a ship-local date and time, is dropped (the key goes).
 * A record that needs none of this is handed back as it is.
 */
export function normaliseSettings(raw: Settings): Settings {
  const theme = readTheme(raw.theme);
  const nightAuto = typeof raw.nightAuto === 'boolean' ? raw.nightAuto : NIGHT_DEFAULTS.nightAuto;
  const nightFrom = typeof raw.nightFrom === 'string' && HHMM.test(raw.nightFrom) ? raw.nightFrom : NIGHT_DEFAULTS.nightFrom;
  const nightTo = typeof raw.nightTo === 'string' && HHMM.test(raw.nightTo) ? raw.nightTo : NIGHT_DEFAULTS.nightTo;
  const badOverride = 'themeOverride' in raw && !isOverride(raw.themeOverride);
  if (theme === raw.theme && nightAuto === raw.nightAuto && nightFrom === raw.nightFrom && nightTo === raw.nightTo && !badOverride) {
    return raw;
  }
  const { themeOverride, ...rest } = raw;
  const keep = themeOverride !== undefined && !badOverride;
  return { ...rest, theme, nightAuto, nightFrom, nightTo, ...(keep ? { themeOverride } : {}) };
}

/** `settings` without the keys whose value is undefined, so a setting cleared with `undefined` is gone, not stored empty. */
function withoutUndefined(settings: Settings): Settings {
  const out = { ...settings } as Record<string, unknown>;
  for (const key of Object.keys(out)) if (out[key] === undefined) delete out[key];
  return out as unknown as Settings;
}

/** The stored settings, created with defaults if there are none yet. Runs inside a read-write transaction on `settings`. */
async function readOrCreate(db: MasterpieceDB): Promise<Settings> {
  const found = await db.settings.get(DEVICE_KEY);
  if (found) return normaliseSettings(found);
  const created = defaultSettings();
  await db.settings.put(created);
  return created;
}

/** This device's settings. The first call creates them (including the device id); later calls return what is stored. */
export async function getSettings(db: MasterpieceDB): Promise<Settings> {
  const found = await db.settings.get(DEVICE_KEY);
  if (found) return normaliseSettings(found);
  // Checked again inside the transaction, so two callers that both found nothing still create one device id.
  return guardWrite(() => db.transaction('rw', db.settings, async () => readOrCreate(db)));
}

/**
 * Merges `patch` into the stored settings. The device id (and the record key) never change. A key patched to `undefined`
 * (such as `{ themeOverride: undefined }`) is removed, as `removePin` removes the passcode.
 */
export function updateSettings(db: MasterpieceDB, patch: Partial<Settings>): Promise<Settings> {
  return guardWrite(() =>
    db.transaction('rw', db.settings, async () => {
      const current = await readOrCreate(db);
      const updated = withoutUndefined({ ...current, ...patch, key: DEVICE_KEY, deviceId: current.deviceId });
      await db.settings.put(updated);
      return updated;
    }),
  );
}

/**
 * Clears a held theme whose end has come, but only if the stored one is still `expected`: an override written meanwhile
 * (a tap, another tab) is kept. The key itself goes.
 */
export function clearThemeOverride(db: MasterpieceDB, expected: NonNullable<Settings['themeOverride']>): Promise<Settings> {
  return guardWrite(() =>
    db.transaction('rw', db.settings, async () => {
      const current = await readOrCreate(db);
      const held = current.themeOverride;
      if (!held || held.theme !== expected.theme || held.until !== expected.until) return current;
      const { themeOverride: _cleared, ...rest } = current;
      await db.settings.put(rest);
      return rest;
    }),
  );
}

/**
 * Changes the stored passcode settings (lockout, lock time, fingerprint, hash) from what is stored now, in one
 * transaction, so a stale copy held by the screen never overwrites a newer one. Does nothing when no passcode is set.
 * `change` runs inside the transaction: it must be synchronous. When it hands back the very object it was given,
 * nothing is written (a look at the stored state, such as the lockout check, writes nothing).
 */
export function updatePin(db: MasterpieceDB, change: (pin: PinSettings) => PinSettings): Promise<Settings> {
  return guardWrite(() =>
    db.transaction('rw', db.settings, async () => {
      const current = await readOrCreate(db);
      if (!current.pin) return current;
      const pin = change(current.pin);
      if (pin === current.pin) return current;
      const updated: Settings = { ...current, pin };
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

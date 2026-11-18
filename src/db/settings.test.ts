import { describe, expect, it } from 'vitest';
import type { PinSettings, Settings } from '../domain/types';
import { openDb } from './schema';
import { clearThemeOverride, getSettings, normaliseSettings, removePin, updatePin, updateSettings } from './settings';

const freshDb = () => openDb('t-' + crypto.randomUUID());
const pin = (over: Partial<PinSettings> = {}): PinSettings => ({
  hash: { salt: 'c2FsdA==', hash: 'aGFzaA==', iterations: 1000 }, relockMinutes: 5, lockout: { failures: 0 }, ...over,
});

describe('updatePin', () => {
  it('does nothing, and does not call the change, when no passcode is set', async () => {
    const db = freshDb();
    const before = await getSettings(db);
    let called = false;
    const after = await updatePin(db, (p) => { called = true; return p; });
    expect(called).toBe(false);
    expect(after).toEqual(before);
    expect((await getSettings(db)).pin).toBeUndefined();
  });

  it('applies the change to the stored passcode settings and keeps every other setting', async () => {
    const db = freshDb();
    const start = await updateSettings(db, { pin: pin(), theme: 'dark', lockPrompted: true, backupReminderDays: 3 });
    const after = await updatePin(db, (p) => ({ ...p, relockMinutes: 15 }));
    expect(after).toEqual({ ...start, pin: pin({ relockMinutes: 15 }) });
    expect(await getSettings(db)).toEqual(after);
  });

  it('works on what is stored now, so two changes made together both land', async () => {
    const db = freshDb();
    await updateSettings(db, { pin: pin() });
    await Promise.all([
      updatePin(db, (p) => ({ ...p, relockMinutes: 20 })),
      updatePin(db, (p) => ({ ...p, lockout: { failures: 2 } })),
    ]);
    expect((await getSettings(db)).pin).toEqual(pin({ relockMinutes: 20, lockout: { failures: 2 } }));
  });

  it('writes nothing when the change hands back the very pin it was given', async () => {
    const db = freshDb();
    await updateSettings(db, { pin: pin() });
    let writes = 0;
    db.settings.hook('updating', () => { writes += 1; });
    const stored = (await getSettings(db)).pin;
    const after = await updatePin(db, (p) => p);
    expect(writes).toBe(0);
    expect(after.pin).toEqual(stored);
    await updatePin(db, (p) => ({ ...p }));
    expect(writes).toBe(1);
  });

  it('can take the fingerprint away by leaving it out', async () => {
    const db = freshDb();
    await updateSettings(db, { pin: pin({ fingerprint: { credentialId: 'Y3JlZA', publicKey: 'a2V5', alg: -7 } }) });
    await updatePin(db, ({ fingerprint: _gone, ...rest }) => rest);
    expect((await getSettings(db)).pin).toEqual(pin());
    expect(Object.keys((await getSettings(db)).pin!)).not.toContain('fingerprint');
  });
});

describe('removePin', () => {
  it('removes the key and leaves every other setting', async () => {
    const db = freshDb();
    const start = await updateSettings(db, { pin: pin(), theme: 'dark', lockPrompted: true });
    const after = await removePin(db);
    const { pin: _gone, ...expected } = start;
    expect(after).toEqual(expected);
    expect(Object.keys(await getSettings(db))).not.toContain('pin');
  });

  it('is fine when there is no passcode', async () => {
    const db = freshDb();
    const before = await getSettings(db);
    expect(await removePin(db)).toEqual(before);
  });
});

describe('the stored theme', () => {
  /** Puts settings with the old `night` theme straight into IndexedDB, as a device from before piece 7 has them. */
  async function storeLegacyNight(db: ReturnType<typeof freshDb>): Promise<void> {
    const current = await getSettings(db);
    await db.settings.put({ ...current, theme: 'night' as unknown as Settings['theme'] });
  }

  it('reads the old night theme back as dark', async () => {
    const db = freshDb();
    await storeLegacyNight(db);
    expect((await getSettings(db)).theme).toBe('dark');
  });

  it('keeps it dark through an update of another setting', async () => {
    const db = freshDb();
    await storeLegacyNight(db);
    expect((await updateSettings(db, { backupReminderDays: 3 })).theme).toBe('dark');
    expect((await db.settings.get('device'))?.theme).toBe('dark');
  });

  it('normaliseSettings turns an unknown theme into day and leaves the rest alone', () => {
    const raw = {
      key: 'device', deviceId: 'd', deviceName: 'Laptop', backupReminderDays: 7, lastSync: {}, theme: 'purple',
      nightAuto: false, nightFrom: '18:00', nightTo: '06:00',
    } as unknown as Settings;
    expect(normaliseSettings(raw)).toEqual({ ...raw, theme: 'day' });
    const fine: Settings = { ...raw, theme: 'red' };
    expect(normaliseSettings(fine)).toEqual(fine);
  });
});

describe('the automatic night settings', () => {
  const raw = (over: Record<string, unknown> = {}) =>
    ({ key: 'device', deviceId: 'd', deviceName: 'Laptop', backupReminderDays: 7, lastSync: {}, theme: 'day', ...over }) as unknown as Settings;

  it('are off, from 18:00 to 06:00, on a new device', async () => {
    const s = await getSettings(freshDb());
    expect([s.nightAuto, s.nightFrom, s.nightTo, s.themeOverride]).toEqual([false, '18:00', '06:00', undefined]);
  });

  it('are filled with the defaults for a record stored before they existed', async () => {
    const db = freshDb();
    const current = await getSettings(db);
    const { nightAuto: _a, nightFrom: _f, nightTo: _t, ...old } = current;
    await db.settings.put(old as Settings);
    const s = await getSettings(db);
    expect([s.nightAuto, s.nightFrom, s.nightTo]).toEqual([false, '18:00', '06:00']);
    expect((await updateSettings(db, { backupReminderDays: 3 })).nightFrom).toBe('18:00');
  });

  it('keep valid values', () => {
    const fine = raw({ nightAuto: true, nightFrom: '20:15', nightTo: '05:45', themeOverride: { theme: 'contrast', until: '2026-11-18T05:45' } });
    expect(normaliseSettings(fine)).toEqual(fine);
  });

  it('replace a time that is not HH:MM with the default', () => {
    const s = normaliseSettings(raw({ nightAuto: true, nightFrom: '25:00', nightTo: 6 }));
    expect([s.nightFrom, s.nightTo]).toEqual(['18:00', '06:00']);
    expect(normaliseSettings(raw({ nightAuto: 'yes' })).nightAuto).toBe(false);
  });

  it('drop an override with an unknown theme or an end that is not a ship-local date and time', () => {
    for (const themeOverride of [
      { theme: 'purple', until: '2026-11-18T06:00' },
      { theme: 'dark', until: '2026-11-18 06:00' },
      { theme: 'dark', until: '2026-02-30T06:00' },
      { theme: 'dark' },
      'dark',
      null,
    ]) {
      const s = normaliseSettings(raw({ nightAuto: true, themeOverride }));
      expect('themeOverride' in s).toBe(false);
    }
  });

  it('drop a stored bad override on the next read', async () => {
    const db = freshDb();
    const current = await getSettings(db);
    await db.settings.put({ ...current, themeOverride: { theme: 'purple', until: 'soon' } } as unknown as Settings);
    expect((await getSettings(db)).themeOverride).toBeUndefined();
  });

  it('lose the override key itself when it is cleared', async () => {
    const db = freshDb();
    await updateSettings(db, { nightAuto: true, themeOverride: { theme: 'dark', until: '2026-11-18T06:00' } });
    const cleared = await updateSettings(db, { themeOverride: undefined });
    expect('themeOverride' in cleared).toBe(false);
    expect('themeOverride' in ((await db.settings.get('device')) ?? {})).toBe(false);
    expect(cleared.nightAuto).toBe(true);
  });
});

describe('clearThemeOverride', () => {
  const held = { theme: 'contrast' as const, until: '2026-11-17T06:00' };

  it('deletes the stored override when it is the one expected', async () => {
    const db = freshDb();
    await updateSettings(db, { nightAuto: true, themeOverride: held });
    const after = await clearThemeOverride(db, { ...held });
    expect('themeOverride' in after).toBe(false);
    expect('themeOverride' in ((await db.settings.get('device')) ?? {})).toBe(false);
  });

  it('leaves a different override alone, such as one a tap has just written', async () => {
    const db = freshDb();
    const fresh = { theme: 'day' as const, until: '2026-11-17T18:00' };
    await updateSettings(db, { nightAuto: true, themeOverride: fresh });
    expect((await clearThemeOverride(db, held)).themeOverride).toEqual(fresh);
    expect((await db.settings.get('device'))?.themeOverride).toEqual(fresh);
  });
});

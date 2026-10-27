import { describe, expect, it } from 'vitest';
import type { PinSettings } from '../domain/types';
import { openDb } from './schema';
import { getSettings, removePin, updatePin, updateSettings } from './settings';

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
    const start = await updateSettings(db, { pin: pin(), theme: 'night', lockPrompted: true, backupReminderDays: 3 });
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
    const start = await updateSettings(db, { pin: pin(), theme: 'night', lockPrompted: true });
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

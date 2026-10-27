import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../db/schema';
import { getSettings, updateSettings } from '../db/settings';
import type { FingerprintCredential } from '../domain/types';
import {
  changePasscode, saveLockout, setFingerprint, setRelockMinutes, skipProtect, turnOffLock, turnOnLock,
} from './appLock';
import { registerFingerprint } from './fingerprint';
import { verifyPin } from './pin';

vi.mock('./fingerprint', () => ({ registerFingerprint: vi.fn() }));

const register = vi.mocked(registerFingerprint);
const CRED: FingerprintCredential = { credentialId: 'Y3JlZC0x', publicKey: 'a2V5', alg: -7 };
const freshDb = () => openDb('t-' + crypto.randomUUID());

beforeEach(() => {
  register.mockReset();
  register.mockResolvedValue(CRED);
});

describe('turnOnLock', () => {
  it('saves the passcode as a hash, with 5 minutes to relock and no failures, and marks the protect step answered', async () => {
    const db = freshDb();
    expect(await turnOnLock(db, '2580', false)).toEqual({ fingerprintFailed: false });
    const s = await getSettings(db);
    expect(s.lockPrompted).toBe(true);
    expect(s.pin).toMatchObject({ relockMinutes: 5, lockout: { failures: 0 } });
    expect(s.pin?.fingerprint).toBeUndefined();
    expect(await verifyPin('2580', s.pin!.hash)).toBe(true);
    expect(await verifyPin('2581', s.pin!.hash)).toBe(false);
    expect(JSON.stringify(s)).not.toContain('2580'); // the passcode itself is never stored
    expect(register).not.toHaveBeenCalled();
  });

  it('registers the fingerprint when asked, and keeps its credential with the passcode', async () => {
    const db = freshDb();
    expect(await turnOnLock(db, '2580', true)).toEqual({ fingerprintFailed: false });
    expect(register).toHaveBeenCalledTimes(1);
    expect((await getSettings(db)).pin?.fingerprint).toEqual(CRED);
  });

  it('still saves the passcode when the fingerprint cannot be set up, and says so', async () => {
    const db = freshDb();
    register.mockRejectedValue(new Error('cancelled'));
    expect(await turnOnLock(db, '2580', true)).toEqual({ fingerprintFailed: true });
    const s = await getSettings(db);
    expect(await verifyPin('2580', s.pin!.hash)).toBe(true);
    expect(s.pin?.fingerprint).toBeUndefined();
    expect(s.lockPrompted).toBe(true);
  });

  it('calls onFingerprintFailed before anything is saved, and only when the fingerprint failed', async () => {
    const db = freshDb();
    const events: string[] = [];
    db.settings.hook('creating', () => { events.push('write'); });
    register.mockRejectedValue(new Error('cancelled'));
    await turnOnLock(db, '2580', true, () => events.push('failed'));
    expect(events).toEqual(['failed', 'write']);

    const never = vi.fn();
    register.mockResolvedValue(CRED);
    await turnOnLock(freshDb(), '2580', true, never);
    await turnOnLock(freshDb(), '2580', false, never);
    expect(never).not.toHaveBeenCalled();
  });

  it('refuses a passcode that is not exactly 4 digits, and saves nothing', async () => {
    const db = freshDb();
    await expect(turnOnLock(db, '123', false)).rejects.toThrow('Passcode must be exactly 4 digits');
    const s = await getSettings(db);
    expect(s.pin).toBeUndefined();
    expect(s.lockPrompted).toBeUndefined();
  });
});

describe('skipProtect', () => {
  it('only marks the step answered', async () => {
    const db = freshDb();
    await skipProtect(db);
    const s = await getSettings(db);
    expect(s.lockPrompted).toBe(true);
    expect(s.pin).toBeUndefined();
  });
});

describe('changePasscode', () => {
  it('replaces the hash, clears the lockout, and keeps the lock time and the fingerprint', async () => {
    const db = freshDb();
    await turnOnLock(db, '2580', true);
    await setRelockMinutes(db, 15);
    await saveLockout(db, { failures: 6, lockedUntil: '2026-10-25T12:00:00.000Z' });
    await changePasscode(db, '1357');
    const pin = (await getSettings(db)).pin!;
    expect(await verifyPin('1357', pin.hash)).toBe(true);
    expect(await verifyPin('2580', pin.hash)).toBe(false);
    expect(pin.lockout).toEqual({ failures: 0 });
    expect(pin.relockMinutes).toBe(15);
    expect(pin.fingerprint).toEqual(CRED);
  });

  it('refuses a passcode that is not exactly 4 digits and keeps the old one', async () => {
    const db = freshDb();
    await turnOnLock(db, '2580', false);
    await expect(changePasscode(db, 'abcd')).rejects.toThrow('Passcode must be exactly 4 digits');
    expect(await verifyPin('2580', (await getSettings(db)).pin!.hash)).toBe(true);
  });
});

describe('turnOffLock', () => {
  it('removes the passcode, the lockout and the fingerprint, and does not ask again', async () => {
    const db = freshDb();
    await turnOnLock(db, '2580', true);
    await turnOffLock(db);
    const s = await getSettings(db);
    expect(s.pin).toBeUndefined();
    expect(Object.keys(s)).not.toContain('pin');
    expect(s.lockPrompted).toBe(true);
  });
});

describe('setFingerprint', () => {
  it('turns the fingerprint on and returns true', async () => {
    const db = freshDb();
    await turnOnLock(db, '2580', false);
    expect(await setFingerprint(db, true)).toBe(true);
    expect((await getSettings(db)).pin?.fingerprint).toEqual(CRED);
  });

  it('returns false and changes nothing when the phone refuses', async () => {
    const db = freshDb();
    await turnOnLock(db, '2580', false);
    register.mockRejectedValue(new Error('no'));
    expect(await setFingerprint(db, true)).toBe(false);
    expect((await getSettings(db)).pin?.fingerprint).toBeUndefined();
  });

  it('turns it off, leaving the passcode', async () => {
    const db = freshDb();
    await turnOnLock(db, '2580', true);
    expect(await setFingerprint(db, false)).toBe(true);
    const pin = (await getSettings(db)).pin!;
    expect(Object.keys(pin)).not.toContain('fingerprint');
    expect(await verifyPin('2580', pin.hash)).toBe(true);
  });
});

describe('setRelockMinutes and saveLockout', () => {
  it('change only their own part of the passcode settings', async () => {
    const db = freshDb();
    await turnOnLock(db, '2580', true);
    const before = (await getSettings(db)).pin!;
    await setRelockMinutes(db, 0);
    await saveLockout(db, { failures: 5, lockedUntil: '2026-10-25T12:00:30.000Z' });
    expect((await getSettings(db)).pin).toEqual({ ...before, relockMinutes: 0, lockout: { failures: 5, lockedUntil: '2026-10-25T12:00:30.000Z' } });
  });

  it('write nothing when there is no passcode', async () => {
    const db = freshDb();
    await updateSettings(db, { theme: 'night' });
    await saveLockout(db, { failures: 5 });
    await setRelockMinutes(db, 10);
    expect((await getSettings(db)).pin).toBeUndefined();
  });
});

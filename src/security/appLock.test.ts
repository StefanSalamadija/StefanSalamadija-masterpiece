import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../db/schema';
import { getSettings, updateSettings } from '../db/settings';
import type { FingerprintCredential } from '../domain/types';
import {
  changePasscode, registerPasscodeFailure, registerPasscodeSuccess, saveLockout, setFingerprint, setRelockMinutes,
  settleLockout, skipProtect, turnOffLock, turnOnLock,
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

describe('the lockout is shared by every tab: each step works on what is stored at that moment', () => {
  const t0 = new Date('2026-10-25T12:00:00.000Z');
  const later = (ms: number) => new Date(t0.getTime() + ms);

  /** Two connections to one database: two tabs of the app. */
  async function twoTabs() {
    const name = 't-' + crypto.randomUUID();
    const a = openDb(name);
    const b = openDb(name);
    await turnOnLock(a, '2580', false);
    return { a, b, stored: async () => (await getSettings(openDb(name))).pin!.lockout };
  }

  it('adds up the wrong passcodes of both tabs: 3 in one and 2 in the other lock them both', async () => {
    const { a, b, stored } = await twoTabs();
    for (let i = 0; i < 3; i++) expect((await registerPasscodeFailure(a, t0)).remainingMs).toBe(0);
    expect(await stored()).toEqual({ failures: 3 });
    expect((await registerPasscodeFailure(b, t0)).remainingMs).toBe(0);
    const fifth = await registerPasscodeFailure(b, t0);
    expect(fifth.remainingMs).toBe(30_000);
    expect(await stored()).toEqual({ failures: 5, lockedUntil: later(30_000).toISOString() });
    // Whichever tab looks now sees the lock.
    expect((await settleLockout(a, t0)).remainingMs).toBe(30_000);
  });

  it('two tabs failing at the same moment: none is lost, the 5th locks, and the ones after it are not counted again', async () => {
    const { a, b, stored } = await twoTabs();
    await Promise.all([a, b, a, b, a, b, a, b].map((db) => registerPasscodeFailure(db, t0)));
    const lockout = await stored();
    // The 5th locked it; the failures after that were made against a lock that was already on and are not counted again.
    expect(lockout.failures).toBeGreaterThanOrEqual(5);
    expect(lockout.lockedUntil).toBe(later(30_000).toISOString());
  });

  it('counts nothing and changes nothing while a lock is already on: a tab that did not know cannot shorten or lengthen it', async () => {
    const { a, b, stored } = await twoTabs();
    for (let i = 0; i < 5; i++) await registerPasscodeFailure(a, t0);
    const locked = await stored();
    const view = await registerPasscodeFailure(b, later(10_000)); // a stale tab's wrong passcode, 10 s into the lock
    expect(view.remainingMs).toBe(20_000);
    expect(await stored()).toEqual(locked);
    expect((await registerPasscodeFailure(b, later(29_999))).remainingMs).toBe(1);
    expect(await stored()).toEqual(locked);
  });

  it('goes up the levels as one device: the 6th wrong passcode after the first lock is 60 s, the 7th 300 s', async () => {
    const { a, b, stored } = await twoTabs();
    for (let i = 0; i < 5; i++) await registerPasscodeFailure(a, t0);
    expect((await registerPasscodeFailure(b, later(31_000))).remainingMs).toBe(60_000);
    expect((await registerPasscodeFailure(a, later(100_000))).remainingMs).toBe(300_000);
    expect((await stored()).failures).toBe(7);
  });

  it('settleLockout reads the stored lockout, not what a tab saw before: it sees a lock another tab has taken', async () => {
    const { a, b } = await twoTabs();
    expect((await settleLockout(b, t0)).remainingMs).toBe(0); // b looks first
    for (let i = 0; i < 5; i++) await registerPasscodeFailure(a, t0);
    expect((await settleLockout(b, t0)).remainingMs).toBe(30_000);
  });

  it('settleLockout writes nothing when the stored lockout is fine, and saves a repair when it is not', async () => {
    const { a, stored } = await twoTabs();
    let writes = 0;
    a.settings.hook('updating', () => { writes += 1; });
    await settleLockout(a, t0);
    await settleLockout(a, t0);
    expect(writes).toBe(0);

    // A lock taken while the clock was 6 h fast is cut to 300 s, and saved.
    await saveLockout(a, { failures: 7, lockedUntil: later(6 * 3600_000).toISOString() });
    writes = 0;
    const view = await settleLockout(a, t0);
    expect(view.remainingMs).toBe(300_000);
    expect(writes).toBe(1);
    expect(await stored()).toEqual({ failures: 7, lockedUntil: later(300_000).toISOString() });

    // An unreadable lockout is the longest lock, and saved.
    await saveLockout(a, { failures: 'x' } as never);
    expect((await settleLockout(a, t0)).remainingMs).toBe(300_000);
    expect((await stored()).lockedUntil).toBe(later(300_000).toISOString());
  });

  it('a right passcode clears the failures, but not while another tab has locked the app: then it is turned away', async () => {
    const { a, b, stored } = await twoTabs();
    await registerPasscodeFailure(a, t0);
    expect(await registerPasscodeSuccess(b, t0)).toBe(true);
    expect(await stored()).toEqual({ failures: 0 });

    for (let i = 0; i < 5; i++) await registerPasscodeFailure(a, t0);
    const locked = await stored();
    expect(await registerPasscodeSuccess(b, later(5_000))).toBe(false);
    expect(await stored()).toEqual(locked);
    expect(await registerPasscodeSuccess(b, later(31_000))).toBe(true);
    expect(await stored()).toEqual({ failures: 0 });
  });

  it('fails closed when the lockout cannot be dated or read, and when there is no passcode to count against', async () => {
    const { a, stored } = await twoTabs();
    const invalid = new Date(Number.NaN);
    expect((await registerPasscodeFailure(a, invalid)).remainingMs).toBe(300_000);
    expect(await registerPasscodeSuccess(a, invalid)).toBe(false);
    expect(await stored()).toEqual({ failures: 0 }); // nothing could be written without a time

    await saveLockout(a, 'garbage' as never);
    const view = await registerPasscodeFailure(a, t0);
    expect(view.remainingMs).toBe(300_000);
    expect(await registerPasscodeSuccess(a, later(1_000))).toBe(false);

    const none = freshDb();
    await getSettings(none);
    expect((await settleLockout(none, t0)).remainingMs).toBe(300_000);
    expect((await registerPasscodeFailure(none, t0)).remainingMs).toBe(300_000);
    expect(await registerPasscodeSuccess(none, t0)).toBe(false);
  });
});

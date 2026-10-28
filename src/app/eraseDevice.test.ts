import { afterEach, describe, expect, it, vi } from 'vitest';
import { forgetPassword, getRememberedPassword, rememberPassword } from '../backup/passwordCache';
import { openDb } from '../db/schema';
import { getSettings, updateSettings } from '../db/settings';
import { createShip, listShips } from '../db/ships';
import { THEME_STORAGE_KEY } from '../ui/theme';
import { ERASE_WAITING_MESSAGE, eraseDeviceData } from './eraseDevice';

const name = () => 't-' + crypto.randomUUID();

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  forgetPassword();
});

describe('eraseDeviceData', () => {
  it('deletes the whole database, so that a new connection finds nothing', async () => {
    const dbName = name();
    const db = openDb(dbName);
    await createShip(db, 'MV OCEAN STAR', 180);
    await updateSettings(db, { theme: 'night', lockPrompted: true });
    const { deviceId } = await getSettings(db);

    await eraseDeviceData(db);

    const fresh = openDb(dbName);
    expect(await listShips(fresh)).toEqual([]);
    const settings = await getSettings(fresh);
    expect(settings.deviceId).not.toBe(deviceId);
    expect(settings.theme).toBe('day');
    expect(settings.lockPrompted).toBeUndefined();
    expect(settings.pin).toBeUndefined();
  });

  it('closes the connection first, so that the delete is not blocked by the app itself', async () => {
    const db = openDb(name());
    await getSettings(db);
    const events: string[] = [];
    const close = db.close.bind(db);
    vi.spyOn(db, 'close').mockImplementation((...args) => { events.push('close'); return close(...args); });
    const del = indexedDB.deleteDatabase.bind(indexedDB);
    vi.spyOn(indexedDB, 'deleteDatabase').mockImplementation((n) => { events.push('delete'); return del(n); });
    await eraseDeviceData(db);
    expect(events).toEqual(['close', 'delete']);
    expect(db.isOpen()).toBe(false);
  });

  it('forgets the backup password of this session and the mirrored theme', async () => {
    const removed: string[] = [];
    vi.stubGlobal('localStorage', { removeItem: (key: string) => removed.push(key) });
    rememberPassword('lozinka-ćevapi');
    const db = openDb(name());
    await getSettings(db);
    await eraseDeviceData(db);
    expect(getRememberedPassword()).toBeUndefined();
    expect(removed).toEqual([THEME_STORAGE_KEY]);
    expect(THEME_STORAGE_KEY).toBe('mp-theme');
  });

  it('does not mind that the browser keeps no local storage', async () => {
    vi.stubGlobal('localStorage', { removeItem: () => { throw new DOMException('blocked', 'SecurityError'); } });
    rememberPassword('lozinka-ćevapi');
    const db = openDb(name());
    await getSettings(db);
    await expect(eraseDeviceData(db)).resolves.toBeUndefined();
    expect(getRememberedPassword()).toBeUndefined();
  });

  it('when the delete fails, reopens the database so the app still works, and keeps the password and the theme', async () => {
    const removed: string[] = [];
    vi.stubGlobal('localStorage', { removeItem: (key: string) => removed.push(key) });
    rememberPassword('lozinka-ćevapi');
    const db = openDb(name());
    await createShip(db, 'MV OCEAN STAR', 180);
    vi.spyOn(indexedDB, 'deleteDatabase').mockImplementation(() => {
      const request = {} as IDBOpenDBRequest;
      queueMicrotask(() => {
        Object.defineProperty(request, 'error', { value: new DOMException('nope', 'UnknownError') });
        request.onerror?.(new Event('error'));
      });
      return request;
    });
    await expect(eraseDeviceData(db)).rejects.toThrow('nope');
    expect(db.isOpen()).toBe(true);
    expect(await listShips(db)).toHaveLength(1);
    expect(getRememberedPassword()).toBe('lozinka-ćevapi');
    expect(removed).toEqual([]);
  });

  describe('when another tab keeps the database open (the delete is blocked)', () => {
    /** A connection of another page that does not close when asked to, as an old version of the app would not. */
    function stubbornConnection(dbName: string): Promise<IDBDatabase> {
      return new Promise((resolve, reject) => {
        const open = indexedDB.open(dbName);
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
    }

    /** Starts an erase and resolves with how it is settling once `onBlocked` has been called. */
    async function eraseUntilBlocked(db: ReturnType<typeof openDb>) {
      let settled: 'pending' | 'resolved' | 'rejected' = 'pending';
      let blocked!: () => void;
      const wasBlocked = new Promise<void>((resolve) => { blocked = resolve; });
      const onBlocked = vi.fn(blocked);
      const erase = eraseDeviceData(db, { onBlocked }).then(
        () => { settled = 'resolved'; },
        () => { settled = 'rejected'; },
      );
      await wasBlocked;
      return { erase, onBlocked, state: () => settled };
    }

    it('tells the caller it is waiting, in these words, and goes on waiting: it cannot be cancelled, so it does not fail', async () => {
      expect(ERASE_WAITING_MESSAGE).toBe('The erase will finish when Masterpiece is closed in your other tabs.');
      const dbName = name();
      const db = openDb(dbName);
      await createShip(db, 'MV OCEAN STAR', 180);
      const other = await stubbornConnection(dbName);

      const { erase, onBlocked, state } = await eraseUntilBlocked(db);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(onBlocked).toHaveBeenCalledTimes(1);
      expect(state()).toBe('pending'); // not rejected: a "try again" would queue a second delete behind the first
      other.close();
      await erase;
      expect(state()).toBe('resolved');
    });

    it('leaves the password and the theme alone while it waits, and does not open the database again behind the delete', async () => {
      const removed: string[] = [];
      vi.stubGlobal('localStorage', { removeItem: (key: string) => removed.push(key) });
      rememberPassword('lozinka-ćevapi');
      const dbName = name();
      const db = openDb(dbName);
      await createShip(db, 'MV OCEAN STAR', 180);
      const other = await stubbornConnection(dbName);

      const { erase } = await eraseUntilBlocked(db);
      expect(getRememberedPassword()).toBe('lozinka-ćevapi');
      expect(removed).toEqual([]);
      expect(db.isOpen()).toBe(false);
      other.close();
      await erase;
    });

    it('goes through when the other tab lets go: the promise then resolves, and the password and the theme are forgotten', async () => {
      const removed: string[] = [];
      vi.stubGlobal('localStorage', { removeItem: (key: string) => removed.push(key) });
      rememberPassword('lozinka-ćevapi');
      const dbName = name();
      const db = openDb(dbName);
      await createShip(db, 'MV OCEAN STAR', 180);
      const other = await stubbornConnection(dbName);

      const { erase } = await eraseUntilBlocked(db);
      other.close();
      await erase;
      expect(getRememberedPassword()).toBeUndefined();
      expect(removed).toEqual([THEME_STORAGE_KEY]);
      expect(await listShips(openDb(dbName))).toEqual([]);
    });

    it('does not call onBlocked when the delete simply went through', async () => {
      const onBlocked = vi.fn();
      const db = openDb(name());
      await getSettings(db);
      await eraseDeviceData(db, { onBlocked });
      expect(onBlocked).not.toHaveBeenCalled();
    });
  });
});

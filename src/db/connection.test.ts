import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CrewMember } from '../domain/types';
import { createConnectionWatch } from './connection';
import { MasterpieceDB, openDb } from './schema';

/** A plain connection to the database, as another tab (or another version of the app) holds it. It does not close when asked. */
function openRaw(name: string, version: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Resolves when the watch next tells its listeners something changed. */
function nextChange(watch: { subscribe: (listener: () => void) => () => void }): Promise<void> {
  return new Promise((resolve) => {
    const stop = watch.subscribe(() => {
      stop();
      resolve();
    });
  });
}

const crew = { id: 'c-1', shipId: 's-1', deleted: false } as CrewMember;

const opened: Dexie[] = [];
function watched(name = 'conn-' + crypto.randomUUID()) {
  const watch = createConnectionWatch();
  const db = openDb(name);
  opened.push(db);
  watch.watch(db);
  return { watch, db, name };
}

afterEach(() => {
  while (opened.length > 0) opened.pop()?.close();
  vi.restoreAllMocks();
});

describe('a connection nobody has a problem with', () => {
  it('has no problem and tells nobody anything', async () => {
    const { watch, db } = watched();
    const heard = vi.fn();
    watch.subscribe(heard);
    await db.open();
    await db.crew.put(crew);
    expect(watch.problem()).toBeUndefined();
    expect(heard).not.toHaveBeenCalled();
  });
});

describe('another connection upgrades the database', () => {
  it('closes this connection for good, so that it can never write again, and says the app was updated elsewhere', async () => {
    const { watch, db, name } = watched();
    await db.open();
    const heard = nextChange(watch);
    const other = await openRaw(name, 30); // a newer version of the app, in another tab
    await heard;
    expect(watch.problem()).toBe('outdated');
    expect(db.isOpen()).toBe(false);
    // Dexie's own handler would let the next use open the database again, at a version this code knows nothing about.
    await expect(db.crew.put(crew)).rejects.toMatchObject({ name: 'DatabaseClosedError' });
    await expect(db.crew.get('c-1')).rejects.toMatchObject({ name: 'DatabaseClosedError' });
    expect(db.isOpen()).toBe(false);
    // Nothing was written.
    const count = await new Promise<number>((resolve) => {
      const request = other.transaction('crew').objectStore('crew').count();
      request.onsuccess = () => resolve(request.result);
    });
    expect(count).toBe(0);
    other.close();
  });

  it('is also what a deletion of the database elsewhere means', async () => {
    const { watch, db, name } = watched();
    await db.open();
    const heard = nextChange(watch);
    const deleted = new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    await heard;
    await deleted;
    expect(watch.problem()).toBe('outdated');
    expect(db.isOpen()).toBe(false);
  });

  it('tells its listeners once, and stays outdated', async () => {
    const { watch, db } = watched();
    await db.open();
    const heard = vi.fn();
    watch.subscribe(heard);
    const event = { oldVersion: 20, newVersion: 30 } as IDBVersionChangeEvent;
    db.on('versionchange').fire(event);
    db.on('versionchange').fire(event);
    expect(watch.problem()).toBe('outdated');
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('is not undone by a later blocked upgrade, nor by the database becoming ready', async () => {
    const { watch, db } = watched();
    await db.open();
    db.on('versionchange').fire({ oldVersion: 20, newVersion: 30 } as IDBVersionChangeEvent);
    db.on('blocked').fire({ oldVersion: 20, newVersion: 30 } as IDBVersionChangeEvent);
    expect(watch.problem()).toBe('outdated');
  });
});

describe('an upgrade is blocked by another connection', () => {
  it('says so until the other connection lets go and the database is open', async () => {
    const name = 'blocked-' + crypto.randomUUID();
    const holder = await openRaw(name, 10); // the app before this version, in another tab, that does not close when asked
    const { watch, db } = watched(name);
    const blocked = nextChange(watch);
    const opening = db.open();
    await blocked;
    expect(watch.problem()).toBe('blocked');
    const cleared = nextChange(watch);
    holder.close();
    await opening;
    await cleared;
    expect(watch.problem()).toBeUndefined();
    expect(db.isOpen()).toBe(true);
    expect(db.verno).toBe(2);
  });

  it('does not say anything for an open that is not blocked', async () => {
    const { watch, db } = watched();
    await db.open();
    expect(watch.problem()).toBeUndefined();
  });
});

describe('the watch', () => {
  it('can be left by a listener', () => {
    const watch = createConnectionWatch();
    const db = new MasterpieceDB('unused-' + crypto.randomUUID());
    opened.push(db);
    watch.watch(db);
    const heard = vi.fn();
    const stop = watch.subscribe(heard);
    stop();
    db.on('blocked').fire({ oldVersion: 10, newVersion: 20 } as IDBVersionChangeEvent);
    expect(heard).not.toHaveBeenCalled();
    expect(watch.problem()).toBe('blocked');
  });
});

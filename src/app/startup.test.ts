import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorageFullError } from '../db/storage';
import {
  BLOCKED_MESSAGE, ERASED_MESSAGE, OPEN_FAILED_MESSAGE, OUTDATED_MESSAGE, openFailureMessage, setStartup, startupNotice, startupState,
  subscribeStartup,
} from './startup';

const STORAGE_FULL = new StorageFullError().message;

describe('openFailureMessage', () => {
  it('uses the storage-full text when the disk is full, however the error arrives', () => {
    expect(openFailureMessage(new StorageFullError())).toBe(STORAGE_FULL);
    expect(openFailureMessage(new DOMException('full', 'QuotaExceededError'))).toBe(STORAGE_FULL);
    expect(openFailureMessage(Object.assign(new Error('upgrade failed'), { name: 'UpgradeError', inner: new DOMException('x', 'QuotaExceededError') }))).toBe(STORAGE_FULL);
    expect(openFailureMessage(Object.assign(new Error('bulk'), { failures: [{ name: 'QuotaExceededError' }] }))).toBe(STORAGE_FULL);
  });

  it('says it could not open its data for anything else, without repeating what the error says', () => {
    for (const err of [new Error('boom'), new DOMException('no', 'SecurityError'), 'text', undefined, null, { name: 'UnknownError' }]) {
      expect(openFailureMessage(err)).toBe(OPEN_FAILED_MESSAGE);
    }
    expect(OPEN_FAILED_MESSAGE).toBe("Masterpiece couldn't open its data. Restart the app; if it keeps happening, free some storage.");
  });
});

describe('startupNotice', () => {
  const opening = { status: 'opening' } as const;
  const ready = { status: 'ready' } as const;

  it('has nothing to say while the app opens, or once it is open', () => {
    expect(startupNotice(undefined, opening)).toBeUndefined();
    expect(startupNotice(undefined, ready)).toBeUndefined();
  });

  it('asks for a reload when another tab updated the database, and nothing else may go on', () => {
    expect(startupNotice('outdated', ready)).toEqual({ message: OUTDATED_MESSAGE, action: 'Reload', urgent: true });
    expect(startupNotice('outdated', opening)?.message).toBe('Masterpiece was updated in another tab. Reload to continue.');
    expect(startupNotice('outdated', { status: 'failed', message: 'x' })?.action).toBe('Reload');
  });

  it('says the data was erased when another tab deleted the database, with the same Reload button', () => {
    expect(startupNotice('erased', ready)).toEqual({ message: ERASED_MESSAGE, action: 'Reload', urgent: true });
    expect(ERASED_MESSAGE).toBe("Masterpiece's data was erased in another tab. Reload to continue.");
    expect(startupNotice('erased', opening)?.message).toBe(ERASED_MESSAGE);
    expect(startupNotice('erased', { status: 'failed', message: 'x' })?.action).toBe('Reload');
  });

  it('asks for the other tabs to be closed while the upgrade is blocked, with no button: it goes on by itself', () => {
    expect(startupNotice('blocked', opening)).toEqual({ message: BLOCKED_MESSAGE, urgent: false });
    expect(BLOCKED_MESSAGE).toBe('Close Masterpiece in your other tabs to finish the update.');
  });

  it('does not say blocked once the app is open', () => {
    expect(startupNotice('blocked', ready)).toBeUndefined();
  });

  it('gives guidance and Try again when the data could not be opened', () => {
    expect(startupNotice(undefined, { status: 'failed', message: OPEN_FAILED_MESSAGE })).toEqual({
      message: OPEN_FAILED_MESSAGE, action: 'Try again', urgent: true,
    });
  });

  it('puts a failure before a blocked upgrade', () => {
    expect(startupNotice('blocked', { status: 'failed', message: STORAGE_FULL })?.message).toBe(STORAGE_FULL);
  });
});

describe('the startup state', () => {
  afterEach(() => setStartup({ status: 'opening' }));

  it('starts out opening, and tells its listeners when it changes', () => {
    expect(startupState()).toEqual({ status: 'opening' });
    const heard = vi.fn();
    const stop = subscribeStartup(heard);
    setStartup({ status: 'ready' });
    expect(startupState()).toEqual({ status: 'ready' });
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    setStartup({ status: 'failed', message: 'x' });
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

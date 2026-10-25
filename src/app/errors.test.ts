import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageFullError } from '../db/storage';
import { currentError, describeError, dismissError, reportError, subscribeErrors } from './errors';

beforeEach(() => {
  dismissError();
});

describe('describeError', () => {
  it('shows the message of an Error', () => {
    expect(describeError(new Error('The file is empty.'))).toEqual({ message: 'The file is empty.' });
  });

  it('offers a backup export when storage is full', () => {
    const err = new StorageFullError();
    expect(describeError(err)).toEqual({ message: err.message, action: { label: 'Export backup', href: '#/settings' } });
  });

  it('uses a plain message when there is nothing readable to show', () => {
    const generic = 'Something went wrong. Please try again.';
    for (const reason of [undefined, null, 42, {}, new Error(''), '']) expect(describeError(reason), String(reason)).toEqual({ message: generic });
  });

  it('shows a rejection reason that is a string', () => {
    expect(describeError('Upload failed')).toEqual({ message: 'Upload failed' });
  });
});

describe('reportError', () => {
  it('keeps the latest error until it is dismissed, and tells subscribers', () => {
    const seen = vi.fn();
    const unsubscribe = subscribeErrors(seen);
    expect(currentError()).toBeUndefined();
    reportError(new Error('first'));
    reportError(new Error('second'));
    expect(currentError()).toEqual({ message: 'second' });
    expect(seen).toHaveBeenCalledTimes(2);
    dismissError();
    expect(currentError()).toBeUndefined();
    expect(seen).toHaveBeenCalledTimes(3);
    unsubscribe();
    reportError(new Error('third'));
    expect(seen).toHaveBeenCalledTimes(3);
  });
});

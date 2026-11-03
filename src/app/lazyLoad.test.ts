import { describe, expect, it, vi } from 'vitest';
import { onceLoaded, SCREEN_LOAD_FAILED } from './lazyLoad';

describe('onceLoaded', () => {
  it('loads once and gives every call the same result', async () => {
    const load = vi.fn(async () => 'screen');
    const get = onceLoaded(load, SCREEN_LOAD_FAILED);
    expect(await get()).toBe('screen');
    expect(await get()).toBe('screen');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('says a failed load in plain words, and tries again on the next call', async () => {
    const load = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module')).mockResolvedValueOnce('screen');
    const get = onceLoaded(load, SCREEN_LOAD_FAILED);
    await expect(get()).rejects.toThrow(SCREEN_LOAD_FAILED);
    expect(await get()).toBe('screen');
    expect(load).toHaveBeenCalledTimes(2);
  });
});

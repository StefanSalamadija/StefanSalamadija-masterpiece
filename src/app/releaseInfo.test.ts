import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchReleaseInfo, updateBannerText } from './releaseInfo';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('updateBannerText', () => {
  it('names the version and what is new when the release note is known', () => {
    expect(updateBannerText({ version: '1.2.0', whatsNew: 'Crew list print and Excel export.' }))
      .toBe('Version 1.2.0 — Crew list print and Excel export.');
  });

  it('falls back to a plain message without a release note', () => {
    expect(updateBannerText(null)).toBe('New version available');
  });
});

describe('fetchReleaseInfo', () => {
  it('reads ./version.json from the network, not from the HTTP cache', async () => {
    const fetchMock = stubFetch(async () => Response.json({ version: '0.2.0', whatsNew: 'Backups.' }));
    expect(await fetchReleaseInfo()).toEqual({ version: '0.2.0', whatsNew: 'Backups.' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('./version.json', { cache: 'no-store' });
  });

  it('returns null on a 404', async () => {
    stubFetch(async () => new Response('Not found', { status: 404 }));
    expect(await fetchReleaseInfo()).toBeNull();
  });

  it('returns null when the network fails', async () => {
    stubFetch(async () => { throw new TypeError('Failed to fetch'); });
    expect(await fetchReleaseInfo()).toBeNull();
  });

  it('returns null for malformed JSON', async () => {
    stubFetch(async () => new Response('{ not json', { status: 200 }));
    expect(await fetchReleaseInfo()).toBeNull();
  });

  it('returns null for JSON that is not a release note', async () => {
    for (const body of [null, 'text', 3, [], {}, { version: '1.0.0' }, { whatsNew: 'x' }, { version: 1, whatsNew: 'x' }, { version: '', whatsNew: 'x' }, { version: '1.0.0', whatsNew: '  ' }]) {
      stubFetch(async () => Response.json(body));
      expect(await fetchReleaseInfo(), JSON.stringify(body)).toBeNull();
    }
  });

  it('ignores extra fields', async () => {
    stubFetch(async () => Response.json({ version: '0.3.0', whatsNew: 'Fixes.', builtAt: 'today' }));
    expect(await fetchReleaseInfo()).toEqual({ version: '0.3.0', whatsNew: 'Fixes.' });
  });
});

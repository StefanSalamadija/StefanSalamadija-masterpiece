import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shareOrDownload } from './share';

/** The few browser APIs `shareOrDownload` touches, as stubs: the vitest environment is plain Node, with no DOM. */
function stubBrowser(nav: { canShare?: () => boolean; share?: () => Promise<void> }) {
  const link = { href: '', download: '', click: vi.fn() };
  vi.stubGlobal('navigator', nav);
  vi.stubGlobal('document', { createElement: vi.fn(() => link) });
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  return { link, create, revoke };
}

const domError = (name: string) => new DOMException('nope', name);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('shareOrDownload', () => {
  it('shares the file when the browser can share files', async () => {
    const share = vi.fn(async () => {});
    const { link } = stubBrowser({ canShare: () => true, share });
    expect(await shareOrDownload('a.mpbak', 'data')).toBe('shared');
    expect(share).toHaveBeenCalledOnce();
    const arg = (share.mock.calls[0] as unknown as [{ files: File[]; title: string }])[0];
    expect(arg.title).toBe('a.mpbak');
    expect(arg.files).toHaveLength(1);
    expect(arg.files[0]).toMatchObject({ name: 'a.mpbak', type: 'application/octet-stream' });
    expect(link.click).not.toHaveBeenCalled();
  });

  it('reports "cancelled", and downloads nothing, when the user closes the share sheet', async () => {
    const { link } = stubBrowser({ canShare: () => true, share: async () => { throw domError('AbortError'); } });
    expect(await shareOrDownload('a.mpbak', 'data')).toBe('cancelled');
    expect(link.click).not.toHaveBeenCalled();
  });

  it('downloads instead when sharing fails for any other reason, such as an expired user activation', async () => {
    const { link } = stubBrowser({ canShare: () => true, share: async () => { throw domError('NotAllowedError'); } });
    expect(await shareOrDownload('a.mpbak', 'data')).toBe('downloaded');
    expect(link).toMatchObject({ href: 'blob:test', download: 'a.mpbak' });
    expect(link.click).toHaveBeenCalledOnce();
  });

  it('downloads when the browser cannot share files, and revokes the object URL afterwards', async () => {
    const { link, create, revoke } = stubBrowser({});
    expect(await shareOrDownload('a.mpbak', 'data')).toBe('downloaded');
    expect(create).toHaveBeenCalledOnce();
    expect(link.click).toHaveBeenCalledOnce();
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:test');
  });

  it('downloads when canShare says the file cannot be shared', async () => {
    const share = vi.fn(async () => {});
    const { link } = stubBrowser({ canShare: () => false, share });
    expect(await shareOrDownload('a.mpbak', 'data')).toBe('downloaded');
    expect(share).not.toHaveBeenCalled();
    expect(link.click).toHaveBeenCalledOnce();
  });
});

import { describe, expect, it } from 'vitest';
import type { LibraryDoc } from '../domain/types';
import { deletedText, metaText, parseTags, recentlyOpened, restorable, sizeText, sortDocs, statusLabel, storageText } from './libraryView';

const d = (over: Partial<LibraryDoc>): LibraryDoc => ({
  id: 'x', title: 'T', tags: [], fileName: 'f.pdf', mimeType: '', kind: 'pdf', size: 1024 * 1024, sha256: 's', textStatus: 'indexed',
  addedAt: '2026-11-01T00:00:00Z', scope: 'personal', deleted: false, updatedAt: '', updatedBy: '', ...over,
} as LibraryDoc);

describe('libraryView', () => {
  it('words size, meta and status', () => {
    expect(sizeText(1024 * 1024 * 1.25)).toBe('1.3 MB');
    expect(sizeText(10)).toBe('<0.1 MB');
    expect(metaText(d({ pageCount: 3 }))).toBe('PDF · 1.0 MB · 3 pages');
    expect(metaText(d({ kind: 'docx', pageCount: 1 }))).toBe('DOCX · 1.0 MB · 1 page');
    expect(statusLabel(d({ textStatus: 'no-text' }), true)).toBe('No searchable text');
    expect(statusLabel(d({ textStatus: 'failed' }), true)).toBe('Text could not be read');
    expect(statusLabel(d({}), false)).toBe('File not on this device');
    expect(statusLabel(d({}), true)).toBeUndefined();
  });
  it('sorts and picks recently opened', () => {
    const a = d({ id: 'a', title: 'B', addedAt: '2026-11-01', openedAt: '2026-11-05' });
    const b = d({ id: 'b', title: 'A', addedAt: '2026-11-02' });
    expect(sortDocs([a, b], 'title').map((x) => x.id)).toEqual(['b', 'a']);
    expect(sortDocs([a, b], 'added').map((x) => x.id)).toEqual(['b', 'a']);
    expect(sortDocs([b, a], 'opened').map((x) => x.id)).toEqual(['a', 'b']);
    expect(recentlyOpened([a, b]).map((x) => x.id)).toEqual(['a']);
  });
  it('words deletion and storage, and keeps only restorable ones', () => {
    expect(deletedText('2026-11-15T10:00:00Z')).toBe('Deleted 15-NOV-2026 · removed after 15-DEC-2026');
    expect(storageText(12.3 * 1024 ** 2, 4 * 1024 ** 3)).toBe('12.3 MB of 4.0 GB used');
    const now = new Date('2026-11-15T00:00:00Z');
    const fresh = d({ id: 'f', deleted: true, deletedAt: '2026-11-10T00:00:00Z' });
    const old = d({ id: 'o', deleted: true, deletedAt: '2026-09-01T00:00:00Z' });
    expect(restorable([fresh, old], now).map((x) => x.id)).toEqual(['f']);
  });
  it('parses tags', () => {
    expect(parseTags(' pump, Oil ,, pump,oil ')).toEqual(['pump', 'Oil']);
  });
});

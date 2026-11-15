import { describe, expect, it } from 'vitest';
import type { LibraryDoc, LibraryFolder, LibraryTextRow } from '../domain/types';
import { highlightRanges, normaliseText, queryWords, searchLibrary } from './search';

function doc(id: string, over: Partial<LibraryDoc> = {}): LibraryDoc {
  return {
    id, scope: 'personal', title: `Doc ${id}`, tags: [], fileName: `${id}.pdf`, mimeType: 'application/pdf', kind: 'pdf', size: 1,
    sha256: id, textStatus: 'indexed', addedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deleted: false,
    ...over,
  } as LibraryDoc;
}
function row(docId: string, part: number, text: string): LibraryTextRow {
  return { id: `${docId}:${part}`, docId, part, label: `Page ${part}`, text: normaliseText(text) };
}
const search = (docs: LibraryDoc[], text: LibraryTextRow[], query: string, folders: LibraryFolder[] = []) =>
  searchLibrary({ docs, folders, text, query });

describe('normaliseText and queryWords', () => {
  it('lowercases, strips diacritics and collapses whitespace', () => {
    expect(normaliseText('  Šifra   BRODA\n Đ ')).toBe('sifra broda đ');
  });
  it('drops 1-letter words and duplicates', () => {
    expect(queryWords('A Šifra b sifra  ok')).toEqual(['sifra', 'ok']);
  });
});

describe('searchLibrary', () => {
  it('matches "Šifra" against normalised text and inside words', () => {
    const hits = search([doc('a')], [row('a', 1, 'Sifra broda je tajna')], 'Šifra');
    expect(hits).toHaveLength(1);
    expect(hits[0].byMeta).toBe(false);
    expect(hits[0].parts[0].part).toBe(1);
    expect(search([doc('a')], [row('a', 1, 'inspection report')], 'inspect')).toHaveLength(1);
  });

  it('needs every word within one part', () => {
    const text = [row('a', 1, 'anchor chain'), row('a', 2, 'engine room')];
    expect(search([doc('a')], text, 'anchor engine')).toHaveLength(0);
    expect(search([doc('a')], [...text, row('a', 3, 'anchor and engine')], 'anchor engine')[0].parts.map((p) => p.part)).toEqual([3]);
  });

  it('combines a meta match with a text match', () => {
    const d = doc('a', { title: 'Fire Manual', tags: ['safety'] });
    const folders = [{ id: 'f', name: 'Šuma' } as LibraryFolder];
    const text = [row('a', 1, 'drill every month'), row('a', 2, 'nothing')];
    const hits = search([{ ...d, folderId: 'f' }], text, 'fire drill', folders);
    expect(hits).toHaveLength(1);
    expect(hits[0].parts.map((p) => p.part)).toEqual([1]);
    expect(hits[0].byMeta).toBe(false);
    expect(search([d], text, 'fire safety')[0].byMeta).toBe(true);
    expect(search([{ ...d, folderId: 'f' }], [], 'suma manual', folders)[0].byMeta).toBe(true);
  });

  it('ignores 1-letter words and empty queries', () => {
    expect(search([doc('a')], [row('a', 1, 'x marks')], 'x marks')).toHaveLength(1);
    expect(search([doc('a')], [row('a', 1, 'x marks')], 'x')).toEqual([]);
    expect(search([doc('a')], [row('a', 1, 'x marks')], '  ')).toEqual([]);
  });

  it('skips deleted documents', () => {
    expect(search([doc('a', { deleted: true })], [row('a', 1, 'anchor')], 'anchor')).toEqual([]);
  });

  it('returns at most 3 parts and counts the rest', () => {
    const text = [1, 2, 3, 4, 5].map((n) => row('a', n, 'anchor'));
    const [hit] = search([doc('a')], text, 'anchor');
    expect(hit.parts.map((p) => p.part)).toEqual([1, 2, 3]);
    expect(hit.moreParts).toBe(2);
  });

  it('caps the list at 50 documents', () => {
    const docs = Array.from({ length: 60 }, (_, i) => doc(`d${i}`));
    const text = docs.map((d) => row(d.id, 1, 'anchor'));
    expect(search(docs, text, 'anchor')).toHaveLength(50);
  });

  it('ranks meta, then more parts, then most recently opened', () => {
    const docs = [
      doc('few', { openedAt: '2026-05-01T00:00:00.000Z' }),
      doc('many', { openedAt: '2026-01-02T00:00:00.000Z' }),
      doc('meta', { title: 'anchor guide' }),
      doc('manyNew', { openedAt: '2026-06-01T00:00:00.000Z' }),
    ];
    const text = [
      row('few', 1, 'anchor'),
      row('many', 1, 'anchor'), row('many', 2, 'anchor'),
      row('manyNew', 1, 'anchor'), row('manyNew', 2, 'anchor'),
    ];
    expect(search(docs, text, 'anchor').map((h) => h.docId)).toEqual(['meta', 'manyNew', 'many', 'few']);
  });

  it('falls back to addedAt when never opened', () => {
    const docs = [doc('old', { addedAt: '2026-01-01T00:00:00.000Z' }), doc('new', { addedAt: '2026-03-01T00:00:00.000Z' })];
    const text = [row('old', 1, 'anchor'), row('new', 1, 'anchor')];
    expect(search(docs, text, 'anchor').map((h) => h.docId)).toEqual(['new', 'old']);
  });

  describe('snippets', () => {
    const filler = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
    it('is about 160 characters, cut at word edges with ellipses on cut sides', () => {
      const text = `${filler(60)} target ${filler(60)}`;
      const s = search([doc('a')], [row('a', 1, text)], 'target')[0].parts[0].snippet;
      expect(s.startsWith('…')).toBe(true);
      expect(s.endsWith('…')).toBe(true);
      expect(s).toContain('target');
      expect(s.length).toBeGreaterThan(120);
      expect(s.length).toBeLessThanOrEqual(164);
      const inner = s.slice(1, -1);
      expect(inner).toMatch(/^word\d+/);
      expect(inner).toMatch(/word\d+$/);
    });
    it('has no ellipsis when the whole text fits', () => {
      const s = search([doc('a')], [row('a', 1, 'short anchor text')], 'anchor')[0].parts[0].snippet;
      expect(s).toBe('short anchor text');
    });
    it('has an ellipsis only on the right when the match is near the start', () => {
      const s = search([doc('a')], [row('a', 1, `anchor ${filler(80)}`)], 'anchor')[0].parts[0].snippet;
      expect(s.startsWith('anchor')).toBe(true);
      expect(s.endsWith('…')).toBe(true);
    });
  });
});

describe('highlightRanges', () => {
  it('finds every occurrence of every word', () => {
    expect(highlightRanges('the anchor and the chain', ['anchor', 'the'])).toEqual([[0, 3], [4, 10], [15, 18]]);
  });
  it('merges overlapping ranges', () => {
    expect(highlightRanges('inspection', ['inspect', 'ction'])).toEqual([[0, 10]]);
  });
  it('returns nothing for no words', () => {
    expect(highlightRanges('abc', [])).toEqual([]);
  });
});

describe('performance', () => {
  it('searches 2,000 parts of about 2,000 characters in under 300 ms', () => {
    const docs: LibraryDoc[] = [];
    const text: LibraryTextRow[] = [];
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const vocab = Array.from({ length: 500 }, (_, i) => `term${i.toString(36)}x`);
    for (let d = 0; d < 20; d++) {
      docs.push(doc(`d${d}`));
      for (let p = 1; p <= 100; p++) {
        const words: string[] = [];
        let len = 0;
        while (len < 2000) { const w = vocab[Math.floor(rnd() * vocab.length)]; words.push(w); len += w.length + 1; }
        text.push(row(`d${d}`, p, words.join(' ')));
      }
    }
    const t0 = performance.now();
    const hits = search(docs, text, 'terma term1x zzzz');
    const t1 = performance.now();
    search(docs, text, 'term5 term7x');
    const t2 = performance.now();
    expect(hits).toEqual([]);
    expect(t1 - t0).toBeLessThan(300);
    expect(t2 - t1).toBeLessThan(300);
  });
});

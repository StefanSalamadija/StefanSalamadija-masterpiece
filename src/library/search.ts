import type { LibraryDoc, LibraryFolder, LibraryTextRow } from '../domain/types';

const MAX_DOCS = 50;
const MAX_PARTS = 3;
const SNIPPET_LENGTH = 160;

export interface SearchHit {
  docId: string;
  /** Every word is in the title, tags or folder name. */
  byMeta: boolean;
  parts: { part: number; label: string; snippet: string }[];
  /** Matching parts beyond the ones listed. */
  moreParts: number;
}

/** Lowercase, diacritics removed, whitespace collapsed. */
export function normaliseText(s: string): string {
  return s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** The normalised, unique query words of two or more characters. */
export function queryWords(q: string): string[] {
  const out: string[] = [];
  for (const w of normaliseText(q).split(' ')) if (w.length >= 2 && !out.includes(w)) out.push(w);
  return out;
}

/** About 160 characters around the first match of `word`, cut at word edges, with `…` on each cut side. */
function snippetOf(text: string, word: string): string {
  if (text.length <= SNIPPET_LENGTH) return text;
  const at = Math.max(0, text.indexOf(word));
  let start = Math.max(0, at + Math.floor(word.length / 2) - SNIPPET_LENGTH / 2);
  let end = Math.min(text.length, start + SNIPPET_LENGTH);
  start = Math.max(0, end - SNIPPET_LENGTH);
  if (start > 0) {
    if (text[start - 1] !== ' ' && text[start] !== ' ') {
      const sp = text.indexOf(' ', start);
      start = sp === -1 || sp >= at ? start : sp + 1;
    } else if (text[start] === ' ') start++;
  }
  if (end < text.length) {
    if (text[end] !== ' ' && text[end - 1] !== ' ') {
      const sp = text.lastIndexOf(' ', end);
      end = sp <= at + word.length || sp < start ? end : sp;
    } else if (text[end - 1] === ' ') end--;
  }
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

export function searchLibrary(input: { docs: LibraryDoc[]; folders: LibraryFolder[]; text: LibraryTextRow[]; query: string }): SearchHit[] {
  const words = queryWords(input.query);
  if (words.length === 0) return [];
  const folderName = new Map(input.folders.map((f) => [f.id, normaliseText(f.name)]));
  const rowsByDoc = new Map<string, LibraryTextRow[]>();
  for (const r of input.text) {
    const list = rowsByDoc.get(r.docId);
    if (list) list.push(r); else rowsByDoc.set(r.docId, [r]);
  }
  const found: { hit: SearchHit; count: number; when: string }[] = [];
  for (const d of input.docs) {
    if (d.deleted) continue;
    const meta = normaliseText([d.title, ...d.tags, d.folderId ? folderName.get(d.folderId) ?? '' : ''].join(' '));
    const rest = words.filter((w) => !meta.includes(w));
    const needed = rest.length > 0 ? rest : words;
    const matches: { part: number; label: string; snippet: string }[] = [];
    for (const r of (rowsByDoc.get(d.id) ?? []).slice().sort((a, b) => a.part - b.part)) {
      if (needed.every((w) => r.text.includes(w))) matches.push({ part: r.part, label: r.label, snippet: snippetOf(r.text, needed[0]) });
    }
    const byMeta = rest.length === 0;
    if (!byMeta && matches.length === 0) continue;
    found.push({
      hit: { docId: d.id, byMeta, parts: matches.slice(0, MAX_PARTS), moreParts: Math.max(0, matches.length - MAX_PARTS) },
      count: matches.length,
      when: d.openedAt ?? d.addedAt,
    });
  }
  found.sort((a, b) => Number(b.hit.byMeta) - Number(a.hit.byMeta) || b.count - a.count || (a.when < b.when ? 1 : a.when > b.when ? -1 : 0));
  return found.slice(0, MAX_DOCS).map((f) => f.hit);
}

/** The merged `[start, end)` ranges of every occurrence of every word in the snippet. */
export function highlightRanges(snippet: string, words: string[]): [number, number][] {
  const raw: [number, number][] = [];
  for (const w of words) {
    if (!w) continue;
    for (let i = snippet.indexOf(w); i !== -1; i = snippet.indexOf(w, i + 1)) raw.push([i, i + w.length]);
  }
  raw.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: [number, number][] = [];
  for (const r of raw) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else out.push([r[0], r[1]]);
  }
  return out;
}

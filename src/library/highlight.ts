import { foldText } from './search';


/** A document's viewer position, as carried in the hash: `#/library/doc/<id>?page=3&q=ballast%20exch`. */
export interface DocParams { page?: number; q: string }

/** Reads `page` (a whole number from 1) and `q` from a hash. Anything else is left out. */
export function parseDocParams(hash: string): DocParams {
  const at = hash.indexOf('?');
  const params = new URLSearchParams(at === -1 ? '' : hash.slice(at + 1));
  const n = Number(params.get('page'));
  return { ...(Number.isInteger(n) && n >= 1 ? { page: n } : {}), q: params.get('q') ?? '' };
}

/** The hash of a document, at a page and with the words to mark. */
export function docHref(id: string, page?: number, q?: string): string {
  const params: string[] = [];
  if (page !== undefined) params.push(`page=${page}`);
  if (q && q.trim()) params.push(`q=${encodeURIComponent(q)}`);
  return `#/library/doc/${id}${params.length ? `?${params.join('&')}` : ''}`;
}

/** The text in the form the search compares (lowercase, no diacritics), each character with where it came from in `text`. */
function normalisedWithMap(text: string): { norm: string; from: number[] } {
  let norm = '';
  const from: number[] = [];
  let i = 0;
  for (const ch of text) {
    const piece = foldText(ch);
    for (let k = 0; k < piece.length; k++) from.push(i);
    norm += piece;
    i += ch.length;
  }
  return { norm, from };
}

/**
 * The `[start, end)` ranges in `text` (as it is, with its case and diacritics) of every occurrence of every word,
 * merged where they touch. `words` are normalised, as `queryWords` gives them.
 */
export function matchRanges(text: string, words: string[]): [number, number][] {
  const { norm, from } = normalisedWithMap(text);
  const raw: [number, number][] = [];
  for (const w of words) {
    if (!w) continue;
    for (let at = norm.indexOf(w); at !== -1; at = norm.indexOf(w, at + 1)) {
      const last = at + w.length - 1;
      // The match ends after its last character and any combining marks that follow it.
      let end = from[last] + String.fromCodePoint(text.codePointAt(from[last]) ?? 0).length;
      for (let ch = text.codePointAt(end); ch !== undefined && /^\p{M}$/u.test(String.fromCodePoint(ch)); ch = text.codePointAt(end)) {
        end += String.fromCodePoint(ch).length;
      }
      raw.push([from[at], end]);
    }
  }
  raw.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: [number, number][] = [];
  for (const r of raw) {
    const prev = out[out.length - 1];
    if (prev && r[0] <= prev[1]) prev[1] = Math.max(prev[1], r[1]); else out.push([r[0], r[1]]);
  }
  return out;
}

/** The pages (part numbers, in order) whose text holds every word, which is how the search decides. */
export function partsWithWords(rows: { part: number; text: string }[], words: string[]): number[] {
  if (words.length === 0) return [];
  return rows.filter((r) => words.every((w) => r.text.includes(w))).map((r) => r.part).sort((a, b) => a - b);
}


import { describe, expect, it } from 'vitest';
import { docHref, matchRanges, parseDocParams, partsWithWords } from './highlight';

describe('parseDocParams / docHref', () => {
  it('reads page and q, ignoring a bad page', () => {
    expect(parseDocParams('#/library/doc/a?page=3&q=ballast%20exch')).toEqual({ page: 3, q: 'ballast exch' });
    expect(parseDocParams('#/library/doc/a')).toEqual({ q: '' });
    expect(parseDocParams('#/library/doc/a?page=0&q=x')).toEqual({ q: 'x' });
    expect(parseDocParams('#/library/doc/a?page=abc')).toEqual({ q: '' });
  });
  it('builds a hash that parses back', () => {
    const href = docHref('a', 3, 'ballast & exch');
    expect(parseDocParams(href)).toEqual({ page: 3, q: 'ballast & exch' });
    expect(docHref('a')).toBe('#/library/doc/a');
  });
});

describe('matchRanges', () => {
  it('ignores case and diacritics and maps back to the original text', () => {
    const text = 'Ballast EXCHANGE at Šašić';
    expect(matchRanges(text, ['ballast', 'exch', 'sasic']).map(([s, e]) => text.slice(s, e))).toEqual(['Ballast', 'EXCH', 'Šašić']);
  });
  it('merges overlapping matches and finds repeats', () => {
    expect(matchRanges('abcabc', ['abc', 'bca'])).toEqual([[0, 6]]);
    expect(matchRanges('xx x', ['x'])).toEqual([[0, 2], [3, 4]]);
  });
  it('handles decomposed accents and letters that lower-case to two', () => {
    const text = 'Café İstanbul';
    expect(matchRanges(text, ['cafe']).map(([s, e]) => text.slice(s, e))).toEqual(['Café']);
    expect(matchRanges(text, ['stanbul']).map(([s, e]) => text.slice(s, e))).toEqual(['stanbul']);
  });
  it('finds nothing for no words', () => {
    expect(matchRanges('abc', [])).toEqual([]);
  });
});

describe('partsWithWords', () => {
  it('lists the parts with every word, in order', () => {
    const rows = [{ part: 3, text: 'ballast exchange' }, { part: 1, text: 'ballast' }, { part: 2, text: 'exchange of ballast' }];
    expect(partsWithWords(rows, ['ballast', 'exch'])).toEqual([2, 3]);
    expect(partsWithWords(rows, [])).toEqual([]);
  });
});

describe('matchRanges with folded letters', () => {
  it('covers the whole of ß for "strasse"', () => {
    const text = 'Die Straße ist lang';
    expect(matchRanges(text, ['strasse']).map(([s, e]) => text.slice(s, e))).toEqual(['Straße']);
    expect(matchRanges(text, ['ss']).map(([s, e]) => text.slice(s, e))).toEqual(['ß']);
  });
  it('matches Øst with "ost" and Uređaj with "uredaj"', () => {
    expect(matchRanges('Øst', ['ost']).map(([s, e]) => [s, e])).toEqual([[0, 3]]);
    const t = 'x Uređaj y';
    expect(matchRanges(t, ['uredaj']).map(([s, e]) => t.slice(s, e))).toEqual(['Uređaj']);
  });
});

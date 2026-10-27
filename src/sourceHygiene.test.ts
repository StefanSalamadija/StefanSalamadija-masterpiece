import { describe, expect, it } from 'vitest';

/*
 * Source that cannot be read. A literal invisible character (a zero-width space, a bidi override, a byte order mark) in
 * a string, a regular expression or a comment cannot be seen in a review, and can make code read differently from what
 * it does: the "Trojan Source" attack. Where such a character is needed it is written as an escape (`\u200B`), which can
 * be read. The text of the app and of its end-to-end tests is scanned here, so that none gets in.
 *
 * The files are read through Vite's `import.meta.glob` (as raw text), which needs no Node types.
 */
const sources: Record<string, string> = {
  ...import.meta.glob<string>('./**/*.{ts,tsx,css}', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob<string>('../e2e/**/*.{ts,tsx,css}', { query: '?raw', import: 'default', eager: true }),
};

/** Control characters other than tab and line breaks, and every format character: zero-width ones, bidi controls (the Arabic letter mark too), the byte order mark, tags. */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Bidi_Control}]/u;
const ALLOWED = new Set([0x09, 0x0a, 0x0d]);

function invisibleCharacters(text: string): { line: number; codePoint: string }[] {
  const found: { line: number; codePoint: string }[] = [];
  text.split('\n').forEach((line, index) => {
    for (const character of line) {
      const code = character.codePointAt(0)!;
      if (!ALLOWED.has(code) && INVISIBLE.test(character)) {
        found.push({ line: index + 1, codePoint: `U+${code.toString(16).toUpperCase().padStart(4, '0')}` });
      }
    }
  });
  return found;
}

describe('invisibleCharacters', () => {
  // Built from code points: this file must not contain any itself.
  const hidden = [0x0000, 0x0085, 0x00ad, 0x061c, 0x200b, 0x200e, 0x202e, 0x2060, 0x2066, 0xfeff, 0xe0041].map((code) => String.fromCodePoint(code));

  it.each(hidden.map((character) => [`U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`, character]))(
    'finds %s', (_name, character) => {
      expect(invisibleCharacters(`const a = 1;\nconst b = 'x${character}y';`)).toEqual([{ line: 2, codePoint: _name }]);
    },
  );

  it('leaves tabs, line breaks, accented letters, dashes, ellipses and emoji alone', () => {
    expect(invisibleCharacters('\tconst a = "Šašić — ć… \u{1F600}";\r\n\n')).toEqual([]);
  });
});

describe('the source of the app and of its end-to-end tests', () => {
  it('is all scanned', () => {
    const names = Object.keys(sources);
    expect(names.length).toBeGreaterThan(100);
    expect(names).toContain('./ui/importReview.ts');
    expect(names).toContain('../e2e/backup.spec.ts');
  });

  it('holds no invisible character: where one is needed it is written as an escape', () => {
    const found = Object.entries(sources).flatMap(([file, text]) => invisibleCharacters(text).map(({ line, codePoint }) => `${file}:${line} ${codePoint}`));
    expect(found).toEqual([]);
  });
});

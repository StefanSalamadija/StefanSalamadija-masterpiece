import { usableDateHint } from '../format';

/*
 * Excel number formats: what a cell's format says it holds, and a date format as a hint `formatDate` can render.
 *
 * A format is a built-in id (0 to 49, whose code Excel does not write into the file) or a custom code from
 * `styles.xml` (`dd\-mmm\-yyyy`, `0.0`). Codes are read as Excel reads them: quoted text (`"Day "`), an escaped
 * character (`\-`), a bracket (`[$-409]`, `[Red]`), a space the width of a character (`_)`) and a fill character (`*-`)
 * are literal, not format letters.
 */

/** What a cell's number format says it holds. */
export type FormatKind = 'date' | 'time' | 'number' | 'text';

/**
 * The codes of the built-in formats Excel writes by id alone, as Excel shows them in an English locale. Ids 14 to 17
 * and 22 show the date in the locale of the computer that opens the file, so their code here is only a description.
 */
const BUILT_IN: Readonly<Record<number, string>> = {
  0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00', 12: '# ?/?', 13: '# ??/??',
  14: 'mm-dd-yy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss',
  22: 'm/d/yy h:mm', 37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)', 39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)',
  45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mmss.0', 48: '##0.0E+0', 49: '@',
};

/** The code of a built-in format, or `undefined` for an id that is not one. */
export function builtInFormat(id: number): string | undefined {
  return Object.hasOwn(BUILT_IN, id) ? BUILT_IN[id] : undefined;
}

/**
 * The letters of a code that format the value, without its literal parts: quoted text, escaped characters, brackets
 * (except elapsed time, `[h]`, `[mm]`, `[ss]`, kept as `h`), `_x` and `*x`. Lower case.
 */
function formatLetters(code: string): string {
  let out = '';
  for (let i = 0; i < code.length; i += 1) {
    const ch = code[i]!;
    if (ch === '"') {
      const end = code.indexOf('"', i + 1);
      i = end < 0 ? code.length : end;
    } else if (ch === '\\' || ch === '_' || ch === '*') {
      i += 1;
    } else if (ch === '[') {
      const end = code.indexOf(']', i + 1);
      const inside = code.slice(i + 1, end < 0 ? code.length : end);
      if (/^[hms]+$/i.test(inside)) out += 'h';
      i = end < 0 ? code.length : end;
    } else {
      out += ch.toLowerCase();
    }
  }
  return out;
}

/**
 * What a cell with this format holds (spec §5.2):
 * - `date`: the built-in ids 14 to 17 and 22, or a code with a day, a month and a year (`d`, `m`, `y`);
 * - `time`: the built-in ids 18 to 21 and 45 to 47, or a code with hours or seconds and no date (`h:mm`, `[h]:mm`);
 * - `number`: any other built-in id but General (0) and Text (49), or a code with a digit placeholder (`0`, `#`, `?`);
 * - `text`: General, Text (`@`), and anything else.
 *
 * The brief makes all of 14 to 22 dates; 18 to 21 (`h:mm` and the like, which Excel gives a cell when a time is typed
 * into it) are kept as times instead, so that a time column is not asked for as a date.
 */
export function kindOfFormat(id: number, code: string | undefined): FormatKind {
  if ((id >= 14 && id <= 17) || id === 22) return 'date';
  if ((id >= 18 && id <= 21) || (id >= 45 && id <= 47)) return 'time';
  if (id === 0 || id === 49) return 'text';
  if (code === undefined) return id < 164 && builtInFormat(id) !== undefined ? 'number' : 'text';
  const letters = formatLetters(code);
  if (/d/.test(letters) && /m/.test(letters) && /y/.test(letters)) return 'date';
  if (/[hs]/.test(letters) && !/[dy]/.test(letters)) return 'time';
  if (/[0#?]/.test(letters)) return 'number';
  return 'text';
}

/** A run of one date letter, as `formatDate` reads them. */
const RUNS = /([dmy])\1*/gi;

/**
 * A date format's code as a hint `formatDate` renders the same way (`dd\-mmm\-yyyy` → `dd-mmm-yyyy`), or `undefined`
 * when it cannot: a time in it (`h`, `s`, `AM/PM`), a letter it does not know (`e`, `b`, `g`), a run it does not render
 * (`mmmmm`, `yyy`), or literal text that it would read as a date letter (`"de"`). Only the first section (before `;`)
 * is used. Brackets (`[$-409]`, `[Red]`) are dropped.
 */
export function dateHintOf(code: string): string | undefined {
  let hint = '';
  for (let i = 0; i < code.length; i += 1) {
    const ch = code[i]!;
    let literal: string | undefined;
    if (ch === ';') break;
    if (ch === '"') {
      const end = code.indexOf('"', i + 1);
      if (end < 0) return undefined;
      literal = code.slice(i + 1, end);
      i = end;
    } else if (ch === '\\') {
      literal = code[i + 1] ?? '';
      i += 1;
    } else if (ch === '[') {
      const end = code.indexOf(']', i + 1);
      if (end < 0 || /^[hms]+$/i.test(code.slice(i + 1, end))) return undefined;
      i = end;
      continue;
    } else if (ch === '_') {
      literal = ' ';
      i += 1;
    } else if (ch === '*') {
      i += 1;
      continue;
    } else if (/[dmy]/i.test(ch)) {
      hint += ch;
      continue;
    } else if (/[\p{L}\p{N}]/u.test(ch)) {
      return undefined; // a time, an era or a digit placeholder: not a plain date
    } else {
      literal = ch;
    }
    if (/[dmy]/i.test(literal)) return undefined;
    hint += literal;
  }
  hint = hint.trim();
  const runs = [...hint.matchAll(RUNS)];
  if (runs.length === 0) return undefined;
  const renderable = runs.every(([run, letter]) => {
    const n = run.length;
    return letter!.toLowerCase() === 'y' ? n === 2 || n === 4 : n <= 4;
  });
  return renderable ? usableDateHint(hint) : undefined;
}

import { formatDisplayDate, isValidIsoDate } from '../domain/dates';

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const LONG_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** A run of one letter that stands for a part of a date, in either case. `([dmy])\1*` is one letter and the repeats of it. */
const DATE_LETTERS = /([dmy])\1*/gi;

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/**
 * A date as a form asks for it. `iso` is `YYYY-MM-DD` and `hint` is a pattern made of these tokens, each a run of the
 * same letter, in either case:
 * - `d` the day, `dd` the day with 2 digits;
 * - `M` the month number, `MM` the month with 2 digits (`m` and `mm` do the same: a hint is of a date alone, so they are
 *   never minutes), `MMM` the month as `Oct`, `MMMM` the month as `October`;
 * - `yy` the year with 2 digits, `yyyy` the year with 4.
 *
 * Every other character is kept as it is, and so is a run of d, m or y that is not one of those (`dddd`, `yyy`).
 * `formatDate('2026-10-28', 'dd/MMM/yyyy')` is `28/Oct/2026`.
 *
 * With no hint (or an empty one), or a hint with no token in it (`(24:00 UTC)`), it is the app's own display date, `28-OCT-2026`. Text that is not a real date is given
 * back as it is, as `formatDisplayDate` does, so that a value from a damaged file is shown and never made up.
 */
export function formatDate(iso: string, hint?: string): string {
  if (!isValidIsoDate(iso)) return iso;
  if (hint === undefined || hint.trim() === '') return formatDisplayDate(iso);
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  let tokens = 0;
  const text = hint.replace(DATE_LETTERS, (run: string, letter: string) => {
    const token = tokenOf(letter.toLowerCase(), run.length, { year, month, day });
    if (token === undefined) return run;
    tokens += 1;
    return token;
  });
  // A hint with no date token in it (`(24:00 UTC)`) says nothing about the date, so the display date is used.
  return tokens === 0 ? formatDisplayDate(iso) : text;
}

/** What a run of `length` of the letter `d`, `m` or `y` stands for, or `undefined` when the run is not a token. */
function tokenOf(letter: string, length: number, date: { year: number; month: number; day: number }): string | undefined {
  switch (letter) {
    case 'd':
      return length === 1 ? String(date.day) : length === 2 ? pad(date.day, 2) : undefined;
    case 'm':
      if (length === 1) return String(date.month);
      if (length === 2) return pad(date.month, 2);
      return length === 3 ? SHORT_MONTHS[date.month - 1] : length === 4 ? LONG_MONTHS[date.month - 1] : undefined;
    default: // 'y'
      return length === 2 ? pad(date.year, 4).slice(2) : length === 4 ? pad(date.year, 4) : undefined;
  }
}

const DISPLAY_DATE = /^(\d{2})-([A-Z]{3})-(\d{4})$/;

/** A month's number (1 to 12) from its name, short or long, in any case; 0 when it is none. */
function monthOf(name: string): number {
  const lower = name.toLowerCase();
  const i = SHORT_MONTHS.findIndex((m, k) => m.toLowerCase() === lower || LONG_MONTHS[k].toLowerCase() === lower);
  return i + 1;
}

/**
 * The ISO date that `formatDate(iso, hint)` gives `text` for, or `undefined` when there is none: the inverse of
 * `formatDate`, for reading back what a writer wrote. Only text formatDate would write is read, exactly (`28/oct/2026`
 * is not `dd/MMM/yyyy`), so the date read is the one written and never a guess. A hint must give the day, the month and
 * the year to be read; with no hint, or a hint with no token, the text is the display date (`28-OCT-2026`). A 2-digit
 * year is taken to be 20xx.
 */
export function parseDate(text: string, hint?: string): string | undefined {
  const parts: { day?: number; month?: number; year?: number } = {};
  let tokens = 0;
  const readers: ((s: string) => void)[] = [];
  let pattern = '';
  let last = 0;
  const pieces = hint === undefined || hint.trim() === '' ? [] : [...hint.matchAll(DATE_LETTERS)];
  for (const piece of pieces) {
    const run = piece[0];
    const letter = piece[1].toLowerCase();
    const length = run.length;
    const group = letter === 'd' && length <= 2 ? '(\\d{1,2})'
      : letter === 'm' && length <= 2 ? '(\\d{1,2})'
        : letter === 'm' && length <= 4 ? '(\\p{L}+)'
          : letter === 'y' && (length === 2 || length === 4) ? `(\\d{${length}})` : undefined;
    pattern += escapeRegExp(hint!.slice(last, piece.index)) + (group ?? escapeRegExp(run));
    last = piece.index + length;
    if (group === undefined) continue;
    tokens += 1;
    if (letter === 'd') readers.push((s) => { parts.day = Number(s); });
    else if (letter === 'm') readers.push(length <= 2 ? (s) => { parts.month = Number(s); } : (s) => { parts.month = monthOf(s); });
    else readers.push(length === 2 ? (s) => { parts.year = 2000 + Number(s); } : (s) => { parts.year = Number(s); });
  }
  if (tokens === 0) {
    const match = DISPLAY_DATE.exec(text);
    if (!match) return undefined;
    Object.assign(parts, { day: Number(match[1]), month: monthOf(match[2]), year: Number(match[3]) });
  } else {
    pattern += escapeRegExp(hint!.slice(last));
    const match = new RegExp(`^${pattern}$`, 'u').exec(text);
    if (!match) return undefined;
    readers.forEach((read, i) => read(match[i + 1]));
  }
  const { day, month, year } = parts;
  if (day === undefined || month === undefined || year === undefined) return undefined;
  const iso = `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
  return isValidIsoDate(iso) && formatDate(iso, hint) === text ? iso : undefined;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

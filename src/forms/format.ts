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
 * With no hint (or an empty one) it is the app's own display date, `28-OCT-2026`. Text that is not a real date is given
 * back as it is, as `formatDisplayDate` does, so that a value from a damaged file is shown and never made up.
 */
export function formatDate(iso: string, hint?: string): string {
  if (!isValidIsoDate(iso)) return iso;
  if (hint === undefined || hint.trim() === '') return formatDisplayDate(iso);
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  return hint.replace(DATE_LETTERS, (run: string, letter: string) => {
    const length = run.length;
    switch (letter.toLowerCase()) {
      case 'd':
        return length === 1 ? String(day) : length === 2 ? pad(day, 2) : run;
      case 'm':
        if (length === 1) return String(month);
        if (length === 2) return pad(month, 2);
        return length === 3 ? SHORT_MONTHS[month - 1] : length === 4 ? LONG_MONTHS[month - 1] : run;
      default: // 'y'
        return length === 2 ? pad(year, 4).slice(2) : length === 4 ? pad(year, 4) : run;
    }
  });
}

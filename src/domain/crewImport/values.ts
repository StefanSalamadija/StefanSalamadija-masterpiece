import { isValidIsoDate } from '../dates';
import type { DateFormat, RankKey } from '../types';
import { normaliseHeader } from './header';
import type { Cell } from './readSpreadsheet';

/** A cell as the text to keep in a record: empty for nothing, trimmed otherwise, but never reworded. */
export function cellText(v: Cell): string {
  if (v === null) return '';
  if (typeof v === 'string') return v.trim();
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? String(v) : v.toISOString().slice(0, 10);
  return String(v);
}

const MS_PER_DAY = 86_400_000;
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
// Below 3653 (1909-12-31) a number is more likely a year or a count typed into the cell than an Excel date: 1985 would be 1905-03-19.
const MIN_SERIAL = 3653;
const MAX_SERIAL = 2_958_465; // 9999-12-31
const TWO_DIGIT_YEAR_WINDOW = 15;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// A time of day after the date is ignored: "2026-06-01 00:00", "2026-06-01T00:00:00.000Z", "05.01.1985 14:30".
const TIME = String.raw`(?:(?:T|\s+)(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?`;
const YEAR_FIRST = new RegExp(String.raw`^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})${TIME}$`);
// Day-first text may end with a dot, as in "05.01.1985." (Croatian usage).
const DAY_FIRST = new RegExp(String.raw`^(\d{1,2})([-/.])(\d{1,2})\2(\d{2}|\d{4})\.?${TIME}$`);
const DAY_FIRST_MONTH_NAME = new RegExp(String.raw`^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})\.?${TIME}$`);

function isoDate(year: number, month: number, day: number): string | 'invalid' {
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isValidIsoDate(iso) ? iso : 'invalid';
}

function fromUtcDate(d: Date): string | 'invalid' {
  return isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** A year written with two digits is within 15 years after the current year, or else in the last century. */
function fullYear(digits: string, currentYear: number): number {
  if (digits.length === 4) return Number(digits);
  const yy = Number(digits);
  return yy <= (currentYear % 100) + TWO_DIGIT_YEAR_WINDOW ? 2000 + yy : 1900 + yy;
}

/**
 * A spreadsheet cell as a `YYYY-MM-DD` date, `null` when the cell is empty, or `'invalid'` when it is not a real date.
 * Text that starts with the year is read in both modes; text that ends with it only in day-first mode.
 * Numbers are Excel serials, from 3653 up.
 */
export function parseDateCell(v: Cell, fmt: DateFormat, currentYear: number): string | null | 'invalid' {
  if (v === null) return null;
  if (v instanceof Date) return fromUtcDate(v);
  if (typeof v === 'number') {
    if (!(v >= MIN_SERIAL && v <= MAX_SERIAL)) return 'invalid';
    return fromUtcDate(new Date(EXCEL_EPOCH_UTC + Math.floor(v) * MS_PER_DAY));
  }
  if (typeof v !== 'string') return 'invalid';

  const text = v.trim();
  if (text === '') return null;
  const yearFirst = YEAR_FIRST.exec(text);
  if (yearFirst) return isoDate(Number(yearFirst[1]), Number(yearFirst[3]), Number(yearFirst[4]));
  if (fmt !== 'day-first') return 'invalid';
  const dayFirst = DAY_FIRST.exec(text);
  if (dayFirst) return isoDate(fullYear(dayFirst[4], currentYear), Number(dayFirst[3]), Number(dayFirst[1]));
  const named = DAY_FIRST_MONTH_NAME.exec(text);
  const month = named ? MONTHS.indexOf(named[2].toLowerCase()) + 1 : 0;
  return named && month > 0 ? isoDate(fullYear(named[3], currentYear), month, Number(named[1])) : 'invalid';
}

/** Rank synonyms, already normalised (see `normaliseHeader`). */
const RANK_SYNONYMS: Record<Exclude<RankKey, 'other'>, string[]> = {
  master: ['master', 'captain', 'capt', 'mstr'],
  chiefOfficer: ['chiefofficer', 'chiefmate', 'co', 'cmate', 'choff', 'chofficer', 'firstofficer', '1stofficer', '1o'],
  secondOfficer: ['secondofficer', '2ndofficer', '2o', 'secondmate', '2ndmate'],
  thirdOfficer: ['thirdofficer', '3rdofficer', '3o', 'thirdmate', '3rdmate'],
  deckCadet: ['deckcadet', 'cadet', 'dcadet', 'deckapprentice'],
  bosun: ['bosun', 'boatswain', 'bsn'],
  ab: ['ab', 'ablebodied', 'ableseaman', 'ablebodiedseaman'],
  os: ['os', 'ordinaryseaman'],
  chiefEngineer: ['chiefengineer', 'ce', 'chiefeng', 'cheng'],
  secondEngineer: ['secondengineer', '2ndengineer', '2e'],
  thirdEngineer: ['thirdengineer', '3rdengineer', '3e'],
  fourthEngineer: ['fourthengineer', '4thengineer', '4e'],
  eto: ['eto', 'electrotechnicalofficer', 'electrician', 'elec', 'electricalofficer'],
  engineCadet: ['enginecadet', 'ecadet', 'engcadet'],
  fitter: ['fitter'],
  oiler: ['oiler', 'motorman'],
  wiper: ['wiper'],
  chiefCook: ['chiefcook', 'cook', 'chcook'],
  messman: ['messman', 'messboy'],
};

const SYNONYM_RANK = new Map<string, RankKey>();
for (const rank of Object.keys(RANK_SYNONYMS) as Exclude<RankKey, 'other'>[]) for (const synonym of RANK_SYNONYMS[rank]) SYNONYM_RANK.set(synonym, rank);

/** The rank a text stands for; text that is no known rank is kept, trimmed, as `rankOther` of rank `other`. */
export function parseRank(text: string): { rank: RankKey; rankOther?: string } {
  const rank = SYNONYM_RANK.get(normaliseHeader(text));
  return rank ? { rank } : { rank: 'other', rankOther: text.trim() };
}

/** A word is in capitals when it has letters and no lowercase ones. */
function isCapitals(word: string): boolean {
  return /\p{L}/u.test(word) && word === word.toUpperCase();
}

/**
 * Splits a full name into surname and given names. With a comma the surname is what precedes it. Otherwise it is the
 * leading words in capitals (`VAN DER BERG Jan`), or else the last word (`Ivan Petrović`). The spacing inside each part is kept.
 */
export function splitFullName(text: string): { surname: string; givenNames: string } {
  const name = text.trim();
  const comma = name.indexOf(',');
  if (comma !== -1) return { surname: name.slice(0, comma).trim(), givenNames: name.slice(comma + 1).trim() };

  const words = [...name.matchAll(/\S+/g)];
  if (words.length === 0) return { surname: '', givenNames: '' };
  let leading = 0;
  while (leading < words.length && isCapitals(words[leading][0])) leading++;
  if (leading > 0) {
    const last = words[leading - 1];
    const end = last.index + last[0].length;
    return { surname: name.slice(0, end), givenNames: name.slice(end).trim() };
  }
  const last = words[words.length - 1];
  return { surname: last[0], givenNames: name.slice(0, last.index).trim() };
}

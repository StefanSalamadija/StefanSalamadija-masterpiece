const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function parts(date: string): [number, number, number] {
  const match = ISO_DATE.exec(date);
  if (!match) throw new RangeError(`Invalid date: ${date}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function format(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** True only for a real calendar date written exactly as `YYYY-MM-DD`. */
export function isValidIsoDate(s: string): boolean {
  const match = ISO_DATE.exec(s);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const;

/**
 * A date as it is printed and exported: `05-JAN-1985`, with the month in capitals. An empty date stays empty. Text that is
 * not a real date (a record from a damaged file may hold any) is given back as it is: a sheet must show what is stored, and
 * never throw or make a date up.
 */
export function formatDisplayDate(iso: string): string {
  if (!isValidIsoDate(iso)) return iso;
  const [y, m, d] = parts(iso);
  return `${String(d).padStart(2, '0')}-${MONTH_NAMES[m - 1]}-${String(y).padStart(4, '0')}`;
}

const LOCAL_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** True only for a real calendar date and a real time written exactly as `YYYY-MM-DDTHH:mm`, as a `datetime-local` input gives it. */
export function isValidLocalDateTime(s: string): boolean {
  const [date, time, ...rest] = s.split('T');
  return rest.length === 0 && time !== undefined && isValidIsoDate(date) && LOCAL_TIME.test(time);
}

/**
 * An instant as `YYYY-MM-DD HH:mm UTC`, or `undefined` for text that is not an instant (or whose year has no four digits).
 * For text that comes from a file or a database that may be damaged, which the screens must still be able to show.
 */
export function formatUtcMinute(instant: string): string | undefined {
  const time = Date.parse(instant);
  if (Number.isNaN(time)) return undefined;
  const iso = new Date(time).toISOString();
  if (iso.length !== 24) return undefined; // years beyond 9999 are written with a sign and six digits
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** Adds (or, if negative, subtracts) calendar months, clamping to the end of a shorter month. Throws on an invalid date. */
export function addMonths(date: string, n: number): string {
  const [y, m, d] = parts(date);
  const months = y * 12 + (m - 1) + n;
  const year = Math.floor(months / 12);
  const month = months - year * 12 + 1;
  return format(year, month, Math.min(d, daysInMonth(year, month)));
}

/** Adds (or, if negative, subtracts) days. Throws on an invalid date. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = parts(date);
  const t = new Date(0);
  t.setUTCFullYear(y, m - 1, d + n);
  return format(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

const MS_PER_DAY = 86_400_000;

/**
 * The ISO 8601 week a date is in: weeks run Monday to Sunday, and week 1 of a year is the one that holds its first
 * Thursday. `year` is the year the week belongs to, which is not the date's own near a year end (`2027-01-01` is week
 * 53 of 2026), and `monday` and `sunday` are its first and last day. Throws a `RangeError` for a date that is not real.
 */
export function isoWeek(date: string): { year: number; week: number; monday: string; sunday: string } {
  if (!isValidIsoDate(date)) throw new RangeError(`Invalid date: ${date}`);
  const [y, m, d] = parts(date);
  const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Monday is 0
  const monday = addDays(date, -weekday);
  const thursday = addDays(monday, 3);
  const [year, tm, td] = parts(thursday);
  const dayOfYear = Math.round((Date.UTC(year, tm - 1, td) - Date.UTC(year, 0, 1)) / MS_PER_DAY);
  return { year, week: Math.floor(dayOfYear / 7) + 1, monday, sunday: addDays(monday, 6) };
}

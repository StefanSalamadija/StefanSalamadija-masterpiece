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

/**
 * A label for matching: lower case, with the colon, brackets, asterisk and full stop taken out and the spaces
 * collapsed, so that `Vessel:`, ` VESSEL ` and `Vessel *` are the same. Each of those characters is replaced by a space,
 * not removed, so that the words either side of it stay apart (`Signature:(Person in charge)` and
 * `Signature (Person in charge)` are the same). It is for matching only: a field's stored `label` keeps the case it has
 * in the form.
 */
export function normaliseLabel(s: string): string {
  return s.toLowerCase().replace(/[:()*.]/g, ' ').replace(/\s+/g, ' ').trim();
}

const SIGNATURE_WORDS = new Set(['signature', 'signed', 'sign', 'stamp']);

/**
 * True when a label asks for a signature or a stamp: it holds the whole word `signature`, `signed`, `sign` or `stamp`, in
 * any case. A word that only contains those letters (`Designated`, `Signal`, `Assigned`) does not count.
 */
export function isSignatureLabel(s: string): boolean {
  return (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).some((word) => SIGNATURE_WORDS.has(word));
}

/**
 * A date pattern: a day (`d`, `dd`), a month (`m` to `mmmm`) and a year (`yy`, `yyyy`) in any of the three orders, in any
 * case, with the same one of `/`, `.`, `-` or a space between them. This is every hint `formatDate` formats with the
 * three parts together (`dd/MMM/yyyy`, `DD.MM.YYYY`, `dd.mm.yyyy`, `YYYY-MM-DD`). It must not begin or end inside a word.
 */
const DATE_HINT = new RegExp(
  '(?:^|[^a-z])('
  + 'd{1,2}(?<a>[/. -])m{1,4}\\k<a>y{2,4}'
  + '|m{1,4}(?<b>[/. -])d{1,2}\\k<b>y{2,4}'
  + '|y{2,4}(?<c>[/. -])m{1,4}\\k<c>d{1,2}'
  + ')(?![a-z])',
  'i',
);

/** The hint for a time that is in UTC, brackets included. */
const UTC_HINT = /\(\s*24:00\s*UTC\s*\)/i;

/**
 * The format hint a label carries, as it is written there: a date pattern such as `dd/MMM/yyyy`, `DD.MM.YYYY`,
 * `dd.mm.yyyy` or `YYYY-MM-DD`, or `(24:00 UTC)`. When a label holds both, it is the one that comes first. `undefined`
 * when there is none.
 */
export function formatHintOf(s: string): string | undefined {
  const date = DATE_HINT.exec(s);
  const dateHint = date?.[1];
  const utc = UTC_HINT.exec(s);
  if (dateHint === undefined) return utc?.[0];
  if (utc === null) return dateHint;
  const dateAt = date!.index + date![0].length - dateHint.length;
  return utc.index < dateAt ? utc[0] : dateHint;
}

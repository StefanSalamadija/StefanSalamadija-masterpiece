import type { FormIdentity, FormKind } from './types';

/*
 * The name of a made file (Global Constraints): `<code> <title> <YYYY-MM-DD>.<docx|xlsx>`, or `<title> <date>` for a
 * form with no code. The base app's `slugify` (backups) is not used: it lower-cases, drops accents and turns spaces
 * into dashes, and a form's file keeps the form's own words as they are printed.
 */

/** The longest name, in characters (code points), before the extension. */
export const MAX_NAME = 120;

/**
 * Characters that become `-`: the ones Windows refuses in a name, control characters (other than whitespace, see
 * below) and invisible format characters. The last are an addition to the rule: a right-to-left override in a title
 * could otherwise show the name back to front, with a false extension.
 */
const UNSAFE = /[\\/:*?"<>|\p{Cc}\p{Cf}]/gu;

/**
 * One piece of the name made safe. Whitespace (tab and line breaks included, which are also control characters) is
 * whitespace first: every run of it becomes one space, so a title that wraps onto two lines in the form reads as one
 * line. Then the unsafe characters become `-`.
 */
function safe(text: string): string {
  return text.replace(/\s+/gu, ' ').replace(UNSAFE, '-').trim();
}

/**
 * The name of the file made from a form on `date` (ISO `YYYY-MM-DD`). A `.dotx` template makes a `.docx`. When the
 * name would be longer than 120 characters before the extension, the code and title are cut (never the date), at a
 * character boundary and without a space left at the cut.
 */
export function formFileName(identity: FormIdentity, date: string, kind: FormKind): string {
  const ext = kind === 'xlsx' ? 'xlsx' : 'docx';
  const day = safe(date);
  const room = MAX_NAME - (day ? Array.from(day).length + 1 : 0);
  const head = Array.from([safe(identity.code), safe(identity.title)].filter(Boolean).join(' ')).slice(0, Math.max(0, room)).join('').trimEnd();
  return `${[head, day].filter(Boolean).join(' ')}.${ext}`;
}

import { formatHintOf, isSignatureLabel, normaliseLabel } from '../labels';
import type { FieldDef, FieldKind } from '../types';
import { builtInFormat, dateHintOf, kindOfFormat } from './numFmt';
import type { CellModel } from './workbook';

/*
 * What a found Excel field is called and what it takes, from the text near it and its cell's number format. Where to
 * look for that text is decided in `detect.ts` and `tables.ts`; this file only reads it.
 */

/** Between a column title and a row's name in a label: `Equipment 1 · Dimensions`. */
export const LABEL_JOIN = ' · ';

/** Labels that name a field without a colon, as written on the forms (compared with `normaliseLabel`). */
const KNOWN_LABELS = new Set(['M/V', 'MV', 'M.V.', 'Vessel', 'Dated'].map(normaliseLabel));

/** A header label of the form's identity: `Form:`, `Form No.:`, `Rev.:`, `Revision:`, `Page:`. */
const IDENTITY_LABEL = /^\s*(?:form(?:\s+(?:no|number)\.?)?|rev(?:ision)?\.?(?:\s+(?:no|number)\.?)?|page)\s*:/i;

/** A label as stored (R3): the visible text with its spaces collapsed, trimmed, and without a trailing colon. */
export function labelText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().replace(/\s*:+$/, '').trim();
}

/** Text that is the identity of the form, not a field's label: `Form: TST-11`, `Revision:`, `Page: 1 of 1`. */
export function isIdentityText(text: string): boolean {
  return IDENTITY_LABEL.test(text);
}

/**
 * A cell that names the cell to its right (spec §5.2): its text ends with `:` (`Vessel:`, `Month :`, `Date:   `), or
 * is a known label written without one (`M/V`, `MV`, `Vessel`, `Dated`), or asks for a signature (`Signature`,
 * `Signed`, `Stamp`).
 */
export function isLabelCell(text: string): boolean {
  const t = text.trim();
  if (t === '' || isIdentityText(t)) return false;
  if (/:$/.test(t)) return /[\p{L}\p{N}]/u.test(t);
  return KNOWN_LABELS.has(normaliseLabel(t)) || (isSignatureLabel(t) && t.length <= 40);
}

/** A row that ends a table: its first text asks for a signature, or is `Dated` or `Signed`. */
export function isStopLabel(text: string): boolean {
  const n = normaliseLabel(text);
  return isSignatureLabel(text) || n === 'dated' || n.startsWith('dated ');
}

/** A label that asks for a date: `Date`, `Dated`, or starting with `Date ` (`Date of issue`, `Date (dd/mm/yyyy)`). */
function isDateLabel(label: string): boolean {
  const n = normaliseLabel(label);
  return n === 'date' || n === 'dated' || n.startsWith('date ');
}

/** A label that asks for a time: `Time`, or starting with `Time ` (`Time IN`, `Time (24:00 UTC)`). */
function isTimeLabel(label: string): boolean {
  const n = normaliseLabel(label);
  return n === 'time' || n.startsWith('time ');
}

/**
 * The kind of a field and its format hint, from its cell's number format (spec §5.2) and the parts of its label:
 * - a date format makes it a `date`, a time format a `time`, a number format a `number`;
 * - a cell with no such format is a `date` or `time` when its label asks for one, else `text`.
 *
 * A date's hint is the label's date pattern when it has one (the form's own hint wins), else the cell's own format when
 * `formatDate` renders it the same way. Excel's built-in date formats (14 to 17, 22) follow the locale of the computer
 * that opens the file, so they give no hint, and Task 8 writes a date serial into them.
 */
export function kindOf(cell: CellModel | undefined, parts: readonly string[]): Pick<FieldDef, 'kind' | 'formatHint'> {
  const format = cell ? kindOfFormat(cell.numFmtId, cell.numFmt) : 'text';
  const hint = parts.map((part) => formatHintOf(part)).find((h) => h !== undefined);
  const utc = hint !== undefined && /utc/i.test(hint) ? hint : undefined;
  const date = hint !== undefined && utc === undefined ? hint : undefined;
  const result = (kind: FieldKind, formatHint: string | undefined): Pick<FieldDef, 'kind' | 'formatHint'> => (formatHint === undefined ? { kind } : { kind, formatHint });
  switch (format) {
    case 'date': {
      const own = cell?.numFmt !== undefined && builtInFormat(cell.numFmtId) === undefined ? dateHintOf(cell.numFmt) : undefined;
      return result('date', date ?? own);
    }
    case 'time': return result('time', utc);
    case 'number': return result('number', undefined);
    default:
      if (date !== undefined || parts.some(isDateLabel)) return result('date', date);
      return result(parts.some(isTimeLabel) ? 'time' : 'text', hint);
  }
}

/**
 * A field's definition. Its label is its parts joined (`Equipment 1 · Dimensions`); with none it is called `fallback`
 * with low confidence, and `low` also makes it low (a label that is missing a part). A field whose label asks for a signature is left empty.
 */
export function makeField(o: { id: string; loc: string; parts: readonly string[]; cell: CellModel | undefined; section: string; fallback: string; block?: string; low?: boolean }): FieldDef {
  const parts = o.parts.filter((part) => part !== '');
  const label = parts.join(LABEL_JOIN);
  const { kind, formatHint } = kindOf(o.cell, parts);
  const def: FieldDef = { id: o.id, kind, label: label === '' ? o.fallback : label, section: o.section, loc: o.loc, confidence: label === '' || o.low ? 'low' : 'high' };
  if (formatHint !== undefined) def.formatHint = formatHint;
  if (label !== '' && isSignatureLabel(label)) def.leftEmpty = true;
  if (o.block !== undefined) def.block = o.block;
  return def;
}

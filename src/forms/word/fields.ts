import { formatHintOf, isRangeLabel, isSignatureLabel, normaliseLabel } from '../labels';
import type { FieldDef, FieldKind } from '../types';
import { W, child, clean, kids, wAttr, wVal } from './walk';
import type { RawField, Token } from './walk';

/*
 * What a found field is (its kind, options and format hint) and what it is called, from the field's own settings and
 * the text near it. Where to look for that text is decided in `detect.ts`; this file only reads it.
 */

/** True when a text has a letter or a digit in it, so that it can name something (`:` or `/` alone cannot). */
export function hasWords(s: string | undefined): s is string {
  return s !== undefined && /[\p{L}\p{N}]/u.test(s);
}

/** A label as stored (R3): the visible text with its spaces collapsed, trimmed, and without a trailing colon. */
export function labelText(raw: string): string {
  return clean(raw).replace(/\s*:+$/, '').trim();
}

/** The node a field's address points at: the `begin` `w:fldChar` of a legacy field, the `w:sdt` of a control. */
export function nodeOf(field: RawField): Element {
  return field.kind === 'legacy' ? field.begin : field.sdt;
}

/**
 * A legacy text field whose value Word calculates (`w:textInput/w:type` `calculated`). It is no field (R27): Word works
 * its value out again, so nothing is asked or written there, and it is left as it is in the file. It still stands where
 * it is, so it ends a label and keeps its cell from being an empty one.
 */
export function isCalculated(field: RawField): boolean {
  return field.kind === 'legacy' && field.type === 'FORMTEXT' && wVal(child(field.ffData, W, 'textInput'), 'type') === 'calculated';
}

export function isCheckbox(field: RawField): boolean {
  return field.kind === 'legacy' ? field.type === 'FORMCHECKBOX' : field.control === 'checkbox';
}

/**
 * The text next to `tokens[from]`, read towards the start (`step` -1) or the end (`step` 1), up to the next field or
 * tick box. Paragraph ends count as spaces, unless `paragraphOnly`, where they stop it.
 */
export function segment(tokens: readonly Token[], from: number, step: 1 | -1, paragraphOnly = false): string {
  const parts: string[] = [];
  for (let i = from; i >= 0 && i < tokens.length; i += step) {
    const token = tokens[i];
    if (token.t === 'text') parts.push(token.s);
    else if (token.t === 'break') {
      if (paragraphOnly) break;
      parts.push(' ');
    } else if (token.t !== 'object') break;
  }
  if (step < 0) parts.reverse();
  return clean(parts.join(''));
}

/** A normalised label that asks for a time: `time`, or starting with `time ` (`Time IN`, `Time (24:00 UTC)`). */
function isTimeLabel(label: string): boolean {
  const n = normaliseLabel(label);
  return n === 'time' || n.startsWith('time ');
}

/** `formatHintOf` gives a date pattern or the UTC hint `(24:00 UTC)`; this is the date pattern, if that is what it gave. */
function dateHintOf(hint: string | undefined): string | undefined {
  return hint !== undefined && !/utc/i.test(hint) ? hint : undefined;
}

/** The kind a label asks for: `date` when it gives a date pattern, `time` when it names a time, else `text`. */
function labelKind(raw: string | undefined, hint: string | undefined): FieldKind {
  if (dateHintOf(hint)) return 'date';
  return raw !== undefined && isTimeLabel(labelText(raw)) ? 'time' : 'text';
}

/** A Word date format without its quoted text (`'at'`, `"h"`), which is shown as it is. */
function unquoted(format: string): string {
  return format.replace(/'[^']*'|"[^"]*"/g, '');
}

/** A time token of a Word date format: an hour (`H`, `h`), seconds (`s`), or the AM/PM marker. Minutes are `m`, months `M`. */
const TIME_TOKEN = /[hHs]|am\/pm|a\/p/i;
/** A date token of a Word date format: a day (`d`), a month (`M`) or a year (`y`). */
const DATE_TOKEN = /[dDMyY]/;

/** True when a Word date format (`w:textInput/w:format`) shows a time and no date: `HH:mm`, `h:mm am/pm`. */
function isTimeFormat(format: string): boolean {
  const bare = unquoted(format);
  return TIME_TOKEN.test(bare) && !DATE_TOKEN.test(bare.replace(/am\/pm|a\/p/gi, ''));
}

/**
 * The date part of a Word date format: the format itself when it has no time in it, else the format without its time
 * and without the text that only joined the two (`dd/MM/yyyy HH:mm` is `dd/MM/yyyy`, `dd.MM.yyyy 'at' HH:mm` is
 * `dd.MM.yyyy`). `undefined` when nothing of a date is left.
 */
function datePart(format: string | undefined): string | undefined {
  if (format === undefined || !TIME_TOKEN.test(unquoted(format))) return format;
  const date = unquoted(format)
    .replace(/(?:[hHs]+|m+)(?:[:.](?:[hHs]+|m+))*(?:\s*(?:am\/pm|a\/p))?/gi, (run) => (TIME_TOKEN.test(run) ? ' ' : run))
    .replace(/^[\s,:.\-/]+|[\s,:.\-/]+$/g, '');
  return DATE_TOKEN.test(date) ? date : undefined;
}

/** `labelKind`, with a label that names a period (`isRangeLabel`) taking text rather than a date. */
function kindFromLabel(raw: string | undefined, hint: string | undefined): FieldKind {
  const kind = labelKind(raw, hint);
  return kind === 'date' && isRangeLabel(raw) ? 'text' : kind;
}

/**
 * A list's entries without the first one when it is a prompt rather than a choice: blank, or starting with `_` or
 * `...` (`_ choose`, `...`), or Word's own `Choose an item.`.
 */
function withoutPrompt(entries: { text: string; prompt?: boolean }[]): string[] {
  const [first, ...rest] = entries;
  if (!first) return [];
  const t = first.text.trim();
  const prompt = first.prompt || t === '' || t.startsWith('_') || t.startsWith('...') || /^choose an item\.?$/i.test(t);
  return (prompt ? rest : entries).map((e) => e.text);
}

function listItems(list: Element | undefined): string[] {
  const items = (list ? kids(list) : []).filter((el) => el.namespaceURI === W && el.localName === 'listItem');
  const anyDisplayed = items.some((el) => wAttr(el, 'displayText') !== undefined);
  return withoutPrompt(items.map((el, i) => {
    const display = wAttr(el, 'displayText');
    const value = wAttr(el, 'value') ?? '';
    // Word's own prompt entry has a value and no display text, while the entries a person adds have both.
    return { text: display ?? value, prompt: i === 0 && (value === '' || (display === undefined && anyDisplayed)) };
  }));
}

/**
 * The kind, options and format hint of a field, from its settings and its label (`raw`, the text that names it).
 *
 * A legacy text field that would be a date (by its own type, or by a date pattern in its label) is `text` when its
 * label names a period (`isRangeLabel`): one field then holds the whole period, written as text (`26.10 - 01.11`), and it
 * keeps the date format for that text. When `shared` (another field of the same cell or line has the same label: the
 * first and the last day), each field holds one date and stays a `date`.
 */
function describe(field: RawField, raw: string | undefined, shared: boolean): Pick<FieldDef, 'kind' | 'options' | 'formatHint'> {
  const hint = raw === undefined ? undefined : formatHintOf(raw);
  if (field.kind === 'legacy') {
    switch (field.type) {
      case 'FORMCHECKBOX': return { kind: 'checkbox' };
      case 'FORMDROPDOWN': {
        const list = child(field.ffData, W, 'ddList');
        const entries = (list ? kids(list) : [])
          .filter((el) => el.namespaceURI === W && el.localName === 'listEntry')
          .map((el) => ({ text: wAttr(el, 'val') ?? '' }));
        return { kind: 'choice', options: withoutPrompt(entries) };
      }
      default: {
        const input = child(field.ffData, W, 'textInput');
        const type = wVal(input, 'type');
        const own = wVal(input, 'format') || undefined;
        // Word's time field is a date field whose own format has only a time in it (`HH:mm`): it takes a time.
        if (type === 'date' && own !== undefined && isTimeFormat(own)) {
          const formatHint = hint ?? own;
          return { kind: 'time', formatHint };
        }
        const typed: FieldKind = type === 'date' ? 'date' : type === 'number' ? 'number' : type === 'currentTime' ? 'time' : labelKind(raw, hint);
        // A date is written in the label's format when it gives one, else in the field's own (R2); so is a period. Of
        // an own format with a time in it (`dd/MM/yyyy HH:mm`), only the date part is used, as a date is all it holds.
        const formatHint = typed === 'date' ? dateHintOf(hint) ?? datePart(own) ?? hint : hint;
        const kind: FieldKind = typed === 'date' && !shared && isRangeLabel(raw) ? 'text' : typed;
        return formatHint === undefined ? { kind } : { kind, formatHint };
      }
    }
  }
  switch (field.control) {
    case 'date': {
      const formatHint = wVal(child(field.sdtPr, W, 'date'), 'dateFormat') || hint;
      return formatHint === undefined ? { kind: 'date' } : { kind: 'date', formatHint };
    }
    case 'dropDownList': case 'comboBox': return { kind: 'choice', options: listItems(child(field.sdtPr, W, field.control)) };
    case 'checkbox': return { kind: 'checkbox' };
    case 'picture': return { kind: 'picture' };
    default: return hint === undefined ? { kind: 'text' } : { kind: 'text', formatHint: hint };
  }
}

/** A content control's `w:alias`, the name its author gave it, or `undefined`. */
function aliasOf(field: RawField): string | undefined {
  return field.kind === 'sdt' ? wVal(field.sdtPr, 'alias') : undefined;
}

/** A field definition with its optional members only when they are set, so that equal detections are equal key by key. */
function definition(o: { id: string; label: string; section: string; loc: string; unsure?: boolean }, d: Pick<FieldDef, 'kind' | 'options' | 'formatHint'>, raw: string | undefined): FieldDef {
  const def: FieldDef = { id: o.id, kind: d.kind, label: o.label, section: o.section, loc: o.loc, confidence: raw === undefined || o.unsure ? 'low' : 'high' };
  if (d.options !== undefined) def.options = d.options;
  if (d.formatHint !== undefined) def.formatHint = d.formatHint;
  // A guessed label (R23) is for the person to confirm, so it never leaves the field empty on its own.
  if (raw !== undefined && !o.unsure && isSignatureLabel(o.label)) def.leftEmpty = true;
  return def;
}

/**
 * The definition of a found field. `text` is the nearby text that names it, if any; failing that a content control's
 * alias names it; failing both, `guess` (text that only a fallback rule found, R23) names it, with low confidence, for
 * the person to confirm in setup; failing all three it is called `fallback` (`Field <n>`, `Column <n>`) with low
 * confidence. `shared` says that another field of the same cell or line has the same label (see `describe`).
 */
export function makeField(field: RawField, o: { id: string; text: string | undefined; guess?: string; fallback: string; section: string; loc: string; shared?: boolean }): FieldDef {
  const alias = aliasOf(field);
  const sure = hasWords(o.text) ? o.text : hasWords(alias) ? alias : undefined;
  const raw = sure ?? (hasWords(o.guess) ? o.guess : undefined);
  const unsure = sure === undefined && raw !== undefined;
  return definition({ ...o, label: raw === undefined ? o.fallback : labelText(raw), unsure }, describe(field, raw, o.shared ?? false), raw);
}

/** The name a content control's author gave it, when it has words: it names the field before any guess does. */
export function hasAlias(field: RawField): boolean {
  return hasWords(aliasOf(field));
}

/** The definition of a cell column of a plain row group, from its header text: its kind and hint come from the label. */
export function makeColumn(o: { id: string; text: string | undefined; fallback: string; section: string; loc: string }): FieldDef {
  const raw = hasWords(o.text) ? o.text : undefined;
  const label = raw === undefined ? o.fallback : labelText(raw);
  const hint = raw === undefined ? undefined : formatHintOf(raw);
  return definition({ ...o, label }, { kind: kindFromLabel(raw, hint), formatHint: hint }, raw);
}

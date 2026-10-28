import { formatHintOf, isSignatureLabel, normaliseLabel } from '../labels';
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
function kindFromLabel(raw: string | undefined, hint: string | undefined): FieldKind {
  if (dateHintOf(hint)) return 'date';
  return raw !== undefined && isTimeLabel(labelText(raw)) ? 'time' : 'text';
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

/** The kind, options and format hint of a field, from its settings and its label (`raw`, the text that names it). */
function describe(field: RawField, raw: string | undefined): Pick<FieldDef, 'kind' | 'options' | 'formatHint'> {
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
        const kind: FieldKind = type === 'date' ? 'date' : type === 'number' ? 'number' : type === 'currentTime' ? 'time' : kindFromLabel(raw, hint);
        // A date is written in the label's format when it gives one, else in the field's own (R2).
        const formatHint = kind === 'date' ? dateHintOf(hint) ?? own ?? hint : hint;
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
function definition(o: { id: string; label: string; section: string; loc: string }, d: Pick<FieldDef, 'kind' | 'options' | 'formatHint'>, raw: string | undefined): FieldDef {
  const def: FieldDef = { id: o.id, kind: d.kind, label: o.label, section: o.section, loc: o.loc, confidence: raw === undefined ? 'low' : 'high' };
  if (d.options !== undefined) def.options = d.options;
  if (d.formatHint !== undefined) def.formatHint = d.formatHint;
  if (raw !== undefined && isSignatureLabel(o.label)) def.leftEmpty = true;
  return def;
}

/**
 * The definition of a found field. `text` is the nearby text that names it, if any; failing that a content control's
 * alias names it; failing both it is called `fallback` (`Field <n>`, `Column <n>`) with low confidence.
 */
export function makeField(field: RawField, o: { id: string; text: string | undefined; fallback: string; section: string; loc: string }): FieldDef {
  const alias = aliasOf(field);
  const raw = hasWords(o.text) ? o.text : hasWords(alias) ? alias : undefined;
  return definition({ ...o, label: raw === undefined ? o.fallback : labelText(raw) }, describe(field, raw), raw);
}

/** The definition of a cell column of a plain row group, from its header text: its kind and hint come from the label. */
export function makeColumn(o: { id: string; text: string | undefined; fallback: string; section: string; loc: string }): FieldDef {
  const raw = hasWords(o.text) ? o.text : undefined;
  const label = raw === undefined ? o.fallback : labelText(raw);
  const hint = raw === undefined ? undefined : formatHintOf(raw);
  return definition({ ...o, label }, { kind: kindFromLabel(raw, hint), formatHint: hint }, raw);
}

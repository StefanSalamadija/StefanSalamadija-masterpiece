import { isValidIsoDate } from '../../domain/dates';
import { parseDate } from '../format';
import { partText } from '../package';
import type { Package } from '../package';
import type { DraftValues, FieldDef, FormSchema, FormValue } from '../types';
import { parseXml } from '../xml';
import { locateColumn, locateWord, parseLoc } from './address';
import type { WordTarget } from './address';
import { MC, W, W14, child, isEl, kids, wAttr, wVal } from './walk';

/*
 * Reading the values of a filled Word form back (spec §8, the integrity check), through the stored addresses (R1):
 * nothing is detected again. Values come back in their canonical form (R2), the form the writer was given:
 * - a `date` field reads as ISO `YYYY-MM-DD`. A content-control date reads its `w:fullDate`, which the writer sets. A
 *   legacy FORMTEXT or a table cell is read with `parseDate` and the field's `formatHint`, which only accepts the very
 *   text `formatDate` writes with that hint, so the date read is the date written. Text that is not a date in that
 *   format is given back as it is (a value that was not ISO was written as it was given);
 * - a checkbox (legacy or `w14:checkbox`) reads as a boolean: what the file shows, ticked or not;
 * - a choice reads as the option text (a FORMDROPDOWN's chosen entry, a tick column's ticked option, a list
 *   control's text), or `null` when nothing is chosen;
 * - everything else reads as its text, with `\n` for a line break or a new paragraph and `\t` for a tab.
 *
 * A field that shows nothing a person gave reads as `null`: an empty FORMTEXT (no text, or only the en spaces Word
 * puts in an empty one), a content control showing its prompt, an empty cell.
 */

/** What Word puts in an empty FORMTEXT: en spaces (U+2002), five of them unless the field was made otherwise. */
export const EMPTY_FORMTEXT = /^\u2002+$/;
/** `w:sym` characters of a ticked box (Wingdings checked boxes, and the cross `F078`). */
const TICKED_SYMBOLS = new Set(['F0FE', 'F0FD', 'F0FB', 'F0FC', 'F078']);
/** A ticked box written as text: ☒ ☑ ✓ ✔ (U+2612, U+2611, U+2713, U+2714). */
const TICKED_TEXT = /[\u2612\u2611\u2713\u2714]/;

/** The next node in document order; with `skipChildren`, after `node`'s own subtree. */
export function nextNode(node: Node, skipChildren = false): Node | null {
  if (!skipChildren && node.firstChild) return node.firstChild;
  for (let at: Node | null = node; at; at = at.parentNode) if (at.nextSibling) return at.nextSibling;
  return null;
}

/**
 * The `separate` and `end` `w:fldChar` of the field whose `begin` is given, in document order, passing over fields
 * nested in it. Either is missing in a damaged file (and `separate` in a field with no result).
 */
export function fieldRange(begin: Element): { separate?: Element; end?: Element } {
  let depth = 0;
  let separate: Element | undefined;
  for (let node = nextNode(begin, true); node; node = nextNode(node)) {
    if (!isEl(node, W, 'fldChar')) continue;
    const type = wAttr(node, 'fldCharType');
    if (type === 'begin') depth += 1;
    else if (type === 'separate' && depth === 0 && !separate) separate = node;
    else if (type === 'end') {
      if (depth === 0) return { separate, end: node };
      depth -= 1;
    }
  }
  return { separate };
}

/** The text an element shows: its runs' text, tabs and breaks, with a line break between paragraphs. */
export function textIn(el: Element): string {
  const state = { out: '', paragraphs: 0 };
  collect(el, state);
  return state.out;
}

function collect(el: Element, state: { out: string; paragraphs: number }): void {
  for (const k of kids(el)) {
    if (k.namespaceURI === MC && k.localName === 'Fallback') continue;
    if (k.namespaceURI !== W) {
      collect(k, state);
      continue;
    }
    switch (k.localName) {
      case 't': state.out += k.textContent ?? ''; break;
      case 'tab': case 'ptab': state.out += '\t'; break;
      case 'br': case 'cr': state.out += '\n'; break;
      case 'noBreakHyphen': state.out += '-'; break;
      case 'p':
        if (state.paragraphs > 0) state.out += '\n';
        state.paragraphs += 1;
        collect(k, state);
        break;
      case 'delText': case 'instrText': case 'del': case 'moveFrom': case 'rPr': case 'pPr': case 'sdtPr': break;
      default: collect(k, state);
    }
  }
}

/** The text of a legacy field's result: what lies between its `separate` and its `end`. */
export function resultText(begin: Element): string {
  const { separate, end } = fieldRange(begin);
  if (!separate || !end) return '';
  let out = '';
  for (let node = nextNode(separate); node && node !== end; node = nextNode(node)) {
    if (node.nodeType !== 1 || (node as Element).namespaceURI !== W) continue;
    const el = node as Element;
    switch (el.localName) {
      case 't': out += el.textContent ?? ''; break;
      case 'tab': out += '\t'; break;
      case 'br': case 'cr': out += '\n'; break;
      case 'p': out += '\n'; break; // a paragraph met after the separate is a new one inside the result
      default: break;
    }
  }
  return out;
}

/** An on/off property: on when present, unless its `val` says off. */
function isOn(el: Element | undefined, ns = W): boolean {
  if (!el) return false;
  const val = el.getAttributeNS(ns, 'val');
  return val === null || val === '' || !['0', 'false', 'off'].includes(val);
}

/** Text as read: `null` when it is empty; for a date field, ISO when it is a date in the field's format. */
function textValue(text: string, field: FieldDef, hint = field.formatHint): FormValue {
  if (text === '') return null;
  return field.kind === 'date' ? parseDate(text, hint) ?? text : text;
}

/** Whether a tick cell shows a ticked box: a checked box symbol, a ticked box character, or the `X` the writer puts in a cell that had no box. */
function isTicked(tc: Element): boolean {
  if (Array.from(tc.getElementsByTagNameNS(W, 'sym')).some((s) => TICKED_SYMBOLS.has((wAttr(s, 'char') ?? '').toUpperCase()))) return true;
  const text = textIn(tc);
  return TICKED_TEXT.test(text) || /^\s*[Xx]\s*$/.test(text);
}

/** The `w14:checkbox`, `w:date`, list or other element that says what a content control is. */
export function controlOf(sdt: Element): { type: 'checkbox' | 'date' | 'dropDownList' | 'comboBox' | 'picture' | 'text'; el?: Element; sdtPr?: Element } {
  const sdtPr = child(sdt, W, 'sdtPr');
  const checkbox = child(sdtPr, W14, 'checkbox');
  if (checkbox) return { type: 'checkbox', el: checkbox, sdtPr };
  for (const type of ['date', 'dropDownList', 'comboBox', 'picture'] as const) {
    const el = child(sdtPr, W, type);
    if (el) return { type, el, sdtPr };
  }
  return { type: 'text', sdtPr };
}

/** The value a target holds, or `undefined` for one this reader does not read (a picture, a group). */
export function readTarget(target: WordTarget, field: FieldDef): FormValue | undefined {
  switch (target.kind) {
    case 'formtext': {
      const text = resultText(target.begin);
      return EMPTY_FORMTEXT.test(text) ? null : textValue(text, field);
    }
    case 'formcheck': {
      const box = child(child(target.begin, W, 'ffData'), W, 'checkBox');
      const checked = child(box, W, 'checked');
      return checked ? isOn(checked) : isOn(child(box, W, 'default'));
    }
    case 'formdrop': {
      const list = child(child(target.begin, W, 'ffData'), W, 'ddList');
      const entries = (list ? kids(list) : []).filter((el) => isEl(el, W, 'listEntry')).map((el) => wAttr(el, 'val') ?? '');
      const index = Number(wVal(list, 'result') ?? wVal(list, 'default') ?? 0);
      const entry = entries[index];
      if (entry === undefined) return null;
      return field.options === undefined || field.options.includes(entry) ? entry : null;
    }
    case 'sdt': {
      const control = controlOf(target.sdt);
      if (control.type === 'picture') return undefined;
      if (control.type === 'checkbox') return isOn(child(control.el, W14, 'checked'), W14);
      if (child(control.sdtPr, W, 'showingPlcHdr')) return null;
      const content = child(target.sdt, W, 'sdtContent');
      if (control.type === 'date') {
        const full = (wAttr(control.el, 'fullDate') ?? '').slice(0, 10);
        if (isValidIsoDate(full)) return full;
        return textValue(content ? textIn(content) : '', field, wVal(control.el, 'dateFormat') || field.formatHint);
      }
      return textValue(content ? textIn(content) : '', field);
    }
    case 'tick': {
      const index = target.cells.findIndex(isTicked);
      return index < 0 ? null : field.options?.[index] ?? null;
    }
    case 'cell':
      return textValue(textIn(target.tc), field);
    default:
      return undefined;
  }
}

/** The parts a schema's addresses are in, in the order first met. */
export function partsOf(schema: FormSchema): string[] {
  const parts = new Set<string>();
  for (const item of [...schema.fields, ...schema.rowGroups]) {
    const loc = parseLoc(item.loc);
    if (loc) parts.add(loc.part);
  }
  return [...parts];
}

/**
 * The values a Word form holds, read through the schema's stored addresses (R1). `extraRows[groupId]` is the number of
 * rows or items the writer cloned for that group (`extraRowsOf` in `write.ts`); a group reads all its rows, its
 * capacity plus those.
 *
 * Every field the reader can find is in `fields`, and every row of every group it can find is in `rows`, each with
 * every column. A field or group whose address does not resolve is left out, so a caller comparing values sees that it
 * is missing. Picture fields and columns are left out (Task 6 reads them).
 */
export function readWordValues(pkg: Package, schema: FormSchema, extraRows: Record<string, number> = {}): DraftValues {
  const out: DraftValues = { fields: {}, rows: {} };
  for (const part of partsOf(schema)) {
    const text = partText(pkg, part);
    if (text === undefined) continue;
    const targets = locateWord(parseXml(text), part, schema, extraRows);
    for (const field of schema.fields) {
      const target = targets.get(field.id);
      if (!target || field.kind === 'picture') continue;
      const value = readTarget(target, field);
      if (value !== undefined) out.fields[field.id] = value;
    }
    for (const group of schema.rowGroups) {
      const target = targets.get(group.id);
      if (!target || target.kind !== 'group') continue;
      out.rows[group.id] = target.rows.map((row) => {
        const record: Record<string, FormValue> = {};
        for (const column of group.columns) {
          if (column.kind === 'picture') continue;
          const at = locateColumn(row, column);
          const value = at && readTarget(at, column);
          if (value !== undefined) record[column.id] = value;
        }
        return record;
      });
    }
  }
  return out;
}

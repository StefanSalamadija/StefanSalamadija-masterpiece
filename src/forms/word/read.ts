import { isValidIsoDate } from '../../domain/dates';
import { parseDate, usableDateHint } from '../format';
import { partText } from '../package';
import type { Package } from '../package';
import type { DraftValues, FieldDef, FormSchema, FormValue } from '../types';
import { parseXml } from '../xml';
import { locateColumn, locateWord, parseLoc } from './address';
import type { WordTarget } from './address';
import { readRels } from './rels';
import { A, MC, R, W, W14, child, isEl, kids, wAttr, wVal } from './walk';

/*
 * Reading the values of a filled Word form back (spec §8, the integrity check), through the stored addresses (R1):
 * nothing is detected again. Values come back in their canonical form (R2), the form the writer was given:
 * - a `date` field reads as ISO `YYYY-MM-DD`. A legacy FORMTEXT or a table cell is read with `parseDate` and the
 *   field's `formatHint`, which only accepts the very text `formatDate` writes with that hint, so the date read is the
 *   date written. Text that is not a date in that format is given back as it is (a value that was not ISO was written
 *   as it was given). A content-control date: see below;
 * - a checkbox (legacy or `w14:checkbox`) reads as a boolean: what the file shows, ticked or not;
 * - a choice reads as the option text (a FORMDROPDOWN's chosen entry, a tick column's ticked option, a list
 *   control's text), or `null` when nothing is chosen;
 * - everything else reads as its text, with `\n` for a line break or a new paragraph and `\t` for a tab.
 *
 * A field that shows nothing a person gave reads as `null`: an empty FORMTEXT (no text, or only the en spaces Word
 * puts in an empty one), a content control showing its prompt, an empty cell.
 *
 * A content control is read as Word shows it, and its stored state must agree with what it shows (the integrity check
 * relies on this: a file prints what it shows). Where they disagree, the control reads as `null`, a value nobody gave,
 * so a written value no longer reads back:
 * - a date control shows text in its format: the same chain the writer uses (R13: its own `w:dateFormat` when
 *   `formatDate` can render it, else the field's `formatHint`, else the display date). With a `w:fullDate`, the text
 *   must be that date in that format; without one, the text is read as a FORMTEXT date is;
 * - a `w14:checkbox` must show the glyph of its `w14:checked` state (`w14:checkedState` or `w14:uncheckedState`, else
 *   U+2612 or U+2610), and, when that state names a font, every font its run sets must be that one (a symbol font such
 *   as Wingdings shows another glyph in another font);
 * - a drop-down list or combo box whose `w:lastValue` names one of its items must show that item's text;
 * - a control bound to custom XML (`w:dataBinding`) shows that data when the file is opened, not its own text, so
 *   none of its text can be trusted. The writer removes the binding from every control it writes.
 *
 * A picture field reads as the path of the media part its picture control shows (`word/media/mp-1.jpeg`), which is
 * presence only: the photo id the draft holds is not in the file. A control still showing its placeholder reads as
 * `null`.
 */

/** What Word puts in an empty FORMTEXT: five en spaces (U+2002). A result of only en spaces, however many, is empty. */
export const EMPTY_FORMTEXT = '\u2002'.repeat(5);
const EN_SPACES_ONLY = /^\u2002+$/;
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

/**
 * The text of a table cell: its paragraphs (and any table or control between them) joined by line breaks, without the
 * empty paragraphs at the end. A cell often holds more than one empty paragraph to make its row taller; the writer
 * fills the first and keeps the others, so they are not part of the value.
 */
export function cellText(tc: Element): string {
  const blocks = kids(tc)
    .filter((k) => k.namespaceURI === W && ['p', 'tbl', 'sdt', 'customXml'].includes(k.localName))
    .map((k) => textIn(k));
  while (blocks.length > 0 && blocks[blocks.length - 1] === '') blocks.pop();
  return blocks.join('\n');
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
export function isOn(el: Element | undefined, ns = W): boolean {
  if (!el) return false;
  const val = el.getAttributeNS(ns, 'val');
  return val === null || val === '' || !['0', 'false', 'off'].includes(val);
}

/** Text as read: `null` when it is empty; for a date field, ISO when it is a date in the field's format. */
function textValue(text: string, field: FieldDef, hint = field.formatHint): FormValue {
  if (text === '') return null;
  return field.kind === 'date' ? parseDate(text, usableDateHint(hint)) ?? text : text;
}

/**
 * A `w14:checkbox`: ticked or not as `w14:checked` says, when the control shows that state's glyph in that state's font
 * (see the top of this file); `null` when it shows something else.
 */
function readCheckbox(box: Element, content: Element | undefined, text: string): FormValue {
  const on = isOn(child(box, W14, 'checked'), W14);
  const state = child(box, W14, on ? 'checkedState' : 'uncheckedState');
  const code = parseInt(state?.getAttributeNS(W14, 'val') ?? '', 16);
  const glyph = String.fromCodePoint(Number.isInteger(code) && code > 0 && code <= 0x10ffff ? code : on ? 0x2612 : 0x2610);
  if (text !== glyph) return null;
  const font = state?.getAttributeNS(W14, 'font');
  if (font) {
    const run = content && Array.from(content.getElementsByTagNameNS(W, 'r')).find((r) => r.getElementsByTagNameNS(W, 't').length > 0 || child(r, W, 'sym'));
    const fonts = child(child(run, W, 'rPr'), W, 'rFonts');
    const set = ['ascii', 'hAnsi', 'eastAsia', 'cs'].map((slot) => wAttr(fonts, slot)).filter((name): name is string => !!name);
    if (set.length === 0 || set.some((name) => name.toLowerCase() !== font.toLowerCase())) return null;
  }
  return on;
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

/**
 * The media part a picture control shows: where its `a:blip` points through `rels` (the part's relationships, id to
 * part path). `null` for a control showing its placeholder, or a picture that does not resolve to a part.
 */
function readPicture(sdt: Element, rels: ReadonlyMap<string, string>): FormValue {
  const { sdtPr } = controlOf(sdt);
  if (child(sdtPr, W, 'showingPlcHdr')) return null;
  const blip = sdt.getElementsByTagNameNS(A, 'blip')[0];
  const id = blip?.getAttributeNS(R, 'embed');
  return (id && rels.get(id)) || null;
}

/**
 * The value a target holds, or `undefined` for one this reader does not read (a group; a picture when `rels`, the
 * relationships of the part the target is in, is not given).
 */
export function readTarget(target: WordTarget, field: FieldDef, rels?: ReadonlyMap<string, string>): FormValue | undefined {
  switch (target.kind) {
    case 'formtext': {
      const text = resultText(target.begin);
      return EN_SPACES_ONLY.test(text) ? null : textValue(text, field);
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
      if (control.type === 'picture') return rels && field.kind === 'picture' ? readPicture(target.sdt, rels) : undefined;
      if (control.sdtPr && kids(control.sdtPr).some((k) => k.localName === 'dataBinding')) return null;
      const content = child(target.sdt, W, 'sdtContent');
      const text = content ? textIn(content) : '';
      if (control.type === 'checkbox') return readCheckbox(control.el!, content, text);
      if (child(control.sdtPr, W, 'showingPlcHdr')) return null;
      if (control.type === 'date') {
        // The writer's chain (R13): the control's own format if it can be rendered, else the field's hint.
        const hint = usableDateHint(wVal(control.el, 'dateFormat') || undefined) ?? field.formatHint;
        const full = (wAttr(control.el, 'fullDate') ?? '').slice(0, 10);
        if (!isValidIsoDate(full)) return textValue(text, field, hint);
        return text !== '' && parseDate(text, usableDateHint(hint)) === full ? full : null;
      }
      if (control.type === 'dropDownList' || control.type === 'comboBox') {
        const last = wAttr(control.el, 'lastValue');
        const item = last === undefined ? undefined : kids(control.el!).find((k) => isEl(k, W, 'listItem') && wAttr(k, 'value') === last);
        if (item && (wAttr(item, 'displayText') ?? wAttr(item, 'value')) !== text) return null;
      }
      return textValue(text, field);
    }
    case 'tick': {
      const index = target.cells.findIndex(isTicked);
      return index < 0 ? null : field.options?.[index] ?? null;
    }
    case 'cell':
      return textValue(cellText(target.tc), field);
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
 * is missing. A picture field or column reads as its media part path, or `null` (see the top of this file).
 */
export function readWordValues(pkg: Package, schema: FormSchema, extraRows: Record<string, number> = {}): DraftValues {
  const out: DraftValues = { fields: {}, rows: {} };
  for (const part of partsOf(schema)) {
    const text = partText(pkg, part);
    if (text === undefined) continue;
    const targets = locateWord(parseXml(text), part, schema, extraRows);
    const rels = readRels(pkg, part);
    for (const field of schema.fields) {
      const target = targets.get(field.id);
      if (!target) continue;
      const value = readTarget(target, field, rels);
      if (value !== undefined) out.fields[field.id] = value;
    }
    for (const group of schema.rowGroups) {
      const target = targets.get(group.id);
      if (!target || target.kind !== 'group') continue;
      out.rows[group.id] = target.rows.map((row) => {
        const record: Record<string, FormValue> = {};
        for (const column of group.columns) {
          const at = locateColumn(row, column);
          const value = at && readTarget(at, column, rels);
          if (value !== undefined) record[column.id] = value;
        }
        return record;
      });
    }
  }
  return out;
}

import { isValidIsoDate } from '../../domain/dates';
import { formatDate } from '../format';
import { bytesOf, partText } from '../package';
import type { Package } from '../package';
import type { DraftValues, FieldDef, FormSchema, FormValue, RowGroupDef } from '../types';
import { parseXml, serializeXml } from '../xml';
import { locateColumn, locateWord } from './address';
import type { WordTarget } from './address';
import { controlOf, fieldRange, partsOf } from './read';
import { W, W14, child, isEl, kids, wAttr } from './walk';

/*
 * Writing a draft's values into a copy of a Word form (spec §8, rulings R1 and R2).
 *
 * The template part is parsed afresh and every field and group is found at its stored address with `locateWord`;
 * nothing is detected again. Only the nodes of the fields change, plus the rows cloned for a group that needs more than
 * it has. Clones go straight after the group's last row (a `w:tr`) or last item (the item `w:sdt` of a repeating
 * section), so that `locateWord(output, part, schema, extraRowsOf(schema, values))` finds every address in the output.
 *
 * Rows are cloned before anything is filled, so a clone is a copy of the template's own last row or item. A clone's
 * columns that are given no value are cleared all the same, so that text the template's last item held is not copied
 * into new rows (a control still showing its prompt is left showing it).
 *
 * Ids in a clone:
 * - every `w:sdtPr/w:id` gets a new positive 31-bit number, unique in the part. The numbers come from a xorshift
 *   generator seeded from the ids already in the part, so the same form and values always give the same file;
 * - every bookmark gets a new `w:id` (one more than the largest in the part) and a new name: the old name with `_<k>`
 *   after it, `k` the smallest number not yet taken, the name cut so that the whole is at most 20 characters, Word's
 *   limit for a form field's name (`Dropdown3` becomes `Dropdown3_1`, then `Dropdown3_2`). A legacy form field's
 *   `w:ffData/w:name` follows its bookmark, or gets a name of its own in the same way when it has none, because Word
 *   refuses two form fields of the same name. A bookmark whose start or end is outside the clone is dropped from it;
 * - `wp:docPr/@id` of a drawing gets one more than the largest in the part;
 * - `w14:paraId` and `w14:textId` are removed: they are optional, must be unique, and Word makes new ones.
 *
 * Values are canonical (R2): a `date` is written as `formatDate(iso, hint)`; a content-control date also gets
 * `w:fullDate` and is shown in its own `w:dateFormat` when it has one. A value that is not a real ISO date is written as
 * the text it is. `null`, `undefined` and `''` are no value: nothing is written. `leftEmpty` fields and columns and
 * picture fields (Task 6) are never written.
 */

const DOCUMENT_MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const TEMPLATE_MAIN = /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.template\.main\+xml/i;
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const EMPTY_FORMTEXT = '\u2002'.repeat(5);
/** `w:sym` characters of an empty box (as detection finds them); each becomes the checked box `F0FE` of the same font. */
const BOX_SYMBOLS = new Set(['F0A8', 'F06F', 'F071']);
const CHECKED_SYMBOL = 'F0FE';
/** An empty box written as text, ☐ or □, which becomes ☒. */
const BOX_TEXT = /[\u2610\u25A1]/;
const CHECKED_TEXT = '\u2612';
/** Characters XML 1.0 cannot hold, which a value could carry from a paste: control characters and lone surrogates. */
const NOT_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
/** Elements a paragraph or control keeps when its runs are replaced. */
const KEPT = new Set(['pPr', 'bookmarkStart', 'bookmarkEnd', 'permStart', 'permEnd', 'commentRangeStart', 'commentRangeEnd']);
/** Paragraph-mark properties that are revisions, not formatting, and are not copied into a run. */
const MARK_ONLY = new Set(['ins', 'del', 'moveFrom', 'moveTo', 'rPrChange']);
/** `w:pPr` children that come after `w:jc`, in schema order. */
const AFTER_JC = new Set(['textDirection', 'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', 'rPr', 'sectPr', 'pPrChange']);
const MAX_FIELD_NAME = 20;

/** A value the writer refuses: it names the field, so the person can be told which one. */
export class FormWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormWriteError';
  }
}

/**
 * The text a value becomes in the file: line ends as `\n`, and without the characters XML cannot hold. A value read
 * back from the output equals `wordText` of the value written.
 */
export function wordText(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(NOT_XML, '');
}

/** For each group given more rows than it holds, how many rows are cloned: `rows given − capacity` (R1). */
export function extraRowsOf(schema: FormSchema, values: DraftValues): Record<string, number> {
  const out: Record<string, number> = {};
  for (const group of schema.rowGroups) {
    const given = values.rows[group.id]?.length ?? 0;
    if (given > group.capacity) out[group.id] = given - group.capacity;
  }
  return out;
}

const isBlank = (value: FormValue | undefined): value is null | undefined | '' => value === null || value === undefined || value === '';
const writable = (field: FieldDef): boolean => !field.leftEmpty && field.kind !== 'picture';
const describe = (field: FieldDef): string => `${field.id} (${field.label})`;

function el(doc: Document, name: string): Element {
  return doc.createElementNS(W, `w:${name}`);
}

function setW(target: Element, name: string, value: string): void {
  target.setAttributeNS(W, `w:${name}`, value);
}

/** A copy of run properties, without the grey `PlaceholderText` style a control's prompt is shown in. */
function runProperties(rPr: Element | undefined): Element | undefined {
  if (!rPr) return undefined;
  const copy = rPr.cloneNode(true) as Element;
  for (const style of kids(copy).filter((k) => isEl(k, W, 'rStyle') && wAttr(k, 'val') === 'PlaceholderText')) copy.removeChild(style);
  return copy;
}

/** Run properties for text typed into an empty paragraph: those of its mark (`w:pPr/w:rPr`), without revision marks. */
function markProperties(p: Element): Element | undefined {
  const rPr = child(child(p, W, 'pPr'), W, 'rPr');
  if (!rPr) return undefined;
  const copy = rPr.ownerDocument.createElementNS(W, 'w:rPr');
  for (const k of kids(rPr)) if (!(k.namespaceURI === W && MARK_ONLY.has(k.localName))) copy.appendChild(k.cloneNode(true));
  return copy.firstChild ? copy : undefined;
}

/** One run holding `text`: `w:t` pieces, with `w:br` for each line break and `w:tab` for each tab. */
function textRun(doc: Document, rPr: Element | undefined, text: string): Element {
  const r = el(doc, 'r');
  if (rPr) r.appendChild(rPr);
  wordText(text).split('\n').forEach((line, i) => {
    if (i > 0) r.appendChild(el(doc, 'br'));
    line.split('\t').forEach((piece, j) => {
      if (j > 0) r.appendChild(el(doc, 'tab'));
      if (piece === '') return;
      const t = el(doc, 't');
      if (/^\s|\s$/.test(piece)) t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
      t.appendChild(doc.createTextNode(piece));
      r.appendChild(t);
    });
  });
  return r;
}

/** Removes every child of `parent` but its properties and range marks (bookmarks, permissions, comments). */
function clearRuns(parent: Element): void {
  for (const k of kids(parent)) if (!(k.namespaceURI === W && KEPT.has(k.localName))) parent.removeChild(k);
}

/** The first `w:p` that is a child of `parent`, made when there is none. */
function firstParagraph(parent: Element): Element {
  const found = child(parent, W, 'p');
  if (found) return found;
  const p = el(parent.ownerDocument, 'p');
  parent.appendChild(p);
  return p;
}

/** Centres a paragraph: its `w:jc` set to `center`, put where the schema orders it. */
function centre(p: Element): void {
  const doc = p.ownerDocument;
  let pPr = child(p, W, 'pPr');
  if (!pPr) {
    pPr = el(doc, 'pPr');
    p.insertBefore(pPr, p.firstChild);
  }
  let jc = child(pPr, W, 'jc');
  if (!jc) {
    jc = el(doc, 'jc');
    pPr.insertBefore(jc, kids(pPr).find((k) => k.namespaceURI === W && AFTER_JC.has(k.localName)) ?? null);
  }
  setW(jc, 'val', 'center');
}

// ---------------------------------------------------------------------------------------------------------------
// Ids for clones

/** Makes the ids and names a clone needs, unique in its part. */
class CloneIds {
  private sdtIds = new Set<number>();
  private names = new Set<string>();
  private nextBookmark = 0;
  private nextDocPr = 1;
  private state: number;

  constructor(doc: Document) {
    let seed = 0x811c9dc5;
    for (const id of Array.from(doc.getElementsByTagNameNS(W, 'id'))) {
      if (!isEl(id.parentNode, W, 'sdtPr')) continue;
      const value = Number(wAttr(id, 'val'));
      if (Number.isInteger(value)) this.sdtIds.add(value);
      for (const ch of String(value)) seed = Math.imul(seed ^ ch.charCodeAt(0), 0x01000193);
    }
    this.state = seed >>> 0 || 1;
    for (const name of ['bookmarkStart', 'bookmarkEnd']) {
      for (const b of Array.from(doc.getElementsByTagNameNS(W, name))) {
        const id = Number(wAttr(b, 'id'));
        if (Number.isInteger(id)) this.nextBookmark = Math.max(this.nextBookmark, id + 1);
        const bookmarkName = wAttr(b, 'name');
        if (bookmarkName) this.names.add(bookmarkName);
      }
    }
    for (const name of Array.from(doc.getElementsByTagNameNS(W, 'name'))) {
      if (isEl(name.parentNode, W, 'ffData')) this.names.add(wAttr(name, 'val') ?? '');
    }
    for (const docPr of Array.from(doc.getElementsByTagNameNS(WP, 'docPr'))) {
      const id = Number(docPr.getAttribute('id'));
      if (Number.isInteger(id)) this.nextDocPr = Math.max(this.nextDocPr, id + 1);
    }
  }

  /** A content control id: a positive 31-bit number not yet in the part (xorshift32). */
  sdtId(): number {
    for (;;) {
      let x = this.state;
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      this.state = x >>> 0;
      const id = this.state & 0x7fffffff;
      if (id !== 0 && !this.sdtIds.has(id)) {
        this.sdtIds.add(id);
        return id;
      }
    }
  }

  bookmarkId(): number {
    this.nextBookmark += 1;
    return this.nextBookmark - 1;
  }

  docPrId(): number {
    this.nextDocPr += 1;
    return this.nextDocPr - 1;
  }

  /** `<name>_<k>`, the smallest `k` not taken, cut to Word's 20 characters. */
  name(old: string): string {
    const base = old.replace(/_\d+$/, '');
    for (let k = 1; ; k += 1) {
      const suffix = `_${k}`;
      const candidate = base.slice(0, MAX_FIELD_NAME - suffix.length) + suffix;
      if (!this.names.has(candidate)) {
        this.names.add(candidate);
        return candidate;
      }
    }
  }
}

/** Gives a clone ids and names of its own (see the top of this file). */
function renumber(clone: Element, ids: CloneIds): void {
  const within = (ns: string, name: string): Element[] => [clone, ...Array.from(clone.getElementsByTagNameNS(ns, name))].filter((e) => isEl(e, ns, name));

  for (const id of within(W, 'id')) if (isEl(id.parentNode, W, 'sdtPr')) setW(id, 'val', String(ids.sdtId()));

  const starts = within(W, 'bookmarkStart');
  const ends = within(W, 'bookmarkEnd');
  const renamed = new Map<string, string>();
  for (const start of starts) {
    const old = wAttr(start, 'id');
    const end = ends.find((e) => wAttr(e, 'id') === old);
    if (!end) {
      start.parentNode!.removeChild(start);
      continue;
    }
    const id = String(ids.bookmarkId());
    setW(start, 'id', id);
    setW(end, 'id', id);
    const oldName = wAttr(start, 'name') ?? '';
    const name = ids.name(oldName || 'Field');
    renamed.set(oldName, name);
    setW(start, 'name', name);
    ends.splice(ends.indexOf(end), 1);
  }
  for (const end of ends) end.parentNode!.removeChild(end); // ends whose start is outside the clone

  for (const name of within(W, 'name')) {
    if (!isEl(name.parentNode, W, 'ffData')) continue;
    const old = wAttr(name, 'val') ?? '';
    setW(name, 'val', renamed.get(old) ?? ids.name(old || 'Field'));
  }
  for (const docPr of within(WP, 'docPr')) docPr.setAttribute('id', String(ids.docPrId()));
  for (const e of [clone, ...Array.from(clone.getElementsByTagName('*'))]) {
    e.removeAttributeNS(W14, 'paraId');
    e.removeAttributeNS(W14, 'textId');
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Writing each kind of target

/** Replaces a FORMTEXT's result with one run of `text`, in the properties of its first result run (else its begin run's). */
function writeFormText(begin: Element, text: string, field: FieldDef): void {
  const doc = begin.ownerDocument;
  const beginRun = begin.parentNode as Element;
  let { separate, end } = fieldRange(begin);
  if (!end) throw new FormWriteError(`The field ${describe(field)} has no end in the file.`);
  const endRun = end.parentNode as Element;
  if (!separate) {
    const run = el(doc, 'r');
    const rPr = runProperties(child(beginRun, W, 'rPr'));
    if (rPr) run.appendChild(rPr);
    separate = el(doc, 'fldChar');
    setW(separate, 'fldCharType', 'separate');
    run.appendChild(separate);
    endRun.parentNode!.insertBefore(run, endRun);
  }
  const separateRun = separate.parentNode as Element;
  if (separateRun.parentNode !== endRun.parentNode) throw new FormWriteError(`The result of the field ${describe(field)} runs over more than one paragraph.`);

  const between: Element[] = [];
  for (let node = separateRun.nextSibling; node && node !== endRun; node = node.nextSibling) if (node.nodeType === 1) between.push(node as Element);
  const isRun = (e: Element): boolean => e.namespaceURI === W && e.localName === 'r';
  const firstRun = between.map((e) => (isRun(e) ? e : e.getElementsByTagNameNS(W, 'r')[0])).find(Boolean);
  const rPr = runProperties(child(firstRun ?? beginRun, W, 'rPr') ?? child(beginRun, W, 'rPr'));
  // The result's runs go, with anything that holds runs (a revision, a hyperlink); bookmarks and the like stay.
  for (const e of between) if (isRun(e) || e.getElementsByTagNameNS(W, 'r').length > 0) e.parentNode!.removeChild(e);
  separateRun.parentNode!.insertBefore(textRun(doc, rPr, text), separateRun.nextSibling);
}

function ffChild(begin: Element, name: string): Element | undefined {
  return child(child(begin, W, 'ffData'), W, name);
}

/** Ticks a FORMCHECKBOX with `w:checked`, or unticks it by removing that (or with `w:val="0"` when its default is ticked). */
function writeFormCheck(begin: Element, checked: boolean): void {
  const box = ffChild(begin, 'checkBox');
  if (!box) return;
  for (const old of kids(box).filter((k) => isEl(k, W, 'checked'))) box.removeChild(old);
  const byDefault = child(box, W, 'default');
  const defaultOn = !!byDefault && !['0', 'false', 'off'].includes(wAttr(byDefault, 'val') ?? '');
  if (!checked && !defaultOn) return;
  const mark = el(begin.ownerDocument, 'checked');
  setW(mark, 'val', checked ? '1' : '0');
  box.appendChild(mark); // `w:checked` is the last child of `w:checkBox`
}

/** Chooses an entry of a FORMDROPDOWN: `w:result` (its first child) is the entry's index, the prompt entry counted. */
function writeFormDrop(begin: Element, value: string | undefined, field: FieldDef): void {
  const list = ffChild(begin, 'ddList');
  if (!list) return;
  for (const old of kids(list).filter((k) => isEl(k, W, 'result'))) list.removeChild(old);
  if (value === undefined) return;
  const entries = kids(list).filter((k) => isEl(k, W, 'listEntry')).map((k) => wAttr(k, 'val') ?? '');
  const index = entries.indexOf(value);
  if (index < 0 || (field.options && !field.options.includes(value))) throw new FormWriteError(`"${value}" is not an option of the field ${describe(field)}.`);
  const result = el(begin.ownerDocument, 'result');
  setW(result, 'val', String(index));
  list.insertBefore(result, list.firstChild);
}

/**
 * Puts `text` in a content control as one run, in the properties of its first run (the control's own `w:rPr` while it
 * showed its prompt), without the prompt's style. A control between paragraphs keeps its first paragraph and its
 * properties; one inside a paragraph holds the run itself. `font` sets the run's font (a checkbox's glyph).
 */
function writeControlText(sdt: Element, text: string, placeholder: boolean, font?: string): void {
  const doc = sdt.ownerDocument;
  const sdtPr = child(sdt, W, 'sdtPr');
  let content = child(sdt, W, 'sdtContent');
  if (!content) {
    content = el(doc, 'sdtContent');
    sdt.appendChild(content);
  }
  const firstRun = content.getElementsByTagNameNS(W, 'r')[0];
  const own = placeholder ? child(sdtPr, W, 'rPr') : undefined;
  let rPr = runProperties(own ?? child(firstRun, W, 'rPr'));
  if (font) {
    rPr ??= el(doc, 'rPr');
    let fonts = child(rPr, W, 'rFonts');
    if (!fonts) {
      fonts = el(doc, 'rFonts');
      rPr.insertBefore(fonts, kids(rPr).find((k) => !isEl(k, W, 'rStyle')) ?? null);
    }
    for (const slot of ['ascii', 'hAnsi', 'eastAsia', 'cs']) setW(fonts, slot, font);
  }
  const paragraph = content.getElementsByTagNameNS(W, 'p')[0];
  if (paragraph) {
    if (paragraph.parentNode === content) for (const p of kids(content).filter((k) => isEl(k, W, 'p') && k !== paragraph)) content.removeChild(p);
    clearRuns(paragraph);
    paragraph.appendChild(textRun(doc, rPr, text));
  } else {
    clearRuns(content);
    content.appendChild(textRun(doc, rPr, text));
  }
}

/** Writes a content control, or clears it (`value` undefined) unless it shows its prompt. */
function writeControl(sdt: Element, value: string | boolean | undefined, field: FieldDef): void {
  const control = controlOf(sdt);
  const { sdtPr } = control;
  if (control.type === 'picture' || !sdtPr) return;
  const prompt = child(sdtPr, W, 'showingPlcHdr');
  if (value === undefined && prompt) return;
  if (prompt) sdtPr.removeChild(prompt);
  // A control bound to a custom XML part would show that part's data, not the value, when the file is opened.
  for (const binding of kids(sdtPr).filter((k) => k.localName === 'dataBinding')) sdtPr.removeChild(binding);

  if (control.type === 'checkbox') {
    if (value !== undefined && typeof value !== 'boolean') throw new FormWriteError(`The checkbox ${describe(field)} takes true or false.`);
    const on = value === true;
    const box = control.el!;
    let checked = child(box, W14, 'checked');
    if (!checked) {
      checked = sdt.ownerDocument.createElementNS(W14, 'w14:checked');
      box.insertBefore(checked, box.firstChild);
    }
    checked.setAttributeNS(W14, 'w14:val', on ? '1' : '0');
    const state = child(box, W14, on ? 'checkedState' : 'uncheckedState');
    const code = parseInt(state?.getAttributeNS(W14, 'val') ?? '', 16);
    const glyph = String.fromCodePoint(Number.isInteger(code) && code > 0 && code <= 0x10ffff ? code : on ? 0x2612 : 0x2610);
    writeControlText(sdt, glyph, !!prompt, state?.getAttributeNS(W14, 'font') || undefined);
    return;
  }
  if (typeof value === 'boolean') throw new FormWriteError(`The field ${describe(field)} takes text.`);
  const text = value ?? '';

  if (control.type === 'date') {
    const date = control.el!;
    if (isValidIsoDate(text)) {
      setW(date, 'fullDate', `${text}T00:00:00Z`);
      writeControlText(sdt, formatDate(text, wAttr(child(date, W, 'dateFormat'), 'val') || field.formatHint), !!prompt);
    } else {
      date.removeAttributeNS(W, 'fullDate');
      writeControlText(sdt, text, !!prompt);
    }
    return;
  }
  if (control.type === 'dropDownList' || control.type === 'comboBox') {
    const list = control.el!;
    const items = kids(list).filter((k) => isEl(k, W, 'listItem'));
    const item = items.find((k) => (wAttr(k, 'displayText') ?? wAttr(k, 'value')) === text);
    if (value !== undefined && control.type === 'dropDownList' && !item) throw new FormWriteError(`"${text}" is not an option of the field ${describe(field)}.`);
    if (item) setW(list, 'lastValue', wAttr(item, 'value') ?? text);
    else list.removeAttributeNS(W, 'lastValue');
  }
  writeControlText(sdt, text, !!prompt);
}

/** Ticks the option at `index`: its empty box becomes a checked one, else a centred `X` goes in its cell. */
function writeTick(cells: Element[], index: number): void {
  const tc = cells[index];
  const symbol = Array.from(tc.getElementsByTagNameNS(W, 'sym')).find((s) => BOX_SYMBOLS.has((wAttr(s, 'char') ?? '').toUpperCase()));
  if (symbol) {
    setW(symbol, 'char', CHECKED_SYMBOL);
    return;
  }
  const t = Array.from(tc.getElementsByTagNameNS(W, 't')).find((e) => BOX_TEXT.test(e.textContent ?? ''));
  if (t) {
    const text = (t.textContent ?? '').replace(BOX_TEXT, CHECKED_TEXT);
    while (t.firstChild) t.removeChild(t.firstChild);
    t.appendChild(t.ownerDocument.createTextNode(text));
    return;
  }
  const p = firstParagraph(tc);
  centre(p);
  p.appendChild(textRun(tc.ownerDocument, markProperties(p), 'X'));
}

/** Writes text into a table cell of a plain group: its first paragraph gets one run, in the paragraph's properties. */
function writeCell(tc: Element, text: string): void {
  const p = firstParagraph(tc);
  const runs = kids(p).filter((k) => isEl(k, W, 'r'));
  const rPr = runProperties(child(runs[0], W, 'rPr')) ?? markProperties(p);
  for (const r of runs) p.removeChild(r); // the rows of a plain group are empty: these runs hold no text
  p.appendChild(textRun(tc.ownerDocument, rPr, text));
}

/** The text a field's value is written as: a date in the field's format (R2), anything else as it is. */
function asText(value: FormValue, field: FieldDef): string {
  if (typeof value !== 'string') throw new FormWriteError(`The field ${describe(field)} takes text, not ${String(value)}.`);
  return field.kind === 'date' && isValidIsoDate(value) ? formatDate(value, field.formatHint) : value;
}

function asOption(value: FormValue, field: FieldDef, options: readonly string[] | undefined): number {
  const index = typeof value === 'string' && options ? options.indexOf(value) : -1;
  if (index < 0) throw new FormWriteError(`"${String(value)}" is not an option of the field ${describe(field)}.`);
  return index;
}

/** Writes a value (not blank) into the target of a field or column. */
function writeTarget(target: WordTarget, field: FieldDef, value: string | boolean): void {
  switch (target.kind) {
    case 'formtext': writeFormText(target.begin, asText(value, field), field); break;
    case 'formcheck':
      if (typeof value !== 'boolean') throw new FormWriteError(`The checkbox ${describe(field)} takes true or false.`);
      writeFormCheck(target.begin, value);
      break;
    case 'formdrop':
      if (typeof value !== 'string') throw new FormWriteError(`The field ${describe(field)} takes one of its options.`);
      writeFormDrop(target.begin, value, field);
      break;
    case 'sdt': writeControl(target.sdt, value, field); break;
    case 'tick': writeTick(target.cells, asOption(value, field, field.options)); break;
    case 'cell': writeCell(target.tc, asText(value, field)); break;
    default: throw new FormWriteError(`The field ${describe(field)} is not a field in the file.`);
  }
}

/** Empties a column of a cloned row, so that nothing of the template's last row is copied into it. */
function clearTarget(target: WordTarget, field: FieldDef): void {
  switch (target.kind) {
    case 'formtext': writeFormText(target.begin, EMPTY_FORMTEXT, field); break;
    case 'formcheck': writeFormCheck(target.begin, false); break;
    case 'formdrop': writeFormDrop(target.begin, undefined, field); break;
    case 'sdt': writeControl(target.sdt, undefined, field); break;
    default: break; // a cell of a plain group: the row cloned is empty
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The part and the package

/** Clones the group's last row `extra` times, straight after it, and gives back all its rows. */
function growRows(rows: Element[], extra: number, ids: CloneIds): { rows: Element[]; clones: Set<Element> } {
  const clones = new Set<Element>();
  const last = rows[rows.length - 1];
  let anchor = last;
  for (let i = 0; i < extra; i += 1) {
    const clone = last.cloneNode(true) as Element;
    renumber(clone, ids);
    anchor.parentNode!.insertBefore(clone, anchor.nextSibling);
    clones.add(clone);
    anchor = clone;
  }
  return { rows: [...rows, ...clones], clones };
}

/** Fills a group's rows, cloning rows first when more are given than it holds. True when anything changed. */
function writeGroup(group: RowGroupDef, target: WordTarget | undefined, records: Record<string, FormValue>[], ids: () => CloneIds): boolean {
  const extra = records.length - group.capacity;
  const anyValue = records.some((record) => group.columns.some((c) => writable(c) && !isBlank(record[c.id])));
  if (!anyValue && extra <= 0) return false;
  if (!target || target.kind !== 'group') throw new FormWriteError(`The table ${group.id} (${group.label}) is not where it was in the file.`);
  if (extra > 0 && !group.growable) throw new FormWriteError(`The table ${group.id} (${group.label}) holds ${group.capacity} rows, not ${records.length}.`);
  const { rows, clones } = extra > 0 ? growRows(target.rows, extra, ids()) : { rows: target.rows, clones: new Set<Element>() };

  records.forEach((record, i) => {
    const row = rows[i];
    for (const column of group.columns) {
      if (column.kind === 'picture') continue;
      const value = record[column.id];
      const blank = !writable(column) || isBlank(value);
      if (blank && !clones.has(row)) continue;
      const at = locateColumn(row, column);
      if (!at) {
        if (blank) continue;
        throw new FormWriteError(`The column ${describe(column)} is not where it was in row ${i + 1} of the table ${group.id}.`);
      }
      if (blank) clearTarget(at, column);
      else writeTarget(at, column, value);
    }
  });
  return true;
}

/** Fills one part. Gives back its new XML, or `undefined` when nothing in it was written. */
function writePart(text: string, part: string, schema: FormSchema, values: DraftValues): string | undefined {
  const doc = parseXml(text);
  const targets = locateWord(doc, part, schema);
  let cloneIds: CloneIds | undefined;
  const ids = (): CloneIds => (cloneIds ??= new CloneIds(doc));
  let changed = false;

  // Every target was found in the template before any row is cloned, so a clone moves no field away from its node.
  for (const group of schema.rowGroups) {
    if (!targets.has(group.id) && !isHere(group.loc, part)) continue;
    if (writeGroup(group, targets.get(group.id), values.rows[group.id] ?? [], ids)) changed = true;
  }
  for (const field of schema.fields) {
    const value = values.fields[field.id];
    if (!writable(field) || isBlank(value) || !isHere(field.loc, part)) continue;
    const target = targets.get(field.id);
    if (!target) throw new FormWriteError(`The field ${describe(field)} is not where it was in the file.`);
    writeTarget(target, field, value);
    changed = true;
  }
  return changed ? serializeXml(doc) : undefined;
}

function isHere(loc: string, part: string): boolean {
  return loc.startsWith(`${part}#`);
}

/**
 * Writes a draft's values into a copy of a Word form and gives back the parts that changed: the part the fields are in
 * (`word/document.xml`) when anything was written to it, and `[Content_Types].xml` when the form is a template
 * (`.dotx`), whose main part becomes a document's. `pkg` is not changed. Throws `FormWriteError`, naming the field,
 * for a value that has no place to go: a field or table whose address no longer fits the file, a choice that is not
 * one of the options, a checkbox given text, more rows than a table that cannot grow holds.
 *
 * `opts.photos` (photo id to JPEG bytes) is for picture fields, which Task 6 writes; until then it is not read.
 */
export function writeWord(pkg: Package, schema: FormSchema, values: DraftValues, opts: { photos: Record<string, Uint8Array> }): Map<string, Uint8Array> {
  void opts;
  const changed = new Map<string, Uint8Array>();
  for (const part of partsOf(schema)) {
    const text = partText(pkg, part);
    if (text === undefined) throw new FormWriteError(`The form has no part ${part}.`);
    const written = writePart(text, part, schema, values);
    if (written !== undefined) changed.set(part, bytesOf(written));
  }
  const types = partText(pkg, '[Content_Types].xml');
  if (types !== undefined && TEMPLATE_MAIN.test(types)) {
    // A text replacement, so that nothing else in the part changes by a byte.
    changed.set('[Content_Types].xml', bytesOf(types.replace(new RegExp(TEMPLATE_MAIN.source, 'gi'), DOCUMENT_MAIN)));
  }
  return changed;
}

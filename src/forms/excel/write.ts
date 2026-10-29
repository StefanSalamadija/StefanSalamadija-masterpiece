import { isValidIsoDate } from '../../domain/dates';
import { FormWriteError } from '../errors';
import { formatDate } from '../format';
import { bytesOf, partText } from '../package';
import type { Package } from '../package';
import type { DraftValues, FieldDef, FormSchema, FormValue } from '../types';
import { parseXml, serializeXml, xmlText } from '../xml';
import { kindOfFormat } from './numFmt';
import type { FormatKind } from './numFmt';
import { columnOfLoc, parseCellLoc, parseRange, parseRef, refOf } from './refs';
import { canonicalExcelValue, isoToSerial, minutesOf, numberOf, timeText, timeToFraction } from './values';
import { isTrue, kid, kids, loadFormats, relOfType, relsOf, stringItemText, workbookPath } from './workbook';
import type { Format } from './workbook';

export { canonicalExcelValue };

/*
 * Writing a draft's values into a copy of an Excel form (spec §8, rulings R1, R2, R12, R15).
 *
 * Every value goes to the cell its field's stored `loc` names (`<sheet part>!<A1>`); a group's row `i` is sheet row
 * `firstRow + i`, in the column its column's `loc` names. Nothing is detected again. Excel groups never grow: a value in
 * a row at or past the group's capacity is a `FormWriteError`, never dropped.
 *
 * What a cell gets (the cell's `s` is always kept, so the form looks as it did):
 * - text: a shared string (`t="s"`), appended to `sharedStrings.xml` after the existing items, or the index of an
 *   identical plain item already there. `count` and `uniqueCount` follow. The text is `xmlText(value)`; a literal
 *   `_xHHHH_` in it is escaped as `_x005F_xHHHH_` so that Excel does not read it as a character code, and a line break
 *   stays a `\n` inside the one cell (it shows on several lines only where the cell's style wraps text);
 * - a `number` field: the number (`parseDecimal`, `,` or `.` as the decimal mark) as JavaScript writes it, in `<v>`
 *   with no `t`. A value that is no number is written as text;
 * - a `date` field (ISO): in a cell with a date format, the serial in the workbook's date system (1900, with Excel's
 *   29 February 1900, or 1904 with `workbookPr date1904`); elsewhere, or before the system's first day, the text
 *   `formatDate(iso, field.formatHint)`. A value that is no ISO date is written as the text it is;
 * - a `time` field (`HH:mm`): in a cell with a time format, the fraction of a day (R15); elsewhere the text `HH:mm`
 *   (a fraction in a General cell would show as `0.4375`). A value that is no time of day is written as text;
 * - a `checkbox` field: a boolean (`t="b"`). A `choice` field: the option's text, which must be one of `options`.
 *
 * Old content goes: a cell's `t`, its cached `<v>` and its inline `<is>` are replaced. A cell with a formula is never
 * written (`FormWriteError`). `leftEmpty` fields and columns, and blank values (`null`, `''`), are not written.
 *
 * Cells and rows that the sheet has no element for are created: a `<c>` in column order inside its row, a `<row>` in
 * row order. A new cell takes its row's style when the row has one (`s` with `customFormat`), else its column's
 * (`<col style>`), else none. Nothing is renumbered, so no other address moves (R12): a cell or row with no `r` of its
 * own always directly follows the one before it, so nothing new can come between them. The sheet's `dimension` and a
 * row's `spans` grow to take a new cell.
 *
 * `xl/workbook.xml` gets `<calcPr fullCalcOnLoad="1"/>` (merged into its `calcPr`, or added in schema order), so that
 * Excel works out every formula (totals) when it opens the file. `calcChain.xml` is left alone: no formula cell changes.
 *
 * Only these parts change: the sheets written into, `sharedStrings.xml`, `workbook.xml`, and, when the workbook had no
 * shared strings, the workbook's `.rels` and `[Content_Types].xml` (text insertions, so every other byte stays).
 */

const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const TRANSITIONAL = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const SHARED_STRINGS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings';
const SHARED_STRINGS_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml';
/** The children of `workbook` that come after `calcPr`, in schema order. */
const AFTER_CALC_PR = new Set([
  'oleSize', 'customWorkbookViews', 'pivotCaches', 'smartTagPr', 'smartTagTypes', 'webPublishing', 'fileRecoveryPr', 'webPublishObjects', 'extLst',
]);

/** What a cell holds once written: a number (`t` none), a shared string (`t="s"`), or a boolean (`t="b"`). */
type Encoded = { t: 'n'; v: string } | { t: 's'; text: string } | { t: 'b'; v: '1' | '0' };

/** One value to write: its cell and its field. */
interface Target { row: number; col: number; field: FieldDef; value: string | boolean }

const isBlank = (value: FormValue | undefined): value is null | undefined | '' => value === null || value === undefined || value === '';
const describe = (field: FieldDef): string => `${field.id} (${field.label})`;

/** Excel reads `_xHHHH_` in a string as the character HHHH, so a literal one is written with its `_` escaped. */
function escapeCodes(text: string): string {
  return text.replace(/_x([0-9A-Fa-f]{4})_/g, '_x005F_x$1_');
}

/** The values to write, by sheet part, in schema order. Throws for a value that has no cell. */
function targetsOf(schema: FormSchema, values: DraftValues): Map<string, Target[]> {
  const byPart = new Map<string, Target[]>();
  const add = (part: string, target: Target): void => {
    const list = byPart.get(part);
    if (list) list.push(target);
    else byPart.set(part, [target]);
  };

  for (const field of schema.fields) {
    const value = values.fields[field.id];
    if (field.leftEmpty || isBlank(value)) continue;
    const at = parseCellLoc(field.loc);
    if (!at) throw new FormWriteError(`The field ${describe(field)} has no cell in the file.`);
    add(at.part, { row: at.row, col: at.col, field, value });
  }

  for (const group of schema.rowGroups) {
    const rows = values.rows[group.id] ?? [];
    const at = parseCellLoc(group.loc);
    const firstRow = group.firstRow ?? at?.row;
    const columns = group.columns.filter((column) => !column.leftEmpty).map((column) => ({ column, col: columnOfLoc(column.loc) }));
    rows.forEach((record, i) => {
      for (const { column, col } of columns) {
        const value = record?.[column.id];
        if (isBlank(value)) continue;
        if (i >= group.capacity) {
          throw new FormWriteError(`The table ${group.id} (${group.label}) holds ${group.capacity} rows, so row ${i + 1} cannot be written.`);
        }
        if (!at || firstRow === undefined || col === undefined) throw new FormWriteError(`The column ${describe(column)} has no cell in the file.`);
        add(at.part, { row: firstRow + i, col, field: column, value });
      }
    });
  }
  return byPart;
}

/** What `value` becomes in a cell whose format is `format`. Throws for a value the field cannot take. */
function encode(field: FieldDef, value: string | boolean, format: FormatKind, date1904: boolean): Encoded {
  const text = (s: string): Encoded => ({ t: 's', text: xmlText(s) });
  if (field.kind === 'checkbox') {
    if (typeof value !== 'boolean') throw new FormWriteError(`The field ${describe(field)} is a tick box, not text.`);
    return { t: 'b', v: value ? '1' : '0' };
  }
  if (typeof value === 'boolean') throw new FormWriteError(`The field ${describe(field)} takes text, not a tick.`);
  switch (field.kind) {
    case 'picture':
      throw new FormWriteError(`The field ${describe(field)} is a picture, which an Excel form cannot hold.`);
    case 'choice':
      if (field.options && !field.options.includes(value)) throw new FormWriteError(`The field ${describe(field)} has no option ${value}.`);
      return text(value);
    case 'number': {
      const n = numberOf(value);
      return n === undefined ? text(value) : { t: 'n', v: String(n) };
    }
    case 'date': {
      if (!isValidIsoDate(value)) return text(value);
      const serial = format === 'date' ? isoToSerial(value, date1904) : undefined;
      return serial === undefined ? text(formatDate(value, field.formatHint)) : { t: 'n', v: String(serial) };
    }
    case 'time': {
      const minutes = minutesOf(value);
      if (minutes === undefined) return text(value);
      return format === 'time' ? { t: 'n', v: String(timeToFraction(minutes)) } : text(timeText(minutes));
    }
    default:
      return text(value);
  }
}

/** Makes an element in the namespace and with the prefix of `like`'s document root. */
function element(like: Element, name: string): Element {
  const root = like.ownerDocument.documentElement;
  return like.ownerDocument.createElementNS(root.namespaceURI ?? TRANSITIONAL, root.prefix ? `${root.prefix}:${name}` : name);
}

// ---------------------------------------------------------------------------------------------------------------
// A sheet being written

/**
 * One worksheet part, parsed once, with its rows and (as they are needed) each row's cells indexed by number, so that
 * finding a cell is a map lookup however large the sheet.
 */
class SheetEditor {
  private readonly doc: Document;
  private readonly sheetData: Element;
  private readonly rows = new Map<number, Element>();
  /** The numbers of the rows the sheet has, ascending. */
  private readonly rowNumbers: number[] = [];
  private readonly cells = new Map<number, Map<number, Element>>();
  private colStyles?: { min: number; max: number; style: string }[];
  /** The rectangle of the cells created, for the sheet's `dimension`. */
  private created?: { r1: number; c1: number; r2: number; c2: number };

  constructor(text: string, part: string) {
    this.doc = parseXml(text);
    const sheetData = kid(this.doc.documentElement, 'sheetData');
    if (!sheetData) throw new FormWriteError(`The sheet ${part} has no cells.`);
    this.sheetData = sheetData;
    let number = 0;
    for (const row of kids(sheetData, 'row')) {
      number = Number(row.getAttribute('r') ?? number + 1) || number + 1;
      this.rows.set(number, row);
      this.rowNumbers.push(number);
    }
    this.rowNumbers.sort((a, b) => a - b);
  }

  /** The `<c>` of a cell, created (with the row's or column's style) when the sheet has none. */
  cell(row: number, col: number): Element {
    const rowEl = this.rows.get(row) ?? this.insertRow(row);
    const cells = this.cells.get(row) ?? this.indexRow(row, rowEl);
    const existing = cells.get(col);
    if (existing) return existing;

    const c = element(rowEl, 'c');
    c.setAttribute('r', refOf(col, row));
    const style = this.styleFor(rowEl, col);
    if (style !== undefined) c.setAttribute('s', style);
    let next: Element | undefined;
    let nextCol = Infinity;
    for (const [k, el] of cells) {
      if (k > col && k < nextCol) {
        next = el;
        nextCol = k;
      }
    }
    rowEl.insertBefore(c, next ?? kid(rowEl, 'extLst') ?? null);
    cells.set(col, c);
    this.grow(rowEl, row, col);
    return c;
  }

  /** The cell's number format kind, from its `s`. */
  formatOf(c: Element, formats: Format[]): FormatKind {
    const format = formats[Number(c.getAttribute('s') ?? 0) || 0] ?? formats[0];
    return format ? kindOfFormat(format.numFmtId, format.numFmt) : 'text';
  }

  serialize(): string {
    const dimension = kid(this.doc.documentElement, 'dimension');
    const range = dimension && parseRange(dimension.getAttribute('ref') ?? '');
    if (dimension && range && this.created) {
      const r1 = Math.min(range.r1, this.created.r1);
      const c1 = Math.min(range.c1, this.created.c1);
      const r2 = Math.max(range.r2, this.created.r2);
      const c2 = Math.max(range.c2, this.created.c2);
      if (r1 !== range.r1 || c1 !== range.c1 || r2 !== range.r2 || c2 !== range.c2) dimension.setAttribute('ref', `${refOf(c1, r1)}:${refOf(c2, r2)}`);
    }
    return serializeXml(this.doc);
  }

  /** A new, empty `<row>` in row order. */
  private insertRow(row: number): Element {
    const rowEl = element(this.sheetData, 'row');
    rowEl.setAttribute('r', String(row));
    let lo = 0;
    let hi = this.rowNumbers.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.rowNumbers[mid]! < row) lo = mid + 1;
      else hi = mid;
    }
    const after = this.rowNumbers[lo];
    this.sheetData.insertBefore(rowEl, after === undefined ? null : this.rows.get(after)!);
    this.rowNumbers.splice(lo, 0, row);
    this.rows.set(row, rowEl);
    return rowEl;
  }

  /** The cells of a row by column number. A cell with no `r` is the one after the cell before it. */
  private indexRow(row: number, rowEl: Element): Map<number, Element> {
    const cells = new Map<number, Element>();
    let col = 0;
    for (const c of kids(rowEl, 'c')) {
      col = parseRef(c.getAttribute('r') ?? '')?.col ?? col + 1;
      cells.set(col, c);
    }
    this.cells.set(row, cells);
    return cells;
  }

  /** The style a new cell takes: its row's (with `customFormat`), else its column's, else none. */
  private styleFor(rowEl: Element, col: number): string | undefined {
    const rowStyle = rowEl.getAttribute('s');
    if (rowStyle && rowStyle !== '0' && isTrue(rowEl.getAttribute('customFormat'))) return rowStyle;
    this.colStyles ??= kids(kid(this.doc.documentElement, 'cols') ?? this.doc.documentElement, 'col').flatMap((c) => {
      const style = c.getAttribute('style');
      return style && style !== '0' ? [{ min: Number(c.getAttribute('min')), max: Number(c.getAttribute('max')), style }] : [];
    });
    return this.colStyles.find((c) => c.min <= col && col <= c.max)?.style;
  }

  /** Grows the row's `spans` (when it is one range) and the created rectangle to take a new cell. */
  private grow(rowEl: Element, row: number, col: number): void {
    const spans = /^(\d+):(\d+)$/.exec(rowEl.getAttribute('spans') ?? '');
    if (spans) rowEl.setAttribute('spans', `${Math.min(Number(spans[1]), col)}:${Math.max(Number(spans[2]), col)}`);
    const c = this.created;
    this.created = c
      ? { r1: Math.min(c.r1, row), c1: Math.min(c.c1, col), r2: Math.max(c.r2, row), c2: Math.max(c.c2, col) }
      : { r1: row, c1: col, r2: row, c2: col };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Shared strings

/** The workbook's shared strings, parsed (or made) on first use. */
class SharedStrings {
  private doc?: Document;
  private root?: Element;
  /** The index of each plain item (one `t`, no runs), by its text. */
  private readonly index = new Map<string, number>();
  private items = 0;
  /** References added, less references removed. */
  private references = 0;
  private touched = false;
  /** The part did not exist and was made here. */
  created = false;

  constructor(private readonly pkg: Package, readonly path: string, private readonly ns: string) {}

  private load(): Element {
    if (this.root) return this.root;
    const text = partText(this.pkg, this.path);
    this.created = text === undefined;
    this.doc = parseXml(text ?? `${XML_DECLARATION}<sst xmlns="${this.ns}" count="0" uniqueCount="0"/>`);
    this.root = this.doc.documentElement;
    const items = kids(this.root, 'si');
    items.forEach((si, i) => {
      const parts = kids(si);
      if (parts.length !== 1 || parts[0]!.localName !== 't') return;
      const key = stringItemText(si);
      if (!this.index.has(key)) this.index.set(key, i);
    });
    this.items = items.length;
    return this.root;
  }

  /** The index of an item holding `text`: an identical plain one, or a new one appended. */
  add(text: string): number {
    const root = this.load();
    this.touched = true;
    this.references += 1;
    const known = this.index.get(text);
    if (known !== undefined) return known;
    const si = element(root, 'si');
    const t = element(root, 't');
    if (/^\s|\s$/.test(text)) t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
    t.appendChild(this.doc!.createTextNode(escapeCodes(text)));
    si.appendChild(t);
    root.insertBefore(si, kid(root, 'extLst') ?? null);
    this.index.set(text, this.items);
    this.items += 1;
    return this.items - 1;
  }

  /** A cell that held a shared string no longer does. */
  release(): void {
    this.load();
    this.touched = true;
    this.references -= 1;
  }

  /** The part's new text, or `undefined` when nothing changed. `count` is kept only when the part had one. */
  result(): string | undefined {
    if (!this.touched || !this.root) return undefined;
    const count = this.root.getAttribute('count');
    if (count !== null) this.root.setAttribute('count', String(Math.max(0, (Number(count) || 0) + this.references)));
    this.root.setAttribute('uniqueCount', String(this.items));
    return serializeXml(this.doc!);
  }
}

/** The workbook's `.rels` text with a relationship to `target` of type `type` added, under the next free `rId<n>`. */
function withRelationship(rels: string, type: string, target: string): string {
  const ids = new Set(Array.from(rels.matchAll(/\bId="([^"]*)"/g), (m) => m[1]!));
  let n = Math.max(0, ...Array.from(ids, (id) => Number(/^rId(\d+)$/.exec(id)?.[1] ?? 0))) + 1;
  while (ids.has(`rId${n}`)) n += 1;
  const entry = `<Relationship Id="rId${n}" Type="${type}" Target="${target}"/>`;
  return rels.replace(/<\/((?:\w+:)?)Relationships>\s*$/, (end) => entry + end);
}

/** `[Content_Types].xml` with an Override for the part, unless it has one. */
function withOverride(types: string, path: string, contentType: string): string {
  const partName = `/${path}`;
  const has = Array.from(types.matchAll(/<(?:\w+:)?Override\b[^>]*\bPartName="([^"]*)"/g)).some((m) => m[1]!.toLowerCase() === partName.toLowerCase());
  if (has) return types;
  const entry = `<Override PartName="${partName}" ContentType="${contentType}"/>`;
  return types.replace(/<\/((?:\w+:)?)Types>\s*$/, (end) => entry + end);
}

// ---------------------------------------------------------------------------------------------------------------
// The workbook

/** Sets `fullCalcOnLoad="1"` on the workbook's `calcPr`, adding one in schema order; false when it was set already. */
function setFullCalcOnLoad(root: Element): boolean {
  const existing = kid(root, 'calcPr');
  if (existing) {
    if (isTrue(existing.getAttribute('fullCalcOnLoad'))) return false;
    existing.setAttribute('fullCalcOnLoad', '1');
    return true;
  }
  const calcPr = element(root, 'calcPr');
  calcPr.setAttribute('fullCalcOnLoad', '1');
  root.insertBefore(calcPr, kids(root).find((k) => AFTER_CALC_PR.has(k.localName)) ?? null);
  return true;
}

function writeCell(c: Element, encoded: Encoded, field: FieldDef, strings: SharedStrings): void {
  const parts = kids(c);
  if (parts.some((k) => k.localName === 'f')) throw new FormWriteError(`The field ${describe(field)} is a formula cell, which is never written.`);
  if (c.getAttribute('t') === 's' && parts.some((k) => k.localName === 'v')) strings.release();
  for (const k of parts) if (k.localName === 'v' || k.localName === 'is') c.removeChild(k);
  c.removeAttribute('t');
  const v = element(c, 'v');
  if (encoded.t === 's') {
    c.setAttribute('t', 's');
    v.appendChild(c.ownerDocument.createTextNode(String(strings.add(encoded.text))));
  } else {
    if (encoded.t === 'b') c.setAttribute('t', 'b');
    v.appendChild(c.ownerDocument.createTextNode(encoded.v));
  }
  c.insertBefore(v, kid(c, 'extLst') ?? null);
}

/**
 * Writes a draft's values into a copy of an Excel form and gives back the parts that changed (see the top of this
 * file). `pkg` is not changed. Throws `FormWriteError`, naming the field, for a value that has no place to go: a cell
 * address that does not fit the file, a formula cell, a value in a row past a group's capacity, a tick for a text field,
 * a choice that is not one of the options.
 */
export function writeExcel(pkg: Package, schema: FormSchema, values: DraftValues): Map<string, Uint8Array> {
  const wbPath = workbookPath(pkg);
  const wbText = partText(pkg, wbPath);
  if (wbText === undefined) throw new FormWriteError(`The form has no part ${wbPath}.`);
  const wbDoc = parseXml(wbText);
  const root = wbDoc.documentElement;
  const date1904 = isTrue(kid(root, 'workbookPr')?.getAttribute('date1904') ?? null);
  const rels = relsOf(pkg, wbPath);
  const formats = loadFormats(pkg, rels);
  const dir = wbPath.includes('/') ? wbPath.slice(0, wbPath.lastIndexOf('/') + 1) : '';
  const stringsRel = relOfType(rels, 'sharedStrings');
  const strings = new SharedStrings(pkg, stringsRel?.target ?? `${dir}sharedStrings.xml`, root.namespaceURI ?? TRANSITIONAL);

  const changed = new Map<string, Uint8Array>();
  for (const [part, targets] of targetsOf(schema, values)) {
    const text = partText(pkg, part);
    if (text === undefined) throw new FormWriteError(`The form has no part ${part}.`);
    const sheet = new SheetEditor(text, part);
    for (const target of targets) {
      const c = sheet.cell(target.row, target.col);
      writeCell(c, encode(target.field, target.value, sheet.formatOf(c, formats), date1904), target.field, strings);
    }
    changed.set(part, bytesOf(sheet.serialize()));
  }

  const sst = strings.result();
  if (sst !== undefined) {
    changed.set(strings.path, bytesOf(sst));
    if (strings.created) {
      if (!stringsRel) {
        const relsPath = `${dir}_rels/${wbPath.slice(dir.length)}.rels`;
        const relsText = partText(pkg, relsPath);
        if (relsText === undefined) throw new FormWriteError(`The form has no part ${relsPath}.`);
        const worksheetType = rels.find((r) => r.type.endsWith('/worksheet'))?.type;
        const type = worksheetType ? worksheetType.replace(/worksheet$/, 'sharedStrings') : SHARED_STRINGS_REL;
        changed.set(relsPath, bytesOf(withRelationship(relsText, type, strings.path.slice(dir.length))));
      }
      const types = partText(pkg, '[Content_Types].xml');
      if (types !== undefined) {
        const withPart = withOverride(types, strings.path, SHARED_STRINGS_TYPE);
        if (withPart !== types) changed.set('[Content_Types].xml', bytesOf(withPart));
      }
    }
  }

  if (setFullCalcOnLoad(root)) changed.set(wbPath, bytesOf(serializeXml(wbDoc)));
  return changed;
}

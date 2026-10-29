import { NotAFormError } from '../errors';
import { partText } from '../package';
import type { Package } from '../package';
import { parseXml } from '../xml';
import { builtInFormat } from './numFmt';
import { MAX_COL, MAX_ROW, columnLetters, parseRange, parseRef, refOf } from './refs';

/*
 * A workbook as detection reads it (Task 7): its sheets, each with its cells (text from the shared strings, formulas,
 * formats and borders from `styles.xml`), merges, print area, and hidden rows and columns. It is read once, at import,
 * and never written back: writing (Task 8) changes the parts themselves.
 *
 * Elements are found by local name in the SpreadsheetML namespaces, transitional and strict, so that a file saved in
 * either works. Nothing here uses `querySelector`, which xmldom does not have.
 */

const SML = new Set([
  'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  'http://purl.oclc.org/ooxml/spreadsheetml/main',
]);
const OFFICE_RELS = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  'http://purl.oclc.org/ooxml/officeDocument/relationships',
]);

/** One cell that the sheet's XML has a `<c>` for. */
export interface CellModel {
  /** `C6`. */
  ref: string;
  row: number;
  col: number;
  /**
   * What the cell shows, as text: a shared or inline string (rich text runs joined), a formula's cached result, a
   * number as written in the file (`2.5`, a date's serial), `TRUE`/`FALSE`, or an error (`#N/A`). `''` when empty.
   */
  text: string;
  /** The formula, when the cell has one (`''` for a cell that shares the formula of another). */
  formula?: string;
  /** The index of the cell's format in `cellXfs` (its `s`), 0 when it has none. */
  styleId: number;
  /** The format draws a border on at least one side of the cell. */
  bordered: boolean;
  /** The number format's code (custom, or the built-in one's), or `undefined` for General. */
  numFmt?: string;
  /** The number format's id: 14 to 22 are Excel's built-in dates and times, 164 and up are the file's own. */
  numFmtId: number;
  bold: boolean;
  /** The font size in points, `undefined` when the format does not say. */
  fontSize?: number;
}

export interface SheetModel {
  /** The name on the sheet's tab. */
  name: string;
  /** The sheet's part in the zip, e.g. `xl/worksheets/sheet1.xml`. */
  path: string;
  /** By reference (`C6`). */
  cells: Map<string, CellModel>;
  /** The merged ranges, as written (`E6:F6`). */
  merges: string[];
  /** The print area, one or more ranges joined by `,` (`A1:F131`), or `undefined` when none is set. */
  printArea?: string;
  hiddenRows: Set<number>;
  hiddenCols: Set<number>;
  /** The sheet is hidden (`state` `hidden` or `veryHidden`). */
  hidden: boolean;
  /** The text of the page header and footer, a line for each of its left, centre and right sections, codes removed. */
  headerFooter: string[];
}

export interface Workbook {
  /** The worksheets, in tab order (chart sheets are left out). */
  sheets: SheetModel[];
  /** Dates are counted from 1904 instead of 1900. */
  date1904: boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// XML and relationships

function isSml(node: Node | null): node is Element {
  return node !== null && node.nodeType === 1 && SML.has((node as Element).namespaceURI ?? '');
}

/** The SpreadsheetML child elements of `el`, all or by local name. */
function kids(el: Element, name?: string): Element[] {
  const out: Element[] = [];
  for (let n = el.firstChild; n !== null; n = n.nextSibling) {
    if (isSml(n) && (name === undefined || n.localName === name)) out.push(n);
  }
  return out;
}

function kid(el: Element | undefined, name: string): Element | undefined {
  if (!el) return undefined;
  for (let n = el.firstChild; n !== null; n = n.nextSibling) if (isSml(n) && n.localName === name) return n;
  return undefined;
}

/** The text of the `t` elements of a string item: its own `t`, or the `t` of each rich text run (`r`). Not `rPh`. */
function stringItemText(si: Element): string {
  let text = '';
  for (let n = si.firstChild; n !== null; n = n.nextSibling) {
    if (!isSml(n)) continue;
    if (n.localName === 't') text += n.textContent ?? '';
    else if (n.localName === 'r') text += kid(n, 't')?.textContent ?? '';
  }
  return decodeEscapes(text);
}

/** Excel writes a character XML cannot hold as `_xHHHH_` (`_x000D_`), and a literal `_x` as `_x005F_x`. */
function decodeEscapes(s: string): string {
  return s.includes('_x') ? s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))) : s;
}

function isTrue(value: string | null): boolean {
  return value === '1' || value === 'true';
}

export interface Rel { id: string; type: string; target: string }

/** `a/b/../c` → `a/c`. */
function normalisePath(path: string): string {
  const out: string[] = [];
  for (const piece of path.split('/')) {
    if (piece === '..') out.pop();
    else if (piece !== '.' && piece !== '') out.push(piece);
  }
  return out.join('/');
}

/**
 * The relationships of a part (from `<dir>/_rels/<name>.rels`), with each target as a part path in the zip. External
 * targets (links, files elsewhere) are left out.
 */
export function relsOf(pkg: Package, part: string): Rel[] {
  const slash = part.lastIndexOf('/');
  const dir = slash < 0 ? '' : part.slice(0, slash);
  const text = partText(pkg, `${dir === '' ? '' : `${dir}/`}_rels/${part.slice(slash + 1)}.rels`);
  if (text === undefined) return [];
  const out: Rel[] = [];
  for (const el of Array.from(parseXml(text).documentElement.childNodes)) {
    if (el.nodeType !== 1 || (el as Element).localName !== 'Relationship') continue;
    const r = el as Element;
    if ((r.getAttribute('TargetMode') ?? '').toLowerCase() === 'external') continue;
    const target = (r.getAttribute('Target') ?? '').replace(/\\/g, '/');
    out.push({
      id: r.getAttribute('Id') ?? '',
      type: r.getAttribute('Type') ?? '',
      target: normalisePath(target.startsWith('/') ? target : `${dir}/${target}`),
    });
  }
  return out;
}

/** The first relationship whose type ends with `/<kind>` (`worksheet`, `styles`), in either namespace. */
function relOfType(rels: Rel[], kind: string): Rel | undefined {
  return rels.find((r) => r.type.endsWith(`/${kind}`));
}

/** The `r:id` of an element, in either relationships namespace. */
function relId(el: Element): string | undefined {
  for (const attr of Array.from(el.attributes)) {
    if (attr.localName === 'id' && OFFICE_RELS.has(attr.namespaceURI ?? '')) return attr.value;
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Styles and shared strings

interface Format { numFmtId: number; numFmt?: string; bordered: boolean; bold: boolean; fontSize?: number }

const PLAIN: Format = { numFmtId: 0, bordered: false, bold: false };

function readStyles(text: string | undefined): Format[] {
  if (text === undefined) return [PLAIN];
  const root = parseXml(text).documentElement;
  const codes = new Map<number, string>();
  for (const f of kids(kid(root, 'numFmts') ?? root, 'numFmt')) codes.set(Number(f.getAttribute('numFmtId')), f.getAttribute('formatCode') ?? '');
  const fonts = kids(kid(root, 'fonts') ?? root, 'font').map((font) => {
    const b = kid(font, 'b');
    const sz = Number(kid(font, 'sz')?.getAttribute('val'));
    return { bold: b !== undefined && (b.getAttribute('val') === null || isTrue(b.getAttribute('val'))), size: Number.isFinite(sz) && sz > 0 ? sz : undefined };
  });
  const borders = kids(kid(root, 'borders') ?? root, 'border').map((border) => kids(border).some((side) => (
    ['left', 'right', 'top', 'bottom', 'start', 'end'].includes(side.localName) && !['', 'none'].includes(side.getAttribute('style') ?? '')
  )));
  const xfs = kids(kid(root, 'cellXfs') ?? root, 'xf').map((xf): Format => {
    const numFmtId = Number(xf.getAttribute('numFmtId') ?? 0) || 0;
    const font = fonts[Number(xf.getAttribute('fontId') ?? 0)];
    const format: Format = { numFmtId, bordered: borders[Number(xf.getAttribute('borderId') ?? 0)] ?? false, bold: font?.bold ?? false };
    const code = codes.get(numFmtId) ?? (numFmtId === 0 ? undefined : builtInFormat(numFmtId));
    if (code !== undefined && numFmtId !== 0) format.numFmt = code;
    if (font?.size !== undefined) format.fontSize = font.size;
    return format;
  });
  return xfs.length > 0 ? xfs : [PLAIN];
}

function readSharedStrings(text: string | undefined): string[] {
  if (text === undefined) return [];
  return kids(parseXml(text).documentElement, 'si').map(stringItemText);
}

// ---------------------------------------------------------------------------------------------------------------
// Print area and page header

/** Splits on `,` outside single quotes. */
function splitOutsideQuotes(text: string, separator: string): string[] {
  const parts: string[] = [];
  let quoted = false;
  let current = '';
  for (const ch of text) {
    if (ch === '\'') quoted = !quoted;
    if (ch === separator && !quoted) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

/**
 * The ranges of a `_xlnm.Print_Area` that are on the sheet `sheetName`, as `A1:F131` (joined by `,` when there are
 * several), or `undefined` when none is. The sheet name may be quoted (`'Demo inventory'!$A$1:$F$131`, with `''` for a
 * quote in it); whole columns (`$A:$C`) and whole rows (`$1:$2`) become ranges to the sheet's edge; a range that is no
 * longer valid (`#REF!`) is passed over.
 */
export function parsePrintArea(text: string, sheetName: string): string | undefined {
  const ranges: string[] = [];
  for (const raw of splitOutsideQuotes(text.trim(), ',')) {
    const part = raw.trim();
    const bang = part.lastIndexOf('!');
    if (bang >= 0) {
      let sheet = part.slice(0, bang).trim();
      if (sheet.startsWith('\'') && sheet.endsWith('\'') && sheet.length >= 2) sheet = sheet.slice(1, -1).replace(/''/g, '\'');
      if (sheet.toLowerCase() !== sheetName.toLowerCase()) continue;
    }
    const range = part.slice(bang + 1).replace(/\$/g, '').toUpperCase();
    const columns = /^([A-Z]{1,3}):([A-Z]{1,3})$/.exec(range);
    const rows = /^(\d+):(\d+)$/.exec(range);
    const full = columns ? `${columns[1]}1:${columns[2]}${MAX_ROW}` : rows ? `A${rows[1]}:${columnLetters(MAX_COL)}${rows[2]}` : range;
    if (parseRange(full)) ranges.push(full);
  }
  return ranges.length > 0 ? ranges.join(',') : undefined;
}

/**
 * The text of a page header or footer (`&L&"Arial,Bold"&8Form: X&RPage &P`) as lines: one for each section (`&L`,
 * `&C`, `&R`) and line break, with the font, size, colour and field codes (`&P`, `&D`, `&F`, picture `&G`) removed.
 */
function headerFooterLines(text: string): string[] {
  const lines: string[] = [];
  let current = '';
  const push = (): void => {
    const line = current.replace(/\s+/g, ' ').trim();
    if (line !== '') lines.push(line);
    current = '';
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch === '\n' || ch === '\r') {
      push();
      continue;
    }
    if (ch !== '&') {
      current += ch;
      continue;
    }
    const next = text[i + 1];
    if (next === undefined) break;
    if (next === '&') {
      current += '&';
      i += 1;
    } else if (next === '"') {
      const end = text.indexOf('"', i + 2);
      i = end < 0 ? text.length : end;
    } else if (/\d/.test(next)) {
      while (/\d/.test(text[i + 1] ?? '')) i += 1;
    } else if (next === 'K') {
      i += 7; // a colour: six hex digits, or a theme colour and tint (`01+050`)
    } else {
      if ('LCR'.includes(next.toUpperCase())) push();
      i += 1;
    }
  }
  push();
  return lines;
}

// ---------------------------------------------------------------------------------------------------------------
// Sheets

function readSheet(text: string, o: { name: string; path: string; hidden: boolean; printArea?: string; formats: Format[]; strings: string[] }): SheetModel {
  const root = parseXml(text).documentElement;
  const cells = new Map<string, CellModel>();
  const hiddenRows = new Set<number>();
  const hiddenCols = new Set<number>();

  for (const col of kids(kid(root, 'cols') ?? root, 'col')) {
    if (!isTrue(col.getAttribute('hidden')) && col.getAttribute('width') !== '0') continue;
    const min = Number(col.getAttribute('min'));
    const max = Math.min(Number(col.getAttribute('max')), MAX_COL);
    for (let c = min; Number.isInteger(c) && c >= 1 && c <= max; c += 1) hiddenCols.add(c);
  }

  let rowNumber = 0;
  for (const rowEl of kids(kid(root, 'sheetData') ?? root, 'row')) {
    rowNumber = Number(rowEl.getAttribute('r') ?? rowNumber + 1) || rowNumber + 1;
    if (isTrue(rowEl.getAttribute('hidden')) || (isTrue(rowEl.getAttribute('customHeight')) && Number(rowEl.getAttribute('ht')) === 0)) hiddenRows.add(rowNumber);
    let colNumber = 0;
    for (let n = rowEl.firstChild; n !== null; n = n.nextSibling) {
      if (!isSml(n) || n.localName !== 'c') continue;
      const at = parseRef(n.getAttribute('r') ?? '');
      colNumber = at ? at.col : colNumber + 1;
      const row = at ? at.row : rowNumber;
      const styleId = Number(n.getAttribute('s') ?? 0) || 0;
      const format = o.formats[styleId] ?? o.formats[0] ?? PLAIN;
      let v: string | undefined;
      let inline: Element | undefined;
      let formula: string | undefined;
      for (let k = n.firstChild; k !== null; k = k.nextSibling) {
        if (!isSml(k)) continue;
        if (k.localName === 'v') v = k.textContent ?? '';
        else if (k.localName === 'f') formula = k.textContent ?? '';
        else if (k.localName === 'is') inline = k;
      }
      const type = n.getAttribute('t');
      const text = type === 's' ? o.strings[Number(v)] ?? ''
        : type === 'inlineStr' ? (inline ? stringItemText(inline) : '')
          : type === 'b' ? (v === undefined ? '' : isTrue(v) ? 'TRUE' : 'FALSE')
            : type === 'str' ? decodeEscapes(v ?? '') : v ?? '';
      const ref = refOf(colNumber, row);
      const cell: CellModel = { ref, row, col: colNumber, text, styleId, bordered: format.bordered, numFmtId: format.numFmtId, bold: format.bold };
      if (formula !== undefined) cell.formula = formula;
      if (format.numFmt !== undefined) cell.numFmt = format.numFmt;
      if (format.fontSize !== undefined) cell.fontSize = format.fontSize;
      cells.set(ref, cell);
    }
  }

  const merges = kids(kid(root, 'mergeCells') ?? root, 'mergeCell').map((m) => m.getAttribute('ref') ?? '').filter((ref) => parseRange(ref) !== undefined);
  const hf = kid(root, 'headerFooter');
  const headerFooter = hf ? kids(hf).flatMap((part) => headerFooterLines(part.textContent ?? '')) : [];

  const sheet: SheetModel = { name: o.name, path: o.path, cells, merges, hiddenRows, hiddenCols, hidden: o.hidden, headerFooter };
  if (o.printArea !== undefined) sheet.printArea = o.printArea;
  return sheet;
}

/** The workbook part: the `officeDocument` relationship of the package, else Excel's usual path. */
function workbookPath(pkg: Package): string {
  return relOfType(relsOf(pkg, ''), 'officeDocument')?.target ?? 'xl/workbook.xml';
}

/**
 * Reads a workbook's sheets (Task 7). Throws `NotAFormError` when the package has no workbook part, and
 * `DamagedFormError` when a part it reads is not well-formed XML.
 */
export function loadWorkbook(pkg: Package): Workbook {
  const path = workbookPath(pkg);
  const text = partText(pkg, path);
  if (text === undefined) throw new NotAFormError();
  const root = parseXml(text).documentElement;
  const rels = relsOf(pkg, path);
  const formats = readStyles(partText(pkg, relOfType(rels, 'styles')?.target ?? ''));
  const strings = readSharedStrings(partText(pkg, relOfType(rels, 'sharedStrings')?.target ?? ''));

  const printAreas = new Map<number, string>();
  for (const name of kids(kid(root, 'definedNames') ?? root, 'definedName')) {
    if ((name.getAttribute('name') ?? '').toLowerCase() !== '_xlnm.print_area') continue;
    const local = name.getAttribute('localSheetId');
    if (local !== null) printAreas.set(Number(local), name.textContent ?? '');
  }

  const sheets: SheetModel[] = [];
  kids(kid(root, 'sheets') ?? root, 'sheet').forEach((el, index) => {
    const id = relId(el);
    const rel = rels.find((r) => r.id === id);
    if (!rel || !rel.type.endsWith('/worksheet')) return; // a chart sheet, or a sheet whose part is missing
    const sheetText = partText(pkg, rel.target);
    if (sheetText === undefined) return;
    const name = el.getAttribute('name') ?? '';
    const state = el.getAttribute('state') ?? 'visible';
    const area = printAreas.get(index);
    const printArea = area === undefined ? undefined : parsePrintArea(area, name);
    sheets.push(readSheet(sheetText, { name, path: rel.target, hidden: state !== 'visible', ...(printArea === undefined ? {} : { printArea }), formats, strings }));
  });

  return { sheets, date1904: isTrue(kid(root, 'workbookPr')?.getAttribute('date1904') ?? null) };
}

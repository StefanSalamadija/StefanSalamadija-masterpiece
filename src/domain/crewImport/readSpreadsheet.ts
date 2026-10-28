import * as XLSX from 'xlsx';
import { parseCsv } from './csv';

export type Cell = string | number | boolean | Date | null;
export interface SheetGrid { name: string; rows: Cell[][] }

/** Base class of every error `readSpreadsheet` throws on purpose: its message is written to be shown to the user as is. */
export class SpreadsheetError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SpreadsheetError';
  }
}

export class UnsupportedFileError extends SpreadsheetError {
  constructor() {
    super("This file type isn't supported. Use an Excel file (.xlsx or .xls) or a CSV file.");
    this.name = 'UnsupportedFileError';
  }
}

export class UnreadableFileError extends SpreadsheetError {
  constructor(options?: ErrorOptions) {
    super("This file can't be read. If it's password-protected in Excel, remove the password, save it again and retry.", options);
    this.name = 'UnreadableFileError';
  }
}

/** The text of a CSV or HTML/XML file is not in an encoding that can be read without guessing. */
export class EncodingError extends SpreadsheetError {
  constructor(message: string) {
    super(message);
    this.name = 'EncodingError';
  }
}

export class TooLargeFileError extends SpreadsheetError {
  constructor() {
    super('This sheet is too large to import (more than 5,000 rows or 200 columns of data). Copy the crew list into a new workbook and import that.');
    this.name = 'TooLargeFileError';
  }
}

const CSV_ENCODING_MESSAGE = "This CSV file isn't saved as UTF-8, so letters like Š, Ć or Đ would be garbled. In Excel choose File → Save As → CSV UTF-8 (Comma delimited), or import the .xlsx file instead.";
const MARKUP_ENCODING_MESSAGE = "This file's text encoding can't be read reliably. Open it in Excel, save it as an Excel Workbook (.xlsx), then import that file.";

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const UTF8_BOM = [0xef, 0xbb, 0xbf];
const WHITESPACE = [0x20, 0x09, 0x0a, 0x0d];
const LESS_THAN = 0x3c;
const CHARSET_SCAN_BYTES = 8192;
const MAX_SHEET_ROWS = 5000;
const MAX_SHEET_COLUMNS = 200;
const MS_PER_DAY = 86_400_000;
const EXCEL_EPOCH_1900_UTC = Date.UTC(1899, 11, 30);
const EXCEL_EPOCH_1904_UTC = Date.UTC(1904, 0, 1);

/** Throws `TooLargeFileError` for more than 5,000 rows or 200 columns of data, whatever the kind of file. */
function checkSize(rowCount: number, columnCount: number): void {
  if (rowCount > MAX_SHEET_ROWS || columnCount > MAX_SHEET_COLUMNS) throw new TooLargeFileError();
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, i) => bytes[i] === byte);
}

/** Index of the `<` that opens an HTML or XML "Excel" export (older systems save these as .xls), or -1 if the file is not one. */
function markupStart(bytes: Uint8Array): number {
  let i = startsWith(bytes, UTF8_BOM) ? UTF8_BOM.length : 0;
  while (i < bytes.length && WHITESPACE.includes(bytes[i])) i++;
  return bytes[i] === LESS_THAN ? i : -1;
}

/** Decodes bytes strictly, so malformed input is reported instead of turning into replacement characters. */
function decodeStrict(label: string, bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder(label, { fatal: true }).decode(bytes);
  } catch {
    return undefined; // malformed input, or a charset label this browser does not know
  }
}

/** The charset named by a `<meta ... charset=...>` tag or an `<?xml ... encoding="..."?>` declaration near the top of the file. */
function declaredCharset(bytes: Uint8Array): string | undefined {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, CHARSET_SCAN_BYTES));
  const meta = /<meta[^>]*?charset\s*=\s*["']?\s*([\w:.-]+)/i.exec(head);
  const xml = /^<\?xml[^>]*?\sencoding\s*=\s*["']([\w:.-]+)["']/i.exec(head);
  return (meta ?? xml)?.[1];
}

/** UTF-8 if the bytes are valid UTF-8, otherwise the declared charset. A code page is never guessed. */
function decodeMarkup(bytes: Uint8Array): string {
  const utf8 = decodeStrict('utf-8', bytes);
  if (utf8 !== undefined) return utf8;
  const charset = declaredCharset(bytes);
  const declared = charset === undefined ? undefined : decodeStrict(charset, bytes);
  if (declared === undefined) throw new EncodingError(MARKUP_ENCODING_MESSAGE);
  return declared;
}

function toCell(cell: XLSX.CellObject | undefined, epochUtc: number): Cell {
  if (!cell) return null;
  switch (cell.t) {
    case 's': return typeof cell.v === 'string' ? cell.v : null;
    case 'b': return typeof cell.v === 'boolean' ? cell.v : null;
    case 'd': return cell.v instanceof Date ? cell.v : null;
    case 'n':
      if (typeof cell.v !== 'number') return null;
      // Date-formatted serials become UTC midnight; SheetJS's own date conversion depends on the local time zone.
      return cell.z !== undefined && XLSX.SSF.is_date(cell.z) ? new Date(epochUtc + Math.floor(cell.v) * MS_PER_DAY) : cell.v;
    default: return null;
  }
}

/**
 * The sheet as a grid from A1, so `rows[i][j]` is sheet row i+1, column j+1. The grid reaches only as far as the cells
 * that exist (never past the declared range), because files can declare a range as big as the whole sheet.
 * Throws `TooLargeFileError` for more than 5,000 rows or 200 columns of data.
 */
export function sheetToGrid(sheet: XLSX.WorkSheet, date1904 = false): Cell[][] {
  const ref = sheet['!ref'];
  if (!ref) return [];
  let lastRow = -1;
  let lastColumn = -1;
  for (const address of Object.keys(sheet)) {
    if (address.startsWith('!')) continue;
    const { r, c } = XLSX.utils.decode_cell(address);
    if (r > lastRow) lastRow = r;
    if (c > lastColumn) lastColumn = c;
  }
  const declared = XLSX.utils.decode_range(ref).e;
  const rowCount = Math.min(lastRow, declared.r) + 1;
  const columnCount = Math.min(lastColumn, declared.c) + 1;
  checkSize(rowCount, columnCount);

  const epochUtc = date1904 ? EXCEL_EPOCH_1904_UTC : EXCEL_EPOCH_1900_UTC;
  const rows: Cell[][] = [];
  for (let r = 0; r < rowCount; r++) {
    const row: Cell[] = [];
    for (let c = 0; c < columnCount; c++) row.push(toCell(sheet[XLSX.utils.encode_cell({ r, c })], epochUtc));
    rows.push(row);
  }
  return rows;
}

/**
 * SheetJS parses almost any text as CSV and would never reject a non-workbook, so the container is checked first:
 * ZIP (.xlsx) or CFB (.xls, and password-protected .xlsx, which SheetJS then refuses). A .xls may also be HTML or XML.
 * That text is decoded here, because SheetJS would otherwise guess a code page, and it is trimmed to its first `<`,
 * because SheetJS reads it as HTML only when it sees that character first (not after a BOM and whitespace).
 */
function parseWorkbook(bytes: Uint8Array, extension: 'xlsx' | 'xls'): XLSX.WorkBook {
  const options = { cellNF: true, cellDates: false };
  if (startsWith(bytes, ZIP_SIGNATURE) || startsWith(bytes, CFB_SIGNATURE)) return XLSX.read(bytes, { type: 'array', ...options });
  const start = extension === 'xls' ? markupStart(bytes) : -1;
  if (start === -1) throw new UnreadableFileError();
  return XLSX.read(decodeMarkup(bytes.subarray(start)), { type: 'string', ...options });
}

function readWorkbook(data: ArrayBuffer, extension: 'xlsx' | 'xls'): SheetGrid[] {
  try {
    const workbook = parseWorkbook(new Uint8Array(data), extension);
    // Markup with no table in it "parses" to a workbook without sheets; a real workbook always has one.
    if (workbook.SheetNames.length === 0) throw new UnreadableFileError();
    const date1904 = Boolean(workbook.Workbook?.WBProps?.date1904);
    return workbook.SheetNames.map(name => ({ name, rows: sheetToGrid(workbook.Sheets[name], date1904) }));
  } catch (error) {
    if (error instanceof SpreadsheetError) throw error;
    throw new UnreadableFileError({ cause: error });
  }
}

function readCsv(name: string, data: ArrayBuffer): SheetGrid[] {
  const text = decodeStrict('utf-8', new Uint8Array(data));
  if (text === undefined) throw new EncodingError(CSV_ENCODING_MESSAGE);
  const rows = parseCsv(text);
  checkSize(rows.length, rows.reduce((widest, row) => Math.max(widest, row.length), 0)); // not `Math.max(...)`: a huge file would overflow the stack
  return [{ name, rows }];
}

/** Reads an Excel (.xlsx, .xls) or CSV file into one plain grid of cells per sheet. A sheet of more than 5,000 rows or 200 columns is refused. */
export async function readSpreadsheet(fileName: string, data: ArrayBuffer): Promise<SheetGrid[]> {
  const dot = fileName.lastIndexOf('.');
  const extension = dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase();
  if (extension === 'xlsx' || extension === 'xls') return readWorkbook(data, extension);
  if (extension === 'csv') return readCsv(fileName.slice(0, dot), data);
  throw new UnsupportedFileError();
}

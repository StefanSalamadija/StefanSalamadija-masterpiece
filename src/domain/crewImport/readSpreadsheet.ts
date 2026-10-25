import * as XLSX from 'xlsx';
import { parseCsv } from './csv';

export type Cell = string | number | boolean | Date | null;
export interface SheetGrid { name: string; rows: Cell[][] }

export class UnsupportedFileError extends Error {
  constructor() {
    super("This file type isn't supported. Use an Excel file (.xlsx or .xls) or a CSV file.");
    this.name = 'UnsupportedFileError';
  }
}

export class UnreadableFileError extends Error {
  constructor(options?: ErrorOptions) {
    super("This file can't be read. If it's password-protected in Excel, remove the password, save it again and retry.", options);
    this.name = 'UnreadableFileError';
  }
}

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const UTF8_BOM = [0xef, 0xbb, 0xbf];
const WHITESPACE = [0x20, 0x09, 0x0a, 0x0d];
const LESS_THAN = 0x3c;
const MS_PER_DAY = 86_400_000;
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((byte, i) => bytes[offset + i] === byte);
}

/** Index of the `<` that opens an HTML or XML "Excel" export (older systems save these as .xls), or -1 if the file is not one. */
function markupStart(bytes: Uint8Array): number {
  let i = startsWith(bytes, UTF8_BOM) ? UTF8_BOM.length : 0;
  while (i < bytes.length && WHITESPACE.includes(bytes[i])) i++;
  return bytes[i] === LESS_THAN ? i : -1;
}

/**
 * The bytes to hand to SheetJS, or undefined when the file is not a workbook. SheetJS parses almost any text as CSV
 * and would never reject a non-workbook, so the container is checked first. A password-protected .xlsx is a CFB
 * container, which SheetJS then refuses. Markup is trimmed to its first `<`, because SheetJS reads HTML only when it
 * sees that character first, and not after a BOM followed by whitespace.
 */
function workbookBytes(bytes: Uint8Array, extension: 'xlsx' | 'xls'): Uint8Array | undefined {
  if (startsWith(bytes, ZIP_SIGNATURE) || startsWith(bytes, CFB_SIGNATURE)) return bytes;
  if (extension !== 'xls') return undefined;
  const start = markupStart(bytes);
  return start === -1 ? undefined : bytes.slice(start);
}

function toCell(cell: XLSX.CellObject | undefined): Cell {
  if (!cell) return null;
  switch (cell.t) {
    case 's': return typeof cell.v === 'string' ? cell.v : null;
    case 'b': return typeof cell.v === 'boolean' ? cell.v : null;
    case 'd': return cell.v instanceof Date ? cell.v : null;
    case 'n':
      if (typeof cell.v !== 'number') return null;
      // Date-formatted serials become UTC midnight; SheetJS's own date conversion depends on the local time zone.
      return cell.z !== undefined && XLSX.SSF.is_date(cell.z) ? new Date(EXCEL_EPOCH_UTC + Math.floor(cell.v) * MS_PER_DAY) : cell.v;
    default: return null;
  }
}

/** The sheet as a grid from A1 to the end of its range, so `rows[i][j]` is sheet row i+1, column j+1. */
function sheetToGrid(sheet: XLSX.WorkSheet): Cell[][] {
  if (!sheet['!ref']) return [];
  const { e } = XLSX.utils.decode_range(sheet['!ref']);
  const rows: Cell[][] = [];
  for (let r = 0; r <= e.r; r++) {
    const row: Cell[] = [];
    for (let c = 0; c <= e.c; c++) row.push(toCell(sheet[XLSX.utils.encode_cell({ r, c })]));
    rows.push(row);
  }
  return rows;
}

function readWorkbook(data: ArrayBuffer, extension: 'xlsx' | 'xls'): SheetGrid[] {
  const bytes = workbookBytes(new Uint8Array(data), extension);
  if (!bytes) throw new UnreadableFileError();
  try {
    const workbook = XLSX.read(bytes, { type: 'array', cellNF: true, cellDates: false });
    // Markup with no table in it "parses" to a workbook without sheets; a real workbook always has one.
    if (workbook.SheetNames.length === 0) throw new Error('The workbook has no sheets');
    return workbook.SheetNames.map(name => ({ name, rows: sheetToGrid(workbook.Sheets[name]) }));
  } catch (error) {
    throw new UnreadableFileError({ cause: error });
  }
}

/** Reads an Excel (.xlsx, .xls) or CSV file into one plain grid of cells per sheet. */
export async function readSpreadsheet(fileName: string, data: ArrayBuffer): Promise<SheetGrid[]> {
  const dot = fileName.lastIndexOf('.');
  const extension = dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase();
  if (extension === 'xlsx' || extension === 'xls') return readWorkbook(data, extension);
  if (extension === 'csv') return [{ name: fileName.slice(0, dot), rows: parseCsv(new TextDecoder('utf-8').decode(data)) }];
  throw new UnsupportedFileError();
}

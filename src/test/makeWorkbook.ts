import * as XLSX from 'xlsx';

export interface WorkbookSheet { name: string; rows: (string | number | null)[][] }
/** A numeric cell written with a date number format, so the fixture reads as the same date in every time zone. */
export interface DateCell { sheet: number; addr: string; serial: number }

/** Builds an in-memory .xlsx or .xls (BIFF8) workbook for tests. */
export function makeWorkbook(sheets: WorkbookSheet[], bookType: 'xlsx' | 'biff8', dateCells: DateCell[] = []): ArrayBuffer {
  const book = XLSX.utils.book_new();
  for (const { name, rows } of sheets) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  for (const { sheet, addr, serial } of dateCells) {
    const ws = book.Sheets[book.SheetNames[sheet]];
    ws[addr] = { t: 'n', v: serial, z: 'dd.mm.yyyy' };
    const { r, c } = XLSX.utils.decode_cell(addr);
    const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
    range.e.r = Math.max(range.e.r, r);
    range.e.c = Math.max(range.e.c, c);
    ws['!ref'] = XLSX.utils.encode_range(range);
  }
  return XLSX.write(book, { type: 'array', bookType });
}

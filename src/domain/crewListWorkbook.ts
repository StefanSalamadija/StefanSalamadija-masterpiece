import * as XLSX from 'xlsx';
import { asText } from './crewList';
import type { CrewListTable } from './crewList';
import { formatDisplayDate } from './dates';
import type { ShipProfile } from './types';

const SHEET_NAME = 'Crew list';
/** Widest a column is made, in characters, so one long text cannot push the others off the page. */
const MAX_COLUMN_WIDTH = 40;

/**
 * The rows of the sheet: the title and the ship's details above the table, a blank row, then the table. Every value goes
 * through `asText`, because a record or a ship from a damaged file may lack a field or hold a number in it.
 */
function sheetRows(input: { ship: ShipProfile; port: string; date: string; table: CrewListTable }): string[][] {
  const { ship, port, date, table } = input;
  const { name, imo, callSign, flag } = ship.particulars;
  const rows: unknown[][] = [
    ['CREW LIST'],
    ['Vessel', name, 'IMO', imo],
    ['Call sign', callSign, 'Flag', flag],
    ['Port', port, 'Date', formatDisplayDate(asText(date))],
    [],
    table.headers,
    ...table.rows,
  ];
  return rows.map((row) => row.map(asText));
}

/**
 * The sheet from rows of text. Every cell that has text is a string cell, written by hand and never inferred: the text of a
 * crew list is typed by people and read from files, and a name such as `=HYPERLINK(...)` must stay a name, never a formula.
 * A cell with no text is left out. They are written as shared strings (`bookSST`): without it SheetJS writes them as `t="str"`, the
 * type of the result of a formula.
 */
function worksheetOf(rows: string[][]): XLSX.WorkSheet {
  const sheet: XLSX.WorkSheet = {};
  const widths: number[] = [];
  let columnCount = 0;
  rows.forEach((row, r) => {
    row.forEach((text, c) => {
      if (text === '') return;
      sheet[XLSX.utils.encode_cell({ r, c })] = { t: 's', v: text };
      columnCount = Math.max(columnCount, c + 1);
      widths[c] = Math.max(widths[c] ?? 0, text.length);
    });
  });
  sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length - 1, 0), c: Math.max(columnCount - 1, 0) } });
  sheet['!cols'] = Array.from({ length: columnCount }, (_, c) => ({ wch: Math.min((widths[c] ?? 0) + 2, MAX_COLUMN_WIDTH) }));
  return sheet;
}

/**
 * The crew list as an Excel workbook (.xlsx): one sheet, `Crew list`, with the title, the vessel, call sign, flag, port and
 * date above the table (dates as `DD-MMM-YYYY`). The table is the printed one. Every cell is text, never a formula.
 */
export function crewListWorkbook(input: { ship: ShipProfile; port: string; date: string; table: CrewListTable }): ArrayBuffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, worksheetOf(sheetRows(input)), SHEET_NAME);
  return XLSX.write(book, { type: 'array', bookType: 'xlsx', compression: true, bookSST: true });
}

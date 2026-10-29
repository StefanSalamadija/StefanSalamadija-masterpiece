/*
 * Cell references (`C6`, `AA12`) and the address of a cell in a package (rulings R1).
 *
 * A field's `loc` is `<sheet part path>!<A1>`, for example `xl/worksheets/sheet1.xml!C6`: the worksheet's part in the
 * zip, then the cell. A part path never holds a `!`, so the address splits at its last one. The column of a row group
 * is only its letters (`C`); the row comes from the group's `firstRow`.
 */

/** The largest column (`XFD`) and row Excel has. */
export const MAX_COL = 16384;
export const MAX_ROW = 1048576;

/** `1` → `A`, `27` → `AA`. */
export function columnLetters(col: number): string {
  let name = '';
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** `A` → `1`, `AA` → `27` (upper case letters). */
export function columnNumber(letters: string): number {
  let n = 0;
  for (let i = 0; i < letters.length; i += 1) n = n * 26 + letters.charCodeAt(i) - 64;
  return n;
}

const REF = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/;

/** `C6` (or `$C$6`, or `c6`) → `{ row: 6, col: 3 }`, or `undefined` when it is not a cell reference in the sheet. */
export function parseRef(ref: string): { row: number; col: number } | undefined {
  const match = REF.exec(ref.trim());
  if (!match) return undefined;
  const col = columnNumber(match[1]!.toUpperCase());
  const row = Number(match[2]);
  return col >= 1 && col <= MAX_COL && row >= 1 && row <= MAX_ROW ? { row, col } : undefined;
}

/** `C6`. */
export function refOf(col: number, row: number): string {
  return `${columnLetters(col)}${row}`;
}

/** A rectangle of cells, both ends included. */
export interface Rect { r1: number; c1: number; r2: number; c2: number }

/** `B2:D3` (or one cell, `B2`) → its rectangle, or `undefined`. */
export function parseRange(range: string): Rect | undefined {
  const [from, to, extra] = range.split(':');
  if (extra !== undefined || from === undefined) return undefined;
  const a = parseRef(from);
  const b = to === undefined ? a : parseRef(to);
  if (!a || !b) return undefined;
  return { r1: Math.min(a.row, b.row), c1: Math.min(a.col, b.col), r2: Math.max(a.row, b.row), c2: Math.max(a.col, b.col) };
}

/** The `loc` of a cell: `<part>!<A1>`. */
export function cellLoc(part: string, col: number, row: number): string {
  return `${part}!${refOf(col, row)}`;
}

/** The part and cell of a `loc` made by `cellLoc`, or `undefined` when it is not one. */
export function parseCellLoc(loc: string): { part: string; ref: string; row: number; col: number } | undefined {
  const at = loc.lastIndexOf('!');
  if (at <= 0) return undefined;
  const ref = loc.slice(at + 1);
  const cell = parseRef(ref);
  return cell && /^[A-Z]+\d+$/.test(ref) ? { part: loc.slice(0, at), ref, ...cell } : undefined;
}

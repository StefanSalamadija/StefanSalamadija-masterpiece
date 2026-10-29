import type { CellModel, SheetModel } from './workbook';
import { parseRange } from './refs';
import type { Rect } from './refs';

/*
 * One sheet as detection sees it: what each position shows once merges, hidden rows and columns and the print area are
 * taken into account. A merged range acts as its top-left cell (its origin): every position inside it answers with the
 * origin. Lookups go through maps keyed by row (and a numeric key for a cell), so that a large sheet is never rescanned
 * cell by cell.
 */

/** A number for a cell that is unique in a sheet: columns go up to 16,384. */
const KEY = 16_385;

/** The cell that shows at a position: the origin of the merge over it, or the cell itself. */
export interface Origin {
  row: number;
  col: number;
  /** The last row and column the origin covers (its own row and column when it is not merged). */
  r2: number;
  c2: number;
  key: number;
  /** `undefined` when the file has no `<c>` for it. */
  cell: CellModel | undefined;
}

export class Grid {
  /** The last row worth looking at: of a cell, or of the print area when it ends sooner. */
  readonly maxRow: number;
  private readonly cells = new Map<number, CellModel>();
  /** Each row's cells that are not covered by a merge, by column. */
  private readonly byRow = new Map<number, CellModel[]>();
  /** The merges that cover each row. */
  private readonly mergesByRow = new Map<number, Rect[]>();
  private readonly area: Rect[] | undefined;

  constructor(readonly sheet: SheetModel) {
    this.area = sheet.printArea?.split(',').map((range) => parseRange(range)).filter((r): r is Rect => r !== undefined);
    if (this.area?.length === 0) this.area = undefined;
    let last = 0;
    for (const cell of sheet.cells.values()) {
      this.cells.set(cell.row * KEY + cell.col, cell);
      last = Math.max(last, cell.row);
    }
    const areaEnd = this.area ? Math.max(...this.area.map((r) => r.r2)) : Infinity;
    this.maxRow = Math.min(last, areaEnd);
    for (const ref of sheet.merges) {
      const rect = parseRange(ref)!;
      for (let row = rect.r1; row <= Math.min(rect.r2, this.maxRow + 1); row += 1) {
        const list = this.mergesByRow.get(row);
        if (list) list.push(rect);
        else this.mergesByRow.set(row, [rect]);
      }
    }
    for (const cell of this.cells.values()) {
      const o = this.origin(cell.row, cell.col);
      if (o.row !== cell.row || o.col !== cell.col) continue;
      const list = this.byRow.get(cell.row);
      if (list) list.push(cell);
      else this.byRow.set(cell.row, [cell]);
    }
    for (const list of this.byRow.values()) list.sort((a, b) => a.col - b.col);
  }

  /** The cell that shows at a position. */
  origin(row: number, col: number): Origin {
    const rect = this.mergesByRow.get(row)?.find((m) => m.c1 <= col && col <= m.c2);
    const r = rect ? rect.r1 : row;
    const c = rect ? rect.c1 : col;
    return { row: r, col: c, r2: rect ? rect.r2 : row, c2: rect ? rect.c2 : col, key: r * KEY + c, cell: this.cells.get(r * KEY + c) };
  }

  /** The cells of a row that are not covered by a merge and are shown, by column. */
  originsInRow(row: number): Origin[] {
    return (this.byRow.get(row) ?? []).map((cell) => this.origin(cell.row, cell.col)).filter((o) => this.shown(o));
  }

  /** In the print area (when there is one) and not in a hidden row or column. */
  shown(o: { row: number; col: number }): boolean {
    return !this.sheet.hiddenRows.has(o.row) && !this.sheet.hiddenCols.has(o.col) && this.inArea(o.row, o.col, o.col);
  }

  /** Some of the columns `c1` to `c2` of the row are in the print area (always, when there is none). */
  inArea(row: number, c1: number, c2: number): boolean {
    return !this.area || this.area.some((r) => r.r1 <= row && row <= r.r2 && r.c1 <= c2 && c1 <= r.c2);
  }

  hiddenCol(col: number): boolean {
    return this.sheet.hiddenCols.has(col);
  }

  hiddenRow(row: number): boolean {
    return this.sheet.hiddenRows.has(row);
  }

  /** The text the origin shows, on one line. */
  text(o: Origin): string {
    return (o.cell?.text ?? '').replace(/\s+/g, ' ').trim();
  }

  /** No value and no formula: a place to write in. */
  isEmpty(o: Origin): boolean {
    return !o.cell || (o.cell.formula === undefined && o.cell.text.trim() === '');
  }

  isFormula(o: Origin): boolean {
    return o.cell?.formula !== undefined;
  }

  bordered(o: Origin): boolean {
    return o.cell?.bordered ?? false;
  }

  /** The first column after `col` that is not hidden. */
  nextShownCol(col: number): number {
    let c = col + 1;
    while (this.sheet.hiddenCols.has(c)) c += 1;
    return c;
  }
}

/** True when a text has a letter in it. */
export function hasLetters(s: string): boolean {
  return /\p{L}/u.test(s);
}

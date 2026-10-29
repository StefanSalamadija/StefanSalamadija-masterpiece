import { normaliseLabel } from '../labels';
import type { RowGroupDef } from '../types';
import { isIdentityText, isStopLabel, kindOf, labelText } from './fields';
import { hasLetters } from './grid';
import type { Grid, Origin } from './grid';
import type { CellModel } from './workbook';

/*
 * Table blocks (spec §5.2): a header row of at least 3 adjacent bordered text cells, and the rows under it that have
 * bordered cells under its columns. A block is either:
 * - a matrix: the header's corner (the cell left of the titles) is an empty bordered cell and the column under it
 *   names attributes. Each empty cell is a field, `<column title> · <attribute>`;
 * - rows: runs of rows whose empty bordered cells are in the same columns become row groups; the cells that are
 *   already filled in each row name it (`rowLabels`).
 *
 * The block ends at the first row with no bordered cell under its columns, at a row outside the print area, or at a
 * row whose first text asks for a signature or is `Dated`/`Signed`. A hidden row ends a run, not the block.
 */

/** A field found in a block, before it is given its id: its cell and the parts of its label. */
export interface FieldDraft { row: number; col: number; parts: string[]; cell: CellModel | undefined }

/** A row group found in a block, before it is given its id and section. */
export interface GroupDraft {
  firstRow: number;
  capacity: number;
  /** The columns of the group, with the title of each and the cell of the first row (for its format). */
  cols: { col: number; title: string; cell: CellModel | undefined }[];
  rowLabels?: string[];
  fixedRows?: { label: string; cells: string[] }[];
  /** A row inside the table, just above the group, that names it (a category row). */
  caption?: string;
  shape: RowGroupDef['shape'];
}

export interface Tables {
  fields: FieldDraft[];
  groups: GroupDraft[];
  /** The keys of every cell inside a block: they are never labels of other fields. */
  claimed: Set<number>;
}

interface Header {
  row: number;
  cells: Origin[];
  /** The first and last column under the header. */
  c1: number;
  c2: number;
}

interface Block { fields: FieldDraft[]; groups: GroupDraft[]; claimed: number[]; next: number }

/** A cell of a header row: bordered, with letters in it, and no formula. */
function isHeaderCell(grid: Grid, o: Origin): boolean {
  return grid.bordered(o) && !grid.isFormula(o) && hasLetters(grid.text(o));
}

/**
 * The header of a block at `row`: the longest run (the first of runs as long) of at least 3 adjacent header cells. A
 * merged cell counts once, and hidden columns between two cells do not part them. A run holding the form's identity
 * (`Form:`, `Revision:`) is the page header, not a table.
 */
function headerAt(grid: Grid, row: number): Header | undefined {
  if (grid.hiddenRow(row)) return undefined;
  let best: Origin[] = [];
  let run: Origin[] = [];
  for (const o of grid.originsInRow(row)) {
    const last = run[run.length - 1];
    if (!isHeaderCell(grid, o)) {
      run = [];
      continue;
    }
    run = last && o.col === grid.nextShownCol(last.c2) ? [...run, o] : [o];
    if (run.length > best.length) best = run;
  }
  if (best.length < 3 || best.some((o) => isIdentityText(grid.text(o)))) return undefined;
  return { row, cells: best, c1: best[0]!.col, c2: best[best.length - 1]!.c2 };
}

/** The columns from `c1` to `c2` that are not hidden. */
function shownCols(grid: Grid, c1: number, c2: number): number[] {
  const cols: number[] = [];
  for (let c = c1; c <= c2; c += 1) if (!grid.hiddenCol(c)) cols.push(c);
  return cols;
}

/**
 * The title of each column under a header, and the first row of data. Rows covered by the header's own merges belong
 * to the header. When a header cell spans several columns, a sub-header row of texts under it (`PORT`, `STBD` under
 * `Hold 1`) gives the titles `<header> <sub>` (`Hold 1 PORT`).
 */
function titlesOf(grid: Grid, header: Header, cols: number[]): { titles: Map<number, string>; dataStart: number } {
  const headerKeys = new Set(header.cells.map((o) => o.key));
  const underHeader = (row: number, c: number): boolean => headerKeys.has(grid.origin(row, c).key);
  let r = header.row + 1;
  while (r <= grid.maxRow && cols.every((c) => underHeader(r, c))) r += 1;

  let sub: number | undefined;
  if (r <= grid.maxRow && !grid.hiddenRow(r) && header.cells.some((o) => o.c2 > o.col)) {
    const subText = (c: number): boolean => {
      const o = grid.origin(r, c);
      return o.row === r && !grid.isFormula(o) && hasLetters(grid.text(o));
    };
    const fits = cols.every((c) => underHeader(r, c) || subText(c))
      && header.cells.filter((o) => o.c2 > o.col).every((o) => cols.filter((c) => c >= o.col && c <= o.c2).every(subText));
    if (fits) {
      sub = r;
      r += 1;
    }
  }

  const titles = new Map<number, string>();
  for (const c of cols) {
    const top = grid.origin(header.row, c);
    const base = headerKeys.has(top.key) ? labelText(grid.text(top)) : '';
    const below = sub === undefined ? undefined : grid.origin(sub, c);
    const extra = below && below.row === sub && !headerKeys.has(below.key) ? labelText(grid.text(below)) : '';
    titles.set(c, [base, extra].filter((t) => t !== '').join(' '));
  }
  return { titles, dataStart: r };
}

/** The row has a shown, bordered cell under one of the columns. */
function borderedUnder(grid: Grid, row: number, cols: number[]): boolean {
  return cols.some((c) => {
    const o = grid.origin(row, c);
    return grid.shown(o) && grid.bordered(o);
  });
}

/** The row's first text asks for a signature, or is `Dated`/`Signed`. */
function stopsTable(grid: Grid, row: number): boolean {
  const first = grid.originsInRow(row).find((o) => grid.text(o) !== '');
  return first !== undefined && isStopLabel(grid.text(first));
}

/**
 * The rows of a block from `start`: each row that is in it, in order, and the row it ends at (`next`). Hidden rows are
 * passed over and given as `hidden`.
 */
function blockRows(grid: Grid, start: number, cols: number[], c1: number, c2: number): { rows: { row: number; hidden: boolean }[]; next: number } {
  const rows: { row: number; hidden: boolean }[] = [];
  let r = start;
  for (; r <= grid.maxRow; r += 1) {
    if (grid.hiddenRow(r)) {
      rows.push({ row: r, hidden: true });
      continue;
    }
    if (!grid.inArea(r, c1, c2) || !borderedUnder(grid, r, cols) || stopsTable(grid, r)) break;
    rows.push({ row: r, hidden: false });
  }
  return { rows, next: r };
}

/** The cell at `(row, col)` when it is its own origin (not inside another cell's merge), shown, bordered and empty. */
function emptyAt(grid: Grid, row: number, col: number): Origin | undefined {
  const o = grid.origin(row, col);
  return o.row === row && o.col === col && grid.shown(o) && grid.bordered(o) && grid.isEmpty(o) ? o : undefined;
}

/** The distinct texts the cells of `cols` show in a row, merged ones included, joined by a space. */
function namesIn(grid: Grid, row: number, cols: number[]): string {
  const seen = new Set<number>();
  const texts: string[] = [];
  for (const c of cols) {
    const o = grid.origin(row, c);
    if (seen.has(o.key) || !grid.shown(o) || grid.isFormula(o)) continue;
    seen.add(o.key);
    const text = labelText(grid.text(o));
    if (text !== '') texts.push(text);
  }
  return texts.join(' ');
}

// ---------------------------------------------------------------------------------------------------------------
// Matrix

/**
 * The corner of a header: the cell just left of its titles, when it is an empty bordered cell of the header row (or a
 * merge that ends there).
 */
function cornerOf(grid: Grid, header: Header): Origin | undefined {
  if (header.c1 <= 1) return undefined;
  const corner = grid.origin(header.row, header.c1 - 1);
  return corner.c2 === header.c1 - 1 && grid.shown(corner) && grid.bordered(corner) && grid.isEmpty(corner) ? corner : undefined;
}

/**
 * A matrix block under a header with an empty corner, or `undefined` when it is not one: the column under the corner
 * names nothing, or the cells are typed by column (each column one kind, the columns of different kinds), which is a
 * list of rows whose first column happens to have no title.
 */
function matrixBlock(grid: Grid, header: Header, corner: Origin, cols: number[], titles: Map<number, string>, dataStart: number): Block | undefined {
  const nameCols = shownCols(grid, corner.col, corner.c2);
  const { rows, next } = blockRows(grid, dataStart, cols, corner.col, header.c2);

  const fields: FieldDraft[] = [];
  const kinds = new Map<number, Set<string>>(cols.map((c) => [c, new Set<string>()]));
  let named = 0;
  for (const { row, hidden } of rows) {
    if (hidden) continue;
    const name = namesIn(grid, row, nameCols);
    if (hasLetters(name)) named += 1;
    for (const c of cols) {
      const o = emptyAt(grid, row, c);
      if (!o) continue;
      fields.push({ row, col: c, parts: [titles.get(c) ?? '', name], cell: o.cell });
      kinds.get(c)!.add(kindOf(o.cell, []).kind);
    }
  }
  const byColumn = [...kinds.values()].filter((k) => k.size > 0);
  const typedByColumn = byColumn.every((k) => k.size === 1) && new Set(byColumn.map((k) => [...k][0])).size > 1;
  if (named === 0 || fields.length === 0 || typedByColumn) return undefined;
  return { fields, groups: [], claimed: claimedKeys(grid, header, rows, nameCols.concat(cols)), next };
}

/** The keys of the header cells and of every cell of the block's rows. */
function claimedKeys(grid: Grid, header: Header, rows: { row: number }[], cols: number[]): number[] {
  const keys = header.cells.map((o) => o.key);
  for (let r = header.row; r <= (rows[rows.length - 1]?.row ?? header.row); r += 1) {
    for (const c of cols) keys.push(grid.origin(r, c).key);
  }
  return keys;
}

// ---------------------------------------------------------------------------------------------------------------
// Rows

interface Run {
  rows: number[];
  cols: number[];
  /** The width of each column's cell in the first row (a merged cell is wider than one column). */
  widths: Map<number, number>;
  /** Rows above the run, since the header or the previous run, with no empty cell: fixed rows when they are full. */
  before: number[];
  caption?: string;
}

/**
 * A block of rows. `cols` are its shown columns, from the first title (or the header's empty corner, whose column then
 * names the rows) to the last.
 */
function rowsBlock(grid: Grid, header: Header, cols: number[], titles: Map<number, string>, dataStart: number): Block {
  const fields: FieldDraft[] = [];
  const groups: GroupDraft[] = [];
  const c1 = cols[0]!;
  const { rows, next } = blockRows(grid, dataStart, cols, c1, header.c2);
  const title = (c: number): string => titles.get(c) ?? '';
  /** What names a row: the texts of the columns before the first fillable one. */
  const rowName = (row: number, firstCol: number): string => namesIn(grid, row, cols.filter((c) => c < firstCol));

  let run: Run | undefined;
  let before: number[] = [];
  let caption: string | undefined;
  let lastCols: number[] = [];

  const close = (): void => {
    if (!run) return;
    const r = run;
    run = undefined;
    lastCols = r.cols;
    before = [];
    caption = undefined;
    const firstCol = r.cols[0]!;
    if (r.rows.length === 1) {
      const row = r.rows[0]!;
      for (const c of r.cols) fields.push({ row, col: c, parts: [title(c), rowName(row, firstCol)], cell: grid.origin(row, c).cell });
      return;
    }
    groups.push(groupOf(grid, r, title, rowName, c1));
  };

  for (const { row, hidden } of rows) {
    if (hidden) {
      close();
      continue;
    }
    const empties = cols.map((c) => emptyAt(grid, row, c)).filter((o): o is Origin => o !== undefined);
    // A cell merged down over several rows (one Remarks box beside the rows) is a field of its own, named by its column.
    const single = (o: Origin, firstCol: number): void => {
      fields.push({ row, col: o.col, parts: o.r2 > o.row ? [title(o.col)] : [title(o.col), rowName(row, firstCol)], cell: o.cell });
    };
    if (run && continues(grid, run, row)) {
      run.rows.push(row);
      const firstCol = run.cols[0]!;
      for (const o of empties) if (!run.cols.includes(o.col)) single(o, firstCol);
      continue;
    }
    close();
    // A row with a formula where the run above took values (a total) is no row to fill.
    if (cols.some((c) => lastCols.includes(c) && grid.isFormula(grid.origin(row, c)))) continue;
    const flat = empties.filter((o) => o.r2 === o.row);
    if (flat.length === 0) {
      for (const o of empties) single(o, header.c2 + 1);
      before.push(row);
      const texts = grid.originsInRow(row).filter((o) => o.col >= c1 && o.col <= header.c2 && grid.text(o) !== '');
      if (texts.length === 1) caption = labelText(grid.text(texts[0]!));
      continue;
    }
    for (const o of empties) if (o.r2 > o.row) single(o, flat[0]!.col);
    run = {
      rows: [row], cols: flat.map((o) => o.col), widths: new Map(flat.map((o) => [o.col, o.c2 - o.col])), before, ...(caption === undefined ? {} : { caption }),
    };
  }
  close();
  return { fields, groups, claimed: claimedKeys(grid, header, rows, cols), next };
}

/** The row has an empty cell of the same shape (one row high, as wide) in each column of the run. */
function continues(grid: Grid, run: Run, row: number): boolean {
  return run.cols.every((c) => {
    const o = emptyAt(grid, row, c);
    return o !== undefined && o.r2 === row && o.c2 - o.col === run.widths.get(c);
  });
}

/** The row group of a run of two rows or more. */
function groupOf(grid: Grid, run: Run, title: (c: number) => string, rowName: (row: number, firstCol: number) => string, firstColumn: number): GroupDraft {
  const firstCol = run.cols[0]!;
  const firstRow = run.rows[0]!;
  const names = run.rows.map((row) => rowName(row, firstCol));
  const cols = run.cols.map((col) => ({ col, title: title(col), cell: grid.origin(firstRow, col).cell }));

  // A day grid: the first column numbers the rows 1 to n (28 to 31), and nothing else names them.
  const numbered = firstColumn < firstCol && run.rows.every((row, i) => {
    const o = grid.origin(row, firstColumn);
    return o.row === row && Number(grid.text(o)) === i + 1 && names[i] === String(i + 1);
  });
  const shape: RowGroupDef['shape'] = numbered && run.rows.length >= 28 && run.rows.length <= 31 ? 'dayGrid'
    : cols.some((c) => /condition|status/.test(normaliseLabel(c.title))) ? 'checklist' : 'rows';

  const group: GroupDraft = { firstRow, capacity: run.rows.length, cols, shape };
  if (names.some((n) => n !== '')) group.rowLabels = names;
  if (run.caption !== undefined) group.caption = run.caption;

  // Fixed rows (R8): rows above the run whose cells under its columns are all filled, with no formula.
  const fixed = run.before.filter((row) => run.cols.every((c) => {
    const o = grid.origin(row, c);
    return o.row === row && o.col === c && !grid.isFormula(o) && grid.text(o) !== '';
  }));
  if (fixed.length > 0) {
    group.fixedRows = fixed.map((row) => ({
      label: grid.text(grid.origin(row, firstColumn)),
      cells: run.cols.map((c) => grid.text(grid.origin(row, c))),
    }));
  }
  return group;
}

// ---------------------------------------------------------------------------------------------------------------

/** Every table block of a sheet, top to bottom. */
export function findTables(grid: Grid): Tables {
  const out: Tables = { fields: [], groups: [], claimed: new Set() };
  for (let row = 1; row <= grid.maxRow;) {
    const header = headerAt(grid, row);
    if (!header) {
      row += 1;
      continue;
    }
    const cols = shownCols(grid, header.c1, header.c2);
    const { titles, dataStart } = titlesOf(grid, header, cols);
    const corner = cornerOf(grid, header);
    const block = (corner && matrixBlock(grid, header, corner, cols, titles, dataStart))
      ?? rowsBlock(grid, header, corner ? shownCols(grid, corner.col, header.c2) : cols, titles, dataStart);
    if (block.fields.length === 0 && block.groups.length === 0) {
      row += 1;
      continue;
    }
    out.fields.push(...block.fields);
    out.groups.push(...block.groups);
    for (const key of block.claimed) out.claimed.add(key);
    row = Math.max(block.next, row + 1);
  }
  return out;
}

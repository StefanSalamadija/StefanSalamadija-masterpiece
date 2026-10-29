import { identityFromText } from '../identity';
import type { Package } from '../package';
import { partText } from '../package';
import type { FieldDef, FormIdentity, FormSchema, RowGroupDef } from '../types';
import { parseXml } from '../xml';
import { isIdentityText, isLabelCell, labelText, makeField } from './fields';
import { Grid, hasLetters } from './grid';
import type { Origin } from './grid';
import { cellLoc, columnLetters } from './refs';
import { findTables } from './tables';
import type { FieldDraft, GroupDraft } from './tables';
import { loadWorkbook, relsOf } from './workbook';
import type { SheetModel } from './workbook';

/*
 * Excel form detection (spec §5.2, with rulings R1, R3, R8 and R11). It runs once, at import: the schema it makes
 * holds each field's address, and writing and reading (Task 8) go there without detecting again.
 *
 * Addresses (`loc`, R1):
 * - a field: `<sheet part path>!<A1>`, e.g. `xl/worksheets/sheet1.xml!C6`. A merged cell is addressed by its top-left
 *   cell.
 * - a row group: the address of its first row's first column cell, e.g. `xl/worksheets/sheet1.xml!C9`, with
 *   `firstRow` the sheet row of its row 0 (9). Row `i` of the group is sheet row `firstRow + i`.
 * - a column of a row group: its column letters, e.g. `C`.
 *
 * Ids: a field is `<sheet name>!<A1>` (`Demo inventory!C6`), a row group `<sheet name>!g<n>` (`Demo inventory!g1`, by
 * order of `firstRow` in its sheet), a column of a group `<group id>.<letters>` (`Demo inventory!g1.C`), and a matrix
 * `<sheet name>!m<n>` (`Demo matrix!m1`, in document order): it is the `block` of each of its cells' fields (R14). The sheet's
 * name is what the person sees on the tab; it is unique in a workbook and stays the same when Excel renumbers the sheet
 * parts on saving. Ids are only keys: never parse one to find a cell, go to `loc`. (A sheet name may hold a `!`.)
 *
 * Only visible sheets are read, and in them only what is shown: hidden rows and columns and anything outside the print
 * area are left out. Fields are listed sheet by sheet, top to bottom and left to right; row groups likewise.
 */

/** A bold or larger line on its own longer than this is a sentence that stands out, not a heading. */
const MAX_HEADING = 80;
/** The rows of a sheet's top that hold its title. */
const TITLE_ROWS = 4;
/** A title found by length alone must be at least this long. */
const LONG_TITLE = 10;

interface SheetResult { fields: FieldDef[]; groups: RowGroupDef[] }

/** The font size most cells of the sheet have: text larger than it stands out. */
function usualFontSize(sheet: SheetModel): number {
  const counts = new Map<number, number>();
  for (const cell of sheet.cells.values()) if (cell.fontSize !== undefined) counts.set(cell.fontSize, (counts.get(cell.fontSize) ?? 0) + 1);
  let best = 0;
  let most = 0;
  for (const [size, n] of counts) if (n > most || (n === most && size < best)) [best, most] = [size, n];
  return best;
}

/**
 * The title cell of a sheet: in rows 1 to 4, of the cells with letters that are not labels (`Form:`, `Vessel:`), the one with
 * the largest font when it stands out; else the first long text; else the longest.
 */
function titleCell(grid: Grid): Origin | undefined {
  const candidates: Origin[] = [];
  for (let row = 1; row <= Math.min(TITLE_ROWS, grid.maxRow); row += 1) {
    for (const o of grid.originsInRow(row)) {
      const text = grid.text(o);
      if (hasLetters(text) && !isIdentityText(text) && !isLabelCell(text) && !grid.isFormula(o)) candidates.push(o);
    }
  }
  if (candidates.length === 0) return undefined;
  const size = (o: Origin): number => o.cell?.fontSize ?? 0;
  const largest = Math.max(...candidates.map(size));
  if (candidates.length === 1 || candidates.some((o) => size(o) < largest)) return candidates.find((o) => size(o) === largest);
  return candidates.find((o) => grid.text(o).length >= LONG_TITLE)
    ?? candidates.reduce((best, o) => (grid.text(o).length > grid.text(best).length ? o : best));
}

/**
 * The identity (spec §5.2): the code and revision from the cells with `Form:` and `Revision:` (and the cell after
 * each), from the top rows and the page header and footer; the title from the top rows (see `titleCell`), else the
 * header and footer, else the file name (R9).
 */
function identityOf(grid: Grid | undefined, fileName: string): { identity: FormIdentity; title?: Origin } {
  if (!grid) return { identity: identityFromText([], fileName) };
  const top: string[] = [];
  const labels: string[] = [];
  for (let row = 1; row <= grid.maxRow; row += 1) {
    const origins = grid.originsInRow(row);
    origins.forEach((o, i) => {
      const text = grid.text(o);
      if (text === '') return;
      if (row <= TITLE_ROWS) top.push(text);
      else if (isIdentityText(text)) labels.push(text, ...(origins[i + 1] ? [grid.text(origins[i + 1]!)] : []));
    });
  }
  const title = titleCell(grid);
  const found = identityFromText([...top, ...labels, ...grid.sheet.headerFooter], fileName);
  const fallback = identityFromText(grid.sheet.headerFooter, fileName).title;
  return { identity: { code: found.code, title: title ? grid.text(title) : fallback, revision: found.revision }, ...(title ? { title } : {}) };
}

/** The headings of a sheet, by row: a row whose one text, outside every table, is bold or larger, and not a label. */
function headingsOf(grid: Grid, claimed: Set<number>, title: Origin | undefined): Map<number, string> {
  const base = usualFontSize(grid.sheet);
  const headings = new Map<number, string>();
  for (let row = 1; row <= grid.maxRow; row += 1) {
    const texts = grid.originsInRow(row).filter((o) => grid.text(o) !== '');
    if (texts.length !== 1) continue;
    const o = texts[0]!;
    const text = grid.text(o);
    if (claimed.has(o.key) || o.key === title?.key || grid.isFormula(o) || !hasLetters(text) || text.length > MAX_HEADING) continue;
    if (isLabelCell(text) || isIdentityText(text)) continue;
    if (o.cell?.bold || (o.cell?.fontSize ?? 0) > base) headings.set(row, labelText(text));
  }
  return headings;
}

/** Label cells (spec §5.2): a label whose next shown cell to the right (or merged range) is empty makes that a field. */
function labelFields(grid: Grid, claimed: Set<number>): FieldDraft[] {
  const fields: FieldDraft[] = [];
  const taken = new Set<number>();
  for (let row = 1; row <= grid.maxRow; row += 1) {
    for (const o of grid.originsInRow(row)) {
      if (claimed.has(o.key) || !isLabelCell(grid.text(o)) || grid.isFormula(o)) continue;
      const next = grid.origin(row, grid.nextShownCol(o.c2));
      if (!grid.shown(next) || claimed.has(next.key) || taken.has(next.key) || !grid.isEmpty(next)) continue;
      taken.add(next.key);
      fields.push({ row: next.row, col: next.col, parts: [labelText(grid.text(o))], cell: next.cell });
    }
  }
  return fields;
}

/** What a sheet holds that can't be filled here: text in shapes (text boxes) and form controls (checkboxes, lists). */
function unsupportedOf(pkg: Package, sheet: SheetModel): string[] {
  const notes: string[] = [];
  for (const rel of relsOf(pkg, sheet.path)) {
    if (rel.type.endsWith('/ctrlProp')) {
      notes.push(`Form control on sheet "${sheet.name}"`);
    } else if (rel.type.endsWith('/drawing')) {
      const text = partText(pkg, rel.target);
      if (text === undefined) continue;
      for (const sp of Array.from(parseXml(text).getElementsByTagNameNS('*', 'sp'))) {
        const words = Array.from(sp.getElementsByTagNameNS('*', 't')).map((t) => t.textContent ?? '').join('').replace(/\s+/g, ' ').trim();
        if (words !== '') notes.push(`Text box: "${words.length > 40 ? `${words.slice(0, 40).trimEnd()}…` : words}"`);
      }
    }
  }
  return [...new Set(notes)];
}

function detectSheet(grid: Grid, o: { title?: Origin; sectionDefault: string }): SheetResult {
  const { sheet } = grid;
  const tables = findTables(grid);
  const drafts = [...tables.fields, ...labelFields(grid, tables.claimed)].sort((a, b) => a.row - b.row || a.col - b.col);
  const headings = headingsOf(grid, tables.claimed, o.title);
  const sectionAt = (row: number): string => {
    let section = o.sectionDefault;
    for (const [r, text] of headings) if (r < row) section = text;
    return section;
  };

  const fields = drafts.map((d) => makeField({
    id: `${sheet.name}!${columnLetters(d.col)}${d.row}`, loc: cellLoc(sheet.path, d.col, d.row), parts: d.parts, cell: d.cell, section: sectionAt(d.row), fallback: '',
    ...(d.matrix === undefined ? {} : { block: `${sheet.name}!m${d.matrix}` }),
  }));

  const groups = [...tables.groups].sort((a, b) => a.firstRow - b.firstRow).map((g, i) => groupDef(sheet, g, i + 1, sectionAt(g.firstRow)));
  return { fields, groups };
}

function groupDef(sheet: SheetModel, g: GroupDraft, n: number, section: string): RowGroupDef {
  const id = `${sheet.name}!g${n}`;
  const columns = g.cols.map((c) => makeField({
    id: `${id}.${columnLetters(c.col)}`, loc: columnLetters(c.col), parts: [c.title], cell: c.cell, section, fallback: '',
  }));
  const group: RowGroupDef = {
    id, label: g.caption ?? (section || `Table ${n}`), section, loc: cellLoc(sheet.path, g.cols[0]!.col, g.firstRow), firstRow: g.firstRow,
    columns, capacity: g.capacity, growable: false, shape: g.shape,
  };
  if (g.rowLabels) group.rowLabels = g.rowLabels;
  if (g.fixedRows) group.fixedRows = g.fixedRows;
  return group;
}

/**
 * Finds every fillable cell of an Excel form (spec §5.2): label cells, table blocks (row groups and matrices) in each
 * visible sheet, within its print area; the identity from the first visible sheet; and what can't be filled here.
 * Throws `NotAFormError` when the package has no workbook.
 */
export function detectExcel(pkg: Package, fileName: string): FormSchema {
  const visible = loadWorkbook(pkg).sheets.filter((s) => !s.hidden);
  const grids = visible.map((sheet) => new Grid(sheet));
  const { identity, title } = identityOf(grids[0], fileName);
  const fields: FieldDef[] = [];
  const rowGroups: RowGroupDef[] = [];
  const unsupported: string[] = [];
  grids.forEach((grid, i) => {
    const result = detectSheet(grid, { ...(i === 0 && title ? { title } : {}), sectionDefault: grids.length > 1 ? grid.sheet.name : '' });
    fields.push(...result.fields);
    rowGroups.push(...result.groups);
    unsupported.push(...unsupportedOf(pkg, grid.sheet));
  });
  // A field with no label is called by its place among the fields.
  fields.forEach((f, i) => {
    if (f.label === '') f.label = `Field ${i + 1}`;
  });
  for (const g of rowGroups) {
    g.columns.forEach((c, k) => {
      if (c.label === '') c.label = `Column ${k + 1}`;
    });
  }
  return { kind: 'xlsx', identity, fields, rowGroups, unsupported };
}

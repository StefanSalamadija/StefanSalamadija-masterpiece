import { NotAFormError } from '../errors';
import { isSignatureLabel } from '../labels';
import { partText } from '../package';
import type { Package } from '../package';
import type { FieldDef, FormSchema, RowGroupDef } from '../types';
import { parseXml } from '../xml';
import { Addresser } from './address';
import { hasWords, isCheckbox, labelText, makeColumn, makeField, nodeOf, segment } from './fields';
import { otherStories } from './stories';
import { W, Walker, child, clean, flatTokens, itemsOf, paragraphsIn, textOf, wVal } from './walk';
import type { Block, Cell, Para, RawField, Repeat, Row, Table, Token } from './walk';

export { locateColumn, locateWord } from './address';
export type { WordTarget } from './address';

/*
 * Word form detection (spec §5.1, with rulings R1, R3, R8 and R11). It runs once, at import: the schema it makes holds
 * each field's address (`loc`, see `address.ts`), and writing and reading go there without detecting again.
 *
 * Ids are given in document order: fields `f1`, `f2`…, groups `g1`, `g2`…, and the columns of group `g<n>` are
 * `g<n>.c1`, `g<n>.c2`…. The same file always gives the same schema.
 */

/** The short choice words of a tick-column header, compared without case or spaces. */
const CHOICE_WORDS = new Set(['yes', 'no', 'n/a', 'na', 'y', 'n', 'ok', 'good', 'bad']);
/** A bold paragraph longer than this is a sentence that stands out, not a heading. */
const MAX_HEADING = 80;
const MAIN_PART = /wordprocessingml\.(?:document|template)\.main\+xml$/i;
const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';

interface CellInfo {
  cell: Cell;
  tokens: Token[];
  /** The cell's own text (not its controls' or fields'), on one line. */
  text: string;
  /** Fields, and tables or repeating sections inside the cell. */
  fields: number;
  boxes: number;
  objects: number;
  empty: boolean;
  bold: boolean;
}

interface RowInfo {
  row: Row;
  cells: CellInfo[];
  fields: boolean;
  boxes: boolean;
  /** No text, field, symbol or picture in any cell. */
  empty: boolean;
  /** The number of cells with text. */
  textCells: number;
  /** Every cell has text. */
  full: boolean;
  /** Every cell that has text has only bold text. */
  bold: boolean;
  /** The text of a title row: one cell across the whole table. */
  title?: string;
}

/** A tick column: where its cells start in the grid, and the option its header gives. */
interface TickColumn { grid: number; option: string }

function cellInfo(cell: Cell): CellInfo {
  const tokens = flatTokens(cell.blocks);
  let fields = 0;
  let boxes = 0;
  let objects = 0;
  for (const t of tokens) {
    if (t.t === 'field' || t.t === 'table' || t.t === 'repeat') fields += 1;
    else if (t.t === 'box') boxes += 1;
    else if (t.t === 'object') objects += 1;
  }
  const text = textOf(tokens);
  const written = tokens.filter((t): t is Token & { t: 'text' } => t.t === 'text' && t.s.trim() !== '');
  return {
    cell, tokens, text, fields, boxes, objects,
    empty: text === '' && fields === 0 && boxes === 0 && objects === 0,
    bold: written.length > 0 && written.every((t) => t.bold),
  };
}

function rowInfo(row: Row, gridCols: number): RowInfo {
  const cells = row.cells.map(cellInfo);
  const withText = cells.filter((c) => hasWords(c.text));
  const info: RowInfo = {
    row, cells,
    fields: cells.some((c) => c.fields > 0),
    boxes: cells.some((c) => c.boxes > 0),
    empty: cells.length > 0 && cells.every((c) => c.empty),
    textCells: withText.length,
    full: cells.length > 0 && withText.length === cells.length,
    bold: withText.length > 0 && withText.every((c) => c.bold),
  };
  const [only] = cells;
  // One cell across a table of several columns, or bold across a table of one, with text and nothing to fill.
  if (cells.length === 1 && only.cell.grid === 0 && only.cell.span >= gridCols && (gridCols >= 2 || only.bold)
    && hasWords(only.text) && only.fields === 0 && only.boxes === 0) info.title = only.text;
  return info;
}

/** The cell of a row that covers grid column `grid`. */
function cellAt(info: RowInfo, grid: number): CellInfo | undefined {
  return info.cells.find((c) => c.cell.grid <= grid && grid < c.cell.grid + c.cell.span);
}

/** The header of tick columns: the row's last 2 to 4 cells hold only short choice words. */
function tickHeader(info: RowInfo): TickColumn[] | undefined {
  if (info.fields || info.boxes) return undefined;
  let count = 0;
  for (let j = info.cells.length - 1; j >= 0 && count < 4; j -= 1) {
    if (!CHOICE_WORDS.has(info.cells[j].text.replace(/\s+/g, '').toLowerCase())) break;
    count += 1;
  }
  return count < 2 ? undefined : info.cells.slice(-count).map((c) => ({ grid: c.cell.grid, option: c.text }));
}

/** A paragraph of the body that is a heading: all bold (or a heading style) and short, or starting with `Section`. */
function headingOf(p: Para): string | undefined {
  if (p.tokens.some((t) => t.t === 'field')) return undefined;
  const text = textOf(p.tokens);
  if (!hasWords(text)) return undefined;
  if (/^section\b/i.test(text)) return text;
  const written = p.tokens.filter((t): t is Token & { t: 'text' } => t.t === 'text' && t.s.trim() !== '');
  const styled = /^(?:heading|title)/i.test(p.style);
  return (styled || written.every((t) => t.bold)) && text.length <= MAX_HEADING ? text : undefined;
}

class Detector {
  readonly fields: FieldDef[] = [];
  readonly groups: RowGroupDef[] = [];
  private section = '';

  constructor(private addr: Addresser) {}

  /** The body: paragraphs, tables and repeating sections in order. */
  body(blocks: readonly Block[]): void {
    // The nearest paragraph above with text and no field, and whether it is a heading; a table in between clears it.
    let previous: { text: string; heading: boolean } | undefined;
    for (const block of blocks) {
      if (block.t === 'p') {
        const { tokens } = block.p;
        if (tokens.some((t) => t.t === 'field')) {
          tokens.forEach((t, i) => {
            if (t.t === 'field') this.addField(t.field, this.inlineLabel(tokens, i, t.field) ?? previous?.text);
          });
          previous = undefined;
          continue;
        }
        const text = textOf(tokens);
        if (!hasWords(text)) continue;
        const heading = headingOf(block.p);
        if (heading !== undefined) this.section = heading;
        previous = { text, heading: heading !== undefined };
      } else {
        const caption = previous?.heading ? previous.text : undefined;
        if (block.t === 'table') this.table(block.table, caption, previous?.text);
        else this.blockRepeat(block.repeat, caption);
        previous = undefined;
      }
    }
  }

  /**
   * The text that names a field from its own paragraph or cell: the text before it, back to the previous field or
   * tick box. A checkbox whose words follow the boxes of its line (see `labelsFollowBoxes`) is named by the text after
   * it on that line instead. The text after a checkbox is also taken when nothing comes before it.
   */
  private inlineLabel(tokens: readonly Token[], i: number, field: RawField): string | undefined {
    const before = segment(tokens, i - 1, -1);
    if (isCheckbox(field) && (labelsFollowBoxes(tokens, i) || !hasWords(before))) {
      const after = segment(tokens, i + 1, 1, true);
      if (hasWords(after)) return after;
    }
    return hasWords(before) ? before : undefined;
  }

  private addField(field: RawField, text: string | undefined): void {
    const n = this.fields.length + 1;
    this.fields.push(makeField(field, { id: `f${n}`, text, fallback: `Field ${n}`, section: this.section, loc: this.addr.loc(nodeOf(field)) }));
  }

  /**
   * A table, row by row. `caption` is the heading just above it, `above` the paragraph just above it (which can name
   * a field in a one-column box).
   */
  private table(table: Table, caption: string | undefined, above: string | undefined): void {
    const rows = table.rows.map((row) => rowInfo(row, table.gridCols));
    let ticks: TickColumn[] | undefined;
    let title = caption;
    for (let i = 0; i < rows.length;) {
      const info = rows[i];
      const repeat = info.row.repeat;
      if (repeat) {
        let end = i;
        while (end < rows.length && rows[end].row.repeat?.section === repeat.section) end += 1;
        this.tableRepeat(rows, i, end, title);
        ticks = undefined;
        i = end;
        continue;
      }
      if (info.title !== undefined) {
        this.section = info.title;
        title = info.title;
        i += 1;
        continue;
      }
      const header = tickHeader(info);
      if (header) {
        ticks = header;
        i += 1;
        continue;
      }
      // The paragraph above the table names a field only in the first row of a box of one column.
      const boxAbove = table.gridCols === 1 && i === 0 ? above : undefined;
      if (ticks && this.tickRow(rows, i, ticks, boxAbove)) {
        i += 1;
        continue;
      }
      ticks = undefined;
      if (info.empty) {
        i = this.plainGroup(rows, i, title);
        continue;
      }
      this.rowFields(rows, i, info.cells, boxAbove);
      i += 1;
    }
  }

  /** The fields of some cells of a row, in order, and the tables and repeating sections inside them. */
  private rowFields(rows: RowInfo[], i: number, cells: readonly CellInfo[], boxAbove: string | undefined): void {
    for (const c of cells) {
      const ci = rows[i].cells.indexOf(c);
      c.tokens.forEach((t, ti) => {
        if (t.t === 'field') this.addField(t.field, this.cellLabel(rows, i, ci, ti, t.field) ?? boxAbove);
        else if (t.t === 'table') this.table(t.table, undefined, undefined);
        else if (t.t === 'repeat') this.blockRepeat(t.repeat, undefined);
      });
    }
  }

  /**
   * The text that names a field in a table cell (spec §5.1): in its own cell; else the cell before it in the row (the
   * cell that opens a vertical merge, for a merge's empty continuation); else the header cell above it.
   */
  private cellLabel(rows: RowInfo[], i: number, ci: number, ti: number, field: RawField): string | undefined {
    const own = this.inlineLabel(rows[i].cells[ci].tokens, ti, field);
    if (own !== undefined) return own;
    const left = ci > 0 ? rows[i].cells[ci - 1] : undefined;
    const origin = left?.cell.vMerge === 'continue' ? mergeOrigin(rows, i, left.cell.grid) : left;
    if (origin && origin.fields === 0 && hasWords(origin.text)) return origin.text;
    return headerAbove(rows, i, rows[i].cells[ci].cell.grid);
  }

  /** A row of tick cells under a tick header: one `choice` field. False when the row is not one. */
  private tickRow(rows: RowInfo[], i: number, ticks: readonly TickColumn[], boxAbove: string | undefined): boolean {
    const info = rows[i];
    const cells = ticks.map((col) => info.cells.find((c) => c.cell.grid === col.grid));
    if (cells.some((c) => !c || c.fields > 0 || c.objects > 0 || c.boxes > 1 || c.text !== '')) return false;
    const tickCells = cells as CellInfo[];
    const others = info.cells.filter((c) => !tickCells.includes(c));
    const labelCell = others.find((c) => hasWords(c.text));
    if (!labelCell && !tickCells.some((c) => c.boxes > 0)) return false;

    const first = ticks[0].grid;
    this.rowFields(rows, i, others.filter((c) => c.cell.grid < first), boxAbove);
    const n = this.fields.length + 1;
    const label = labelCell ? labelText(labelCell.text) : `Field ${n}`;
    const choice: FieldDef = {
      id: `f${n}`, kind: 'choice', label, section: this.section,
      loc: this.addr.loc(...tickCells.map((c) => c.cell.el)), options: ticks.map((col) => col.option), confidence: labelCell ? 'high' : 'low',
    };
    if (labelCell && isSignatureLabel(label)) choice.leftEmpty = true;
    this.fields.push(choice);
    this.rowFields(rows, i, others.filter((c) => c.cell.grid > first), boxAbove);
    return true;
  }

  /**
   * Empty rows under a header: a plain row group. Returns the index of the first row after them.
   *
   * The rows with text just above the empty ones are the table's head. Its header row is the last one marked to
   * repeat as a header; else the first bold one when not all are bold; else the first one when every row after it is
   * fully filled and has as many cells (alarm limits under the column titles); else the row just above the empty
   * rows. Fully filled rows between the header row and the empty rows are the group's `fixedRows` (R8).
   */
  private plainGroup(rows: RowInfo[], i: number, title: string | undefined): number {
    let end = i + 1;
    // Rows under one parent with nothing but markup between them (a bookmark, a permission range), as `locateWord`
    // counts the rows of a group: the row elements after the first, whatever else sits between them.
    while (end < rows.length && rows[end].empty && !rows[end].row.repeat && rows[end].row.el.parentNode === rows[end - 1].row.el.parentNode) end += 1;

    const head: RowInfo[] = [];
    for (let r = i - 1; r >= 0 && isTextRow(rows[r]); r -= 1) head.unshift(rows[r]);
    if (head.length === 0) return end;
    let h = head.findLastIndex((r) => r.row.tblHeader);
    if (h < 0 && head.some((r) => r.bold) && !head.every((r) => r.bold)) h = head.findIndex((r) => r.bold);
    if (h < 0) h = head.slice(1).every((r) => r.full && r.cells.length === head[0].cells.length) ? 0 : head.length - 1;
    let fixed = head.slice(h + 1);
    if (fixed.some((r) => !r.full)) {
      h = head.length - 1;
      fixed = [];
    }
    if (head[h].textCells < 2) return end;

    const n = this.groups.length + 1;
    const first = rows[i];
    const columns = first.cells.map((c, k) => makeColumn({
      id: `g${n}.c${k + 1}`, text: columnTitle(head, h, c.cell.grid), fallback: `Column ${k + 1}`, section: this.section,
      loc: this.addr.relative(first.row.el, c.cell.el),
    }));
    const group: RowGroupDef = {
      id: `g${n}`, label: title ?? (this.section || `Table ${n}`), section: this.section, loc: this.addr.loc(first.row.el),
      columns, capacity: end - i, growable: true, shape: 'rows',
    };
    if (fixed.length > 0) {
      group.fixedRows = fixed.map((r) => ({
        label: r.cells[0].text,
        cells: first.cells.map((c) => cellAt(r, c.cell.grid)?.text ?? ''),
      }));
    }
    this.groups.push(group);
    return end;
  }

  /**
   * A repeating section of table rows (`rows[start..end)`): a group that grows. Its columns are the fields of the
   * first item, named like any field in a cell (the header row above names them), else by the control's alias.
   */
  private tableRepeat(rows: RowInfo[], start: number, end: number, title: string | undefined): void {
    const section = rows[start].row.repeat!.section;
    const items = itemsOf(section);
    const n = this.groups.length + 1;
    const columns: FieldDef[] = [];
    for (let i = start; i < end && rows[i].row.repeat!.item === items[0]; i += 1) {
      rows[i].cells.forEach((c, ci) => c.tokens.forEach((t, ti) => {
        if (t.t !== 'field') return;
        const k = columns.length + 1;
        const text = this.cellLabel(rows, i, ci, ti, t.field);
        columns.push(makeField(t.field, { id: `g${n}.c${k}`, text, fallback: `Column ${k}`, section: this.section, loc: this.addr.relative(items[0], nodeOf(t.field)) }));
      }));
    }
    this.addRepeat(section, items, columns, title);
  }

  /** A repeating section of paragraphs: a group whose columns are the fields of the first item. */
  private blockRepeat(repeat: Repeat, caption: string | undefined): void {
    const n = this.groups.length + 1;
    const columns: FieldDef[] = [];
    const [first] = repeat.items;
    for (const p of first ? paragraphsIn(first.blocks) : []) {
      p.tokens.forEach((t, ti) => {
        if (t.t !== 'field') return;
        const k = columns.length + 1;
        columns.push(makeField(t.field, { id: `g${n}.c${k}`, text: this.inlineLabel(p.tokens, ti, t.field), fallback: `Column ${k}`, section: this.section, loc: this.addr.relative(first.el, nodeOf(t.field)) }));
      });
    }
    this.addRepeat(repeat.section, repeat.items.map((item) => item.el), columns, caption);
  }

  /** A repeating section with no field in it has nothing to fill, so it is no group. */
  private addRepeat(section: Element, items: Element[], columns: FieldDef[], title: string | undefined): void {
    if (columns.length === 0 || items.length === 0) return;
    const n = this.groups.length + 1;
    const alias = wVal(child(section, W, 'sdtPr'), 'alias');
    this.groups.push({
      id: `g${n}`, label: title ?? (hasWords(alias) ? clean(alias) : this.section || `Table ${n}`), section: this.section,
      loc: this.addr.loc(items[0]), columns, capacity: items.length, growable: true, shape: 'rows',
    });
  }
}

/**
 * Whether the words of the boxes around `tokens[i]` come after each box. The boxes are the run of checkboxes (and box
 * symbols) on the same line (paragraph) as `tokens[i]`, up to another kind of field. Their words follow them when:
 * - nothing with words comes before the first box (`☐ Hot ☐ Cold`);
 * - words come after the last box (`Permit type: ☐ Hot work ☐ Cold work`, `Is the area safe? ☐ Yes ☐ No`): the
 *   text before the first box is then a question about them, not a box's name;
 * - the text before the first box ends with `:` or `?` (a question whose boxes are named after them).
 *
 * Otherwise each box follows its words: `Yes ☐ No ☐ N/A ☐`, `Hot work ☐ Cold work ☐`, `Name [text] Yes ☐ No ☐`.
 */
function labelsFollowBoxes(tokens: readonly Token[], i: number): boolean {
  const isBox = (t: Token): boolean => t.t === 'box' || (t.t === 'field' && isCheckbox(t.field));
  const ends = (t: Token): boolean => t.t === 'break' || t.t === 'table' || t.t === 'repeat' || (t.t === 'field' && !isCheckbox(t.field));
  let start = i;
  while (start > 0 && !ends(tokens[start - 1])) start -= 1;
  let end = i;
  while (end < tokens.length - 1 && !ends(tokens[end + 1])) end += 1;
  const run = tokens.slice(start, end + 1);
  const first = run.findIndex(isBox);
  const last = run.findLastIndex(isBox);
  const lead = textOf(run.slice(0, first));
  return !hasWords(lead) || hasWords(textOf(run.slice(last + 1))) || /[:?]$/.test(lead);
}

/** A row of the head of a table: text, and nothing to fill. */
function isTextRow(info: RowInfo): boolean {
  return !info.row.repeat && info.title === undefined && !info.fields && !info.boxes && !info.empty && info.textCells > 0;
}

/** The cell that opens the vertical merge that the cell at `grid` in row `i` continues. */
function mergeOrigin(rows: RowInfo[], i: number, grid: number): CellInfo | undefined {
  for (let r = i - 1; r >= 0; r -= 1) {
    const c = rows[r].cells.find((cell) => cell.cell.grid === grid);
    if (!c || c.cell.vMerge === undefined) return undefined;
    if (c.cell.vMerge === 'restart') return c;
  }
  return undefined;
}

/**
 * The header cell above grid column `grid` of row `i`: the nearest cell above, in a row with nothing to fill, that has
 * text. Rows of fields whose cell there is empty (more fields under the same header) are passed; a title row, a side
 * label (a cell with text in a row of fields) or an empty header cell stops the search.
 */
function headerAbove(rows: RowInfo[], i: number, grid: number): string | undefined {
  for (let r = i - 1; r >= 0; r -= 1) {
    const info = rows[r];
    if (info.title !== undefined) return undefined;
    const c = cellAt(info, grid);
    if (!c) return undefined;
    const words = hasWords(c.text);
    if (!info.fields) {
      if (words) return c.text;
      if (c.cell.vMerge !== 'continue') return undefined;
    } else if (words) {
      return undefined;
    }
  }
  return undefined;
}

/**
 * The title of a column of a plain group at grid column `grid`: the header row's cell there, after the title of a
 * wider cell above it (`Time` over `IN | OUT` gives `Time IN`), or the nearest text above when the header cell is empty.
 */
function columnTitle(head: RowInfo[], h: number, grid: number): string | undefined {
  const cell = cellAt(head[h], grid);
  if (cell && hasWords(cell.text)) {
    const over = h > 0 ? cellAt(head[h - 1], grid) : undefined;
    return over && hasWords(over.text) && over.cell.span > cell.cell.span ? `${over.text} ${cell.text}` : cell.text;
  }
  for (let r = h - 1; r >= 0; r -= 1) {
    const above = cellAt(head[r], grid);
    if (above && hasWords(above.text)) return above.text;
  }
  return undefined;
}

/** The path of the main part, from `[Content_Types].xml`, else Word's usual one. */
function mainPartOf(pkg: Package): string {
  const types = partText(pkg, '[Content_Types].xml');
  if (types !== undefined) {
    for (const o of Array.from(parseXml(types).getElementsByTagNameNS(CONTENT_TYPES_NS, 'Override'))) {
      if (MAIN_PART.test(o.getAttribute('ContentType') ?? '')) return (o.getAttribute('PartName') ?? '').replace(/^\//, '');
    }
  }
  return 'word/document.xml';
}

/**
 * Finds every fillable place in a Word form (spec §5.1): legacy form fields, content controls, tick-box columns and
 * empty table rows in the body; the identity from the header; and what can't be filled here (fields in text boxes,
 * headers and footers).
 */
export function detectWord(pkg: Package, kind: 'docx' | 'dotx', fileName: string): FormSchema {
  const part = mainPartOf(pkg);
  const text = partText(pkg, part);
  if (text === undefined) throw new NotAFormError();
  const root = parseXml(text).documentElement;
  const body = child(root, W, 'body');
  const walker = new Walker();
  const detector = new Detector(new Addresser(part, root));
  detector.body(body ? walker.blocks(body) : []);
  const stories = otherStories(pkg, walker.textBoxes, fileName);
  return { kind, identity: stories.identity, fields: detector.fields, rowGroups: detector.groups, unsupported: stories.unsupported };
}

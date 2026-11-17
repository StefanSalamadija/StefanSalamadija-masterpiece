import * as XLSX from 'xlsx';
import type { BaseRecord, DraftSurveyShip, HydroRow, SheetRanges } from '../../domain/types';
import { missingCells, normalizeLabel } from './cells';
import type { CellKey, CellMap } from './types';

export { CELL_NAMES, missingCells, normalizeLabel, REQUIRED_CELLS } from './cells';

/*
 * Reading the company's draft survey workbook (spec §4.1). Everything is found by its label, never by a fixed cell:
 *  - HYDRO: the columns by their headers; formula cells (the sheet works its LCB and LCF from midships out from the
 *    "Tabled" columns) are read from the values Excel saved, never recalculated;
 *  - INITIAL: the ship's particulars, each the first non-empty cell to the right of its label;
 *  - INITIAL and FINAL: where each sheet's look-ups start in HYDRO, from the `HYDRO!A<n>` of their VLOOKUP formulas;
 *  - INITIAL and FINAL: the input cell of each survey field (the cell map), for filling the workbook in later.
 * The "FINAL (2)" sheet is not read: interim surveys use FINAL (spec §2).
 */

export interface ImportedWorkbook {
  ship: Omit<DraftSurveyShip, keyof BaseRecord | 'shipId'>;
  hydro: HydroRow[];
  cellMap: CellMap;
  /** Things the user should know before saving: shown with the preview. The import is still usable. */
  warnings: string[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Labels and cells

interface Pos { r: number; c: number }

/** How far to the right of a label its value may be (the workbook leaves a blank column or two in places). */
const MAX_SCAN = 8;

/** A number written as text, with a unit or not: "9.85 m", "9,85 m", "21,450.5 MT". */
function parseNumberText(text: string): number | undefined {
  const thousands = /^\s*([+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?)(?!\d)/.exec(text);
  if (thousands) return Number(thousands[1].replaceAll(',', ''));
  const plain = /^\s*([+-]?\d+(?:[.,]\d+)?)/.exec(text);
  return plain ? Number(plain[1].replace(',', '.')) : undefined;
}

class SheetView {
  private readonly merges: XLSX.Range[];
  /** The text cells, leftmost column first and top to bottom within a column, with their compared label. */
  private readonly labels: { pos: Pos; label: string }[] = [];

  constructor(readonly name: string, private readonly sheet: XLSX.WorkSheet) {
    this.merges = sheet['!merges'] ?? [];
    for (const address of Object.keys(sheet)) {
      if (address.startsWith('!')) continue;
      const cell = sheet[address] as XLSX.CellObject;
      if (cell.t === 's' && typeof cell.v === 'string') this.labels.push({ pos: XLSX.utils.decode_cell(address), label: normalizeLabel(cell.v) });
    }
    this.labels.sort((a, b) => a.pos.c - b.pos.c || a.pos.r - b.pos.r);
  }

  cell(p: Pos): XLSX.CellObject | undefined {
    return this.sheet[XLSX.utils.encode_cell(p)] as XLSX.CellObject | undefined;
  }
  address(p: Pos): string { return XLSX.utils.encode_cell(p); }
  isFormula(p: Pos): boolean { return typeof this.cell(p)?.f === 'string'; }
  text(p: Pos): string | undefined {
    const cell = this.cell(p);
    return cell?.t === 's' && typeof cell.v === 'string' ? cell.v : undefined;
  }
  label(p: Pos): string | undefined {
    const text = this.text(p);
    return text === undefined ? undefined : normalizeLabel(text);
  }
  /** The cell's number: a number cell's (cached) value, or a number written as text. */
  number(p: Pos): number | undefined {
    const cell = this.cell(p);
    if (cell?.t === 'n' && typeof cell.v === 'number' && Number.isFinite(cell.v)) return cell.v;
    if (cell?.t === 's' && typeof cell.v === 'string') return parseNumberText(cell.v);
    return undefined;
  }
  isEmpty(p: Pos): boolean {
    const cell = this.cell(p);
    return cell === undefined || cell.v === undefined || cell.v === null || (typeof cell.v === 'string' && cell.v.trim() === '');
  }
  private mergeStartingAt(p: Pos): XLSX.Range | undefined {
    return this.merges.find((m) => m.s.r === p.r && m.s.c === p.c);
  }
  /** The merged block that covers the cell, or the cell alone. */
  block(p: Pos): XLSX.Range {
    return this.merges.find((m) => m.s.r <= p.r && p.r <= m.e.r && m.s.c <= p.c && p.c <= m.e.c) ?? { s: p, e: p };
  }
  /** A cell that can take a value: one that holds something, or the top left of a merged block. */
  private isSlot(p: Pos): boolean {
    return !this.isEmpty(p) || this.mergeStartingAt(p) !== undefined;
  }

  /** The first text cell (leftmost, then topmost) whose label is one of `labels` and that passes `where`. */
  find(labels: readonly string[], where: (p: Pos) => boolean = () => true): Pos | undefined {
    return this.labels.find((entry) => labels.includes(entry.label) && where(entry.pos))?.pos;
  }

  /**
   * The cell to the right of a label (or of a value, for a second value) on its row: the first non-empty cell for
   * `'value'`; for `'input'`, the first that holds something or starts a merged block, as an empty input cell does.
   * Separators such as "─" are skipped.
   */
  next(from: Pos, mode: 'value' | 'input', limit = this.block(from).e.c + MAX_SCAN): Pos | undefined {
    for (let c = this.block(from).e.c + 1; c <= limit; c++) {
      const p = { r: from.r, c };
      const text = this.text(p);
      if (text !== undefined && text.trim() !== '' && !/[\p{L}\p{N}]/u.test(text)) continue;
      if (mode === 'value' ? !this.isEmpty(p) : this.isSlot(p)) return p;
    }
    return undefined;
  }

  /** The first input cell on row `r` between columns `from` and `to`. */
  slotIn(r: number, from: number, to: number): Pos | undefined {
    for (let c = from; c <= to; c++) if (this.isSlot({ r, c })) return { r, c };
    return undefined;
  }

  /** Every formula on the sheet. */
  formulas(): string[] {
    return Object.keys(this.sheet).filter((a) => !a.startsWith('!')).map((a) => (this.sheet[a] as XLSX.CellObject).f).filter((f): f is string => typeof f === 'string');
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The workbook

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const UNREADABLE = "This file can't be read as an Excel workbook. Choose the company's draft survey workbook (.xlsx).";

function parse(bytes: Uint8Array): XLSX.WorkBook | undefined {
  const startsWith = (signature: number[]) => signature.every((byte, i) => bytes[i] === byte);
  if (!startsWith(ZIP_SIGNATURE) && !startsWith(CFB_SIGNATURE)) return undefined;
  try {
    return XLSX.read(bytes, { type: 'array', cellFormula: true, cellHTML: false, cellText: false });
  } catch {
    return undefined;
  }
}

function sheetNamed(book: XLSX.WorkBook, name: string): SheetView | undefined {
  const found = book.SheetNames.find((n) => n.trim().toUpperCase() === name);
  return found === undefined ? undefined : new SheetView(name, book.Sheets[found]);
}

/** Reads the company workbook: the ship's data, the hydrostatic table and the input cells. A plain message if it can't. */
export function readSurveyWorkbook(bytes: Uint8Array): ImportedWorkbook | { error: string } {
  const book = parse(bytes);
  if (!book) return { error: UNREADABLE };
  const hydroSheet = sheetNamed(book, 'HYDRO');
  const initial = sheetNamed(book, 'INITIAL');
  const final = sheetNamed(book, 'FINAL');
  const missing = [['HYDRO', hydroSheet], ['INITIAL', initial], ['FINAL', final]].filter(([, s]) => !s).map(([n]) => n as string);
  if (!hydroSheet || !initial || !final) {
    return { error: `This doesn't look like the company's draft survey workbook: it has no ${missing.join(', ')} sheet.` };
  }

  const warnings: string[] = [];
  const particulars = readParticulars(initial, final, warnings);
  if ('error' in particulars) return particulars;
  const table = readHydro(hydroSheet, particulars.lbp, warnings);
  if ('error' in table) return table;

  const ranges = {
    initial: readRanges(initial, table, warnings),
    final: readRanges(final, table, warnings),
  };
  const cellMap: CellMap = { INITIAL: readCells(initial), FINAL: readCells(final) };
  const notFound = missingCells(cellMap);
  if (notFound.length > 0) {
    warnings.push(`The company workbook can't be filled in from the app: ${notFound.join(', ')} ${notFound.length === 1 ? "wasn't" : "weren't"} found. `
      + 'Its labels may have been moved or renamed. The numbers and the report still work.');
  }
  return { ship: { ...particulars, lcfSource: 'workbook', ranges }, hydro: table.rows, cellMap, warnings };
}

// ---------------------------------------------------------------------------------------------------------------------
// Particulars

type Particulars = Omit<DraftSurveyShip, keyof BaseRecord | 'shipId' | 'lcfSource' | 'ranges'>;

const REQUIRED_PARTICULARS = [
  ['lbp', ['lbp='], 'LBP ='], ['dF', ['df='], 'dF ='], ['dM', ['dm='], 'dM ='], ['dA', ['da='], 'dA ='],
  ['beam', ['beam'], 'Beam'], ['lightShip', ['light ship weight', 'light ship', 'lightship'], 'Light Ship Weight'],
] as const;
const OPTIONAL_PARTICULARS = [
  ['summerDraught', ['summer draught', 'summer draft']], ['summerDwt', ['summer deadweight', 'summer dwt']],
  ['depth', ['depth moulded', 'depth molded', 'depth']], ['gt', ['gt', 'gross tonnage']],
] as const;
const KEEL_LABELS = ['keel plate corr.', 'keel plate corr', 'keel plate correction'];

/** The number to the right of a label on the sheet, if both are there. */
function labelledNumber(sheet: SheetView, labels: readonly string[]): number | undefined {
  const label = sheet.find(labels);
  const value = label && sheet.next(label, 'value');
  return value && sheet.number(value);
}

function readParticulars(initial: SheetView, final: SheetView, warnings: string[]): Particulars | { error: string } {
  const found: Partial<Record<string, number>> = {};
  const absent: string[] = [];
  for (const [key, labels, shown] of REQUIRED_PARTICULARS) {
    const value = labelledNumber(initial, labels);
    if (value === undefined) absent.push(`"${shown}"`);
    else found[key] = value;
  }
  if (absent.length > 0) {
    return { error: `The INITIAL sheet doesn't show the ship's ${absent.join(', ')} with a number next to ${absent.length === 1 ? 'it' : 'them'}, so the ship's data can't be read.` };
  }
  const ship: Particulars = {
    lbp: found.lbp!, dF: found.dF!, dM: found.dM!, dA: found.dA!, beam: found.beam!, lightShip: found.lightShip!,
    keelPlateCorr: readKeelPlate(initial, warnings),
  };
  for (const [key, labels] of OPTIONAL_PARTICULARS) {
    const value = labelledNumber(initial, labels);
    if (value !== undefined) ship[key] = value;
  }

  const trimLbp = labelledNumber(initial, ['lbp']);
  if (trimLbp !== undefined && trimLbp !== ship.lbp) {
    warnings.push(`The INITIAL sheet has two different LBPs (${ship.lbp} by "LBP =" and ${trimLbp} for the trim corrections). The app uses ${ship.lbp} for both.`);
  }
  for (const [labels, own, name] of [[['da='], ship.dA, 'dA'], [['lbp='], ship.lbp, 'LBP']] as const) {
    const value = labelledNumber(final, labels);
    if (value !== undefined && value !== own) {
      warnings.push(`The FINAL sheet has its own ${name} (${value}), which differs from INITIAL's (${own}). The app uses ${own} for both, and writes it on FINAL when it fills the workbook in.`);
    }
  }
  return ship;
}

/** The forward keel-plate correction (0 if blank), with a warning if the midships or aft one differs. */
function readKeelPlate(initial: SheetView, warnings: string[]): number {
  const label = initial.find(KEEL_LABELS);
  if (!label) return 0;
  const values = draftColumns(initial).map((span) => {
    const cell = span && initial.slotIn(label.r, span.from, span.to);
    return (cell && initial.number(cell)) ?? 0;
  });
  if (values.some((v) => v !== values[0])) {
    warnings.push(`The INITIAL sheet's keel plate corrections differ (${values.join(', ')}). The app uses one for all three marks: ${values[0]}.`);
  }
  return values[0];
}

// ---------------------------------------------------------------------------------------------------------------------
// HYDRO

type HydroKey = 'draft' | 'displacement' | 'tpc' | 'mtc' | 'lcbMid' | 'lcfMid' | 'lcfTabled';
const HYDRO_COLUMNS: { key: HydroKey; header: string; matches: (label: string) => boolean; required: boolean }[] = [
  { key: 'draft', header: 'Draught', matches: (l) => l === 'draught' || l === 'draft', required: true },
  { key: 'displacement', header: 'Displ', matches: (l) => l.startsWith('displ'), required: true },
  { key: 'tpc', header: 'TPC', matches: (l) => l === 'tpc', required: true },
  { key: 'mtc', header: 'MTC', matches: (l) => l === 'mtc', required: true },
  { key: 'lcbMid', header: 'LCB from midship', matches: (l) => l === 'lcb from midship' || l === 'lcb from midships', required: true },
  { key: 'lcfMid', header: 'LCF from midship', matches: (l) => l === 'lcf from midship' || l === 'lcf from midships', required: true },
  { key: 'lcfTabled', header: 'LCF Tabled', matches: (l) => l === 'lcf tabled', required: false },
];
/** The rows searched for HYDRO's header row. */
const HEADER_SEARCH_ROWS = 10;
const MAX_STEP = 0.1;
const STEP_TOLERANCE = 1e-9;

interface Table { rows: HydroRow[]; columns: Partial<Record<HydroKey, number>>; sheetRows: number[] }

function readHydro(sheet: SheetView, lbp: number, warnings: string[]): Table | { error: string } {
  const columns: Partial<Record<HydroKey, number>> = {};
  let headerRow = -1;
  for (let r = 0; r < HEADER_SEARCH_ROWS && headerRow === -1; r++) {
    for (let c = 0; c < 30; c++) {
      const label = sheet.label({ r, c });
      if (label !== undefined && HYDRO_COLUMNS[0].matches(label)) headerRow = r;
    }
  }
  if (headerRow !== -1) {
    for (let c = 0; c < 30; c++) {
      const label = sheet.label({ r: headerRow, c });
      const column = label === undefined ? undefined : HYDRO_COLUMNS.find((col) => col.matches(label));
      if (column && columns[column.key] === undefined) columns[column.key] = c;
    }
  }
  const absent = HYDRO_COLUMNS.filter((col) => col.required && columns[col.key] === undefined).map((col) => `"${col.header}"`);
  if (absent.length > 0) return { error: `The HYDRO sheet has no ${absent.join(', ')} column${absent.length === 1 ? '' : 's'}, so its table can't be read.` };
  if (columns.lcfTabled === undefined) warnings.push('The HYDRO sheet has no "LCF Tabled" column, so the tabled LCF can\'t be offered as a check.');

  const rows: HydroRow[] = [];
  const sheetRows: number[] = [];
  for (let r = headerRow + 1; !sheet.isEmpty({ r, c: columns.draft! }); r++) {
    const row: Partial<Record<HydroKey, number>> = {};
    for (const col of HYDRO_COLUMNS) {
      const c = columns[col.key];
      if (c === undefined) continue;
      const p = { r, c };
      const value = sheet.cell(p)?.t === 'n' ? sheet.number(p) : undefined;
      if (value === undefined) {
        return {
          error: sheet.isFormula(p)
            ? `The HYDRO sheet's row ${r + 1} has a formula under "${col.header}" with no saved result. Open the file in Excel, save it, and import it again.`
            : `The HYDRO sheet's row ${r + 1} has no number under "${col.header}".`,
        };
      }
      row[col.key] = value;
    }
    rows.push({
      draft: row.draft!, displacement: row.displacement!, tpc: row.tpc!, mtc: row.mtc!, lcbMid: row.lcbMid!, lcfMid: row.lcfMid!,
      ...(row.lcfTabled !== undefined && { lcfTabledMid: lbp / 2 - row.lcfTabled }),
    });
    sheetRows.push(r + 1);
  }
  if (rows.length === 0) return { error: 'The HYDRO sheet has no table rows.' };

  for (let i = 1; i < rows.length; i++) {
    if (rows[i].draft <= rows[i - 1].draft) {
      return { error: `The HYDRO table isn't in draught order: ${rows[i].draft} m (row ${sheetRows[i]}) comes after ${rows[i - 1].draft} m.` };
    }
  }
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].draft - rows[i - 1].draft > MAX_STEP + STEP_TOLERANCE) {
      return { error: `The HYDRO table has a gap of more than 0.1 m, between ${rows[i - 1].draft} m and ${rows[i].draft} m (rows ${sheetRows[i - 1]} and ${sheetRows[i]}).` };
    }
  }
  return { rows, columns, sheetRows };
}

// ---------------------------------------------------------------------------------------------------------------------
// Look-up ranges

const VLOOKUP = /VLOOKUP\(\s*[^,()]+,\s*(?:'?HYDRO'?)!\$?([A-Z]+)\$?(\d+):\$?[A-Z]+\$?\d+\s*,\s*(\d+)\s*[,)]/gi;

/** The start draft of a sheet's displacement/TPC/MTC look-ups and of its LCF look-ups, from its VLOOKUP formulas. */
function readRanges(sheet: SheetView, table: Table, warnings: string[]): SheetRanges {
  const starts = { dispTpcMtc: new Set<number>(), lcf: new Set<number>() };
  for (const formula of sheet.formulas()) {
    for (const match of formula.matchAll(VLOOKUP)) {
      const column = XLSX.utils.decode_col(match[1].toUpperCase()) + Number(match[3]) - 1;
      const row = Number(match[2]);
      if ([table.columns.displacement, table.columns.tpc, table.columns.mtc].includes(column)) starts.dispTpcMtc.add(row);
      else if (column === table.columns.lcfMid) starts.lcf.add(row);
    }
  }
  const startDraft = (rows: Set<number>, what: string): number => {
    const first = table.rows[0].draft;
    if (rows.size === 0) {
      warnings.push(`The ${sheet.name} sheet has no ${what} look-up into HYDRO, so its look-ups start at the table's first draught (${first} m).`);
      return first;
    }
    const row = Math.max(...rows);
    if (rows.size > 1) warnings.push(`The ${sheet.name} sheet's ${what} look-ups start at different HYDRO rows. The app uses the latest, row ${row}.`);
    const index = table.sheetRows.findIndex((r) => r >= row);
    if (index === -1) {
      warnings.push(`The ${sheet.name} sheet's ${what} look-ups start at HYDRO row ${row}, below the table. The app uses the table's first draught (${first} m).`);
      return first;
    }
    return table.rows[index].draft;
  };
  return { dispTpcMtcFrom: startDraft(starts.dispTpcMtc, 'displacement, TPC and MTC'), lcfFrom: startDraft(starts.lcf, 'LCF') };
}

// ---------------------------------------------------------------------------------------------------------------------
// Input cells

/** Labels whose input is the cell to their right. */
const BESIDE: [CellKey, string[]][] = [
  ['terminal', ['terminal']], ['cargo', ['cargo']], ['holds', ['holds', 'hold', 'holds no.']], ['date', ['date']],
  ['windBft', ['wind']], ['swell', ['swell']], ['blQty', ['bl q-ty', 'b/l q-ty', 'q-ty', 'bl qty', 'b/l qty']],
  ['density', ['density']],
  ['ballast', ['ballast']], ['freshWater', ['fresh water']], ['vlsfo', ['vlsfo']], ['lsmgo', ['lsmgo']], ['lubOil', ['lub oil', 'lub. oil']],
  ['other', ['other', 'others']],
  ['comparedQty', ['shore scale', 'b/l figure', 'bl figure']],
  ['surveyor', ['surveyor']], ['chiefOfficer', ['ch. off.', 'ch.off.', 'chief officer', 'c/o']],
];

/** The draft columns' spans, Forward, Midships and Aft: each heading's merged block, or up to the next heading. */
function draftColumns(sheet: SheetView): ({ from: number; to: number } | undefined)[] {
  return [['forward', 'fwd'], ['midships', 'midship', 'amidships'], ['aft']].map((labels) => {
    const heading = sheet.find(labels);
    if (!heading) return undefined;
    const block = sheet.block(heading);
    if (block.e.c > block.s.c) return { from: block.s.c, to: block.e.c };
    return { from: heading.c, to: heading.c + MAX_SCAN };
  });
}

function readCells(sheet: SheetView): Partial<Record<CellKey, string>> {
  const cells: Partial<Record<CellKey, string>> = {};
  /** Maps the key to the cell if it is an input: a formula there means the sheet works the value out itself. */
  const put = (key: CellKey, p: Pos | undefined): Pos | undefined => {
    if (!p || sheet.isFormula(p)) return undefined;
    cells[key] = sheet.address(p);
    return p;
  };
  const isDraftRow = (p: Pos) => sheet.label({ r: p.r + 1, c: p.c }) === 'starboard';

  // The title line: "Loading of" / "Discharging of" under the title, then the cargo, within the title's width.
  const title = sheet.find(['draft survey calculation']);
  if (title) {
    const span = sheet.block(title);
    const operation = put('operation', sheet.slotIn(title.r + 1, span.s.c, span.e.c));
    if (operation) put('cargoTitle', sheet.next(operation, 'input', span.e.c));
  }

  // "Port:" is the port's label, "Port" over "Starboard" the drafts' row; the colon doesn't tell them apart.
  const portName = sheet.find(['port'], (p) => !isDraftRow(p));
  if (portName) put('port', sheet.next(portName, 'input'));
  for (const [key, labels] of BESIDE) {
    const label = sheet.find(labels);
    if (label) put(key, sheet.next(label, 'input'));
  }
  const time = sheet.find(['time']);
  const timeFrom = time && put('timeFrom', sheet.next(time, 'input'));
  if (timeFrom) put('timeTill', sheet.next(timeFrom, 'input'));
  const remarks = sheet.find(['remarks']);
  if (remarks) put('remarks', sheet.slotIn(remarks.r + 1, remarks.c, remarks.c));

  const portRow = sheet.find(['port'], isDraftRow);
  const spans = draftColumns(sheet);
  const draftKeys: [CellKey, CellKey][] = [['fP', 'fS'], ['mP', 'mS'], ['aP', 'aS']];
  if (portRow) {
    spans.forEach((span, i) => {
      if (!span) return;
      put(draftKeys[i][0], sheet.slotIn(portRow.r, span.from, span.to));
      put(draftKeys[i][1], sheet.slotIn(portRow.r + 1, span.from, span.to));
    });
  }

  if (sheet.name === 'INITIAL') {
    // The particulars (ruling I1): kept even when the cell is a formula, so that the export refuses it rather than
    // leave the workbook working with other particulars than the app's. The trim LBP is kept only when it is typed: as
    // a formula it follows "LBP =". So are the midships and aft keel plate corrections, which may follow the forward one.
    const keep = (key: CellKey, p: Pos | undefined) => { if (p) cells[key] = sheet.address(p); };
    for (const [key, labels] of [['shipLbp', ['lbp=']], ['shipDF', ['df=']], ['shipDM', ['dm=']], ['shipDA', ['da=']], ['shipBeam', ['beam']],
      ['shipLightShip', ['light ship weight', 'light ship', 'lightship']]] as const) {
      const label = sheet.find(labels);
      keep(key, label && sheet.next(label, 'value'));
    }
    const trim = sheet.find(['lbp']);
    put('shipTrimLbp', trim && sheet.next(trim, 'value'));
    const keel = sheet.find(KEEL_LABELS);
    if (keel) {
      const [f, m, a] = draftColumns(sheet).map((span) => span && sheet.slotIn(keel.r, span.from, span.to));
      keep('shipKeelF', f);
      put('shipKeelM', m);
      put('shipKeelA', a);
    }
  }
  if (sheet.name === 'FINAL') {
    for (const [key, labels] of [['finalOwnDA', ['da=']], ['finalOwnLBP', ['lbp=']]] as const) {
      const label = sheet.find(labels);
      if (label) put(key, sheet.next(label, 'value'));
    }
  }
  return cells;
}

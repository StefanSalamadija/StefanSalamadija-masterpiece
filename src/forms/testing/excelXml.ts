import { CONTENT_TYPE, PNG_1X1, REL_TYPE, XML_DECLARATION, contentTypesXml, escapeXml, relationshipsXml, zipOf } from './zip';

/*
 * Hand-written SpreadsheetML, in the shapes Excel itself writes: shared strings, a `styles.xml` with thin borders and
 * number formats, merged cells, a formula with its cached value, a print area, and a logo drawing. Every text and
 * number in it is invented.
 */

const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/**
 * The cell formats of `styles.xml`, by index into `cellXfs`. Formats 5 and 7 are dates (a custom `dd-mmm-yyyy` and the
 * built-in 14), 6 is a number with one decimal.
 */
export const STYLE = {
  plain: 0, label: 1, title: 2, header: 3, cell: 4, date: 5, number: 6, dateShort: 7, centered: 8, bold: 9, meta: 10, wrapped: 11,
} as const;
export type StyleId = (typeof STYLE)[keyof typeof STYLE];

const THIN = '<border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border>';
const STYLES = `${XML_DECLARATION}<styleSheet xmlns="${MAIN_NS}">`
  + '<numFmts count="2"><numFmt numFmtId="164" formatCode="dd\\-mmm\\-yyyy"/><numFmt numFmtId="165" formatCode="0.0"/></numFmts>'
  + '<fonts count="4">'
  + '<font><sz val="10"/><name val="Arial"/><family val="2"/></font>'
  + '<font><b/><sz val="10"/><name val="Arial"/><family val="2"/></font>'
  + '<font><b/><sz val="14"/><name val="Arial"/><family val="2"/></font>'
  + '<font><sz val="8"/><name val="Arial"/><family val="2"/></font>'
  + '</fonts>'
  + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFD9D9D9"/><bgColor indexed="64"/></patternFill></fill></fills>'
  + `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>${THIN}</borders>`
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="12">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
  + '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>'
  + '<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
  + '<xf numFmtId="14" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
  + '</cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
  + '</styleSheet>';

// ---------------------------------------------------------------------------------------------------------------
// Cell references

/** `1` → `A`, `27` → `AA`. */
export function columnName(column: number): string {
  let name = '';
  for (let n = column; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

function columnNumber(name: string): number {
  return [...name].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0);
}

/** `C12` → `{ column: 3, row: 12 }`. */
export function parseRef(ref: string): { column: number; row: number } {
  const match = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!match) throw new Error(`Not a cell reference: ${ref}`);
  return { column: columnNumber(match[1]!), row: Number(match[2]) };
}

/** `B2:D3` → `{ from: B2, to: D3 }` (as numbers); a single cell is a range of one. */
function parseRange(range: string): { from: { column: number; row: number }; to: { column: number; row: number } } {
  const [from, to] = range.split(':');
  return { from: parseRef(from!), to: parseRef(to ?? from!) };
}

// ---------------------------------------------------------------------------------------------------------------
// The sheet

/** A cell's content: text (a shared string), a number, or a formula with the value Excel last worked out for it. */
export type CellValue = string | number | { formula: string; value: number };

interface SheetCell { value?: CellValue; style: number }

export class Sheet {
  private readonly cells = new Map<number, Map<number, SheetCell>>();
  private readonly merges: string[] = [];
  private readonly widths: number[] = [];
  private readonly sharedStrings: string[] = [];
  private readonly stringIndex = new Map<string, number>();
  private stringReferences = 0;

  constructor(readonly name: string) {}

  /** Column widths, in characters, from column A. */
  columnWidths(...widths: number[]): this {
    this.widths.push(...widths);
    return this;
  }

  /** Sets one cell: its content (`undefined` for an empty cell that is only bordered) and its format. */
  set(ref: string, value: CellValue | undefined, style: StyleId = STYLE.plain): this {
    const { column, row } = parseRef(ref);
    if (!this.cells.has(row)) this.cells.set(row, new Map());
    this.cells.get(row)!.set(column, { value, style });
    return this;
  }

  /** Gives every cell of the range this format, except those already set. For the empty, bordered cells of a table. */
  blank(range: string, style: StyleId): this {
    const { from, to } = parseRange(range);
    for (let row = from.row; row <= to.row; row += 1) {
      for (let column = from.column; column <= to.column; column += 1) {
        if (!this.cells.get(row)?.has(column)) this.set(`${columnName(column)}${row}`, undefined, style);
      }
    }
    return this;
  }

  /** Merges the range (a single cell is just formatted). Excel gives every cell of a merge the format, so that the border is drawn all round. */
  merge(range: string, style: StyleId, value?: CellValue): this {
    const { from } = parseRange(range);
    if (value !== undefined) this.set(`${columnName(from.column)}${from.row}`, value, style);
    this.blank(range, style);
    if (range.includes(':')) this.merges.push(range);
    return this;
  }

  /** The last cell used: the sheet's `dimension`. */
  private dimension(): string {
    let lastRow = 1;
    let lastColumn = 1;
    for (const [row, columns] of this.cells) {
      lastRow = Math.max(lastRow, row);
      for (const column of columns.keys()) lastColumn = Math.max(lastColumn, column);
    }
    return `A1:${columnName(lastColumn)}${lastRow}`;
  }

  private shared(text: string): number {
    this.stringReferences += 1;
    const known = this.stringIndex.get(text);
    if (known !== undefined) return known;
    this.stringIndex.set(text, this.sharedStrings.length);
    this.sharedStrings.push(text);
    return this.sharedStrings.length - 1;
  }

  private cellXml(ref: string, cell: SheetCell): string {
    const style = cell.style ? ` s="${cell.style}"` : '';
    const { value } = cell;
    if (value === undefined) return `<c r="${ref}"${style}/>`;
    if (typeof value === 'string') return `<c r="${ref}"${style} t="s"><v>${this.shared(value)}</v></c>`;
    if (typeof value === 'number') return `<c r="${ref}"${style}><v>${value}</v></c>`;
    return `<c r="${ref}"${style}><f>${escapeXml(value.formula)}</f><v>${value.value}</v></c>`;
  }

  private worksheetXml(o: { landscape: boolean }): string {
    this.stringReferences = 0; // counted afresh each time the cells are written
    const columns = this.widths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join('');
    const rows = [...this.cells.keys()].sort((a, b) => a - b).map((row) => {
      const cells = [...this.cells.get(row)!.entries()].sort(([a], [b]) => a - b)
        .map(([column, cell]) => this.cellXml(`${columnName(column)}${row}`, cell));
      return `<row r="${row}">${cells.join('')}</row>`;
    });
    const merges = this.merges.length ? `<mergeCells count="${this.merges.length}">${this.merges.map((range) => `<mergeCell ref="${range}"/>`).join('')}</mergeCells>` : '';
    return `${XML_DECLARATION}<worksheet xmlns="${MAIN_NS}" xmlns:r="${RELATIONSHIPS_NS}">`
      + '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'
      + `<dimension ref="${this.dimension()}"/>`
      + '<sheetViews><sheetView showGridLines="0" tabSelected="1" workbookViewId="0"/></sheetViews>'
      + '<sheetFormatPr defaultRowHeight="15"/>'
      + `<cols>${columns}</cols><sheetData>${rows.join('')}</sheetData>${merges}`
      + '<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>'
      + `<pageSetup paperSize="9" orientation="${o.landscape ? 'landscape' : 'portrait'}" fitToHeight="0"/>`
      + '<drawing r:id="rId1"/></worksheet>';
  }

  private sharedStringsXml(): string {
    const items = this.sharedStrings.map((text) => `<si><t xml:space="preserve">${escapeXml(text)}</t></si>`);
    return `${XML_DECLARATION}<sst xmlns="${MAIN_NS}" count="${this.stringReferences}" uniqueCount="${this.sharedStrings.length}">${items.join('')}</sst>`;
  }

  private workbookXml(printArea: string): string {
    const absolute = printArea.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2');
    return `${XML_DECLARATION}<workbook xmlns="${MAIN_NS}" xmlns:r="${RELATIONSHIPS_NS}"><workbookPr defaultThemeVersion="124226"/>`
      + '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="20000" windowHeight="10000"/></bookViews>'
      + `<sheets><sheet name="${escapeXml(this.name)}" sheetId="1" r:id="rId1"/></sheets>`
      + `<definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">${escapeXml(`'${this.name}'!${absolute}`)}</definedName></definedNames>`
      + '<calcPr calcId="191029"/></workbook>';
  }

  /** The drawing: the logo picture (`xl/media/image1.png`) over the cells of `range`. */
  private static drawingXml(range: string): string {
    const { from, to } = parseRange(range);
    return `${XML_DECLARATION}<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">`
      + '<xdr:twoCellAnchor editAs="oneCell">'
      + `<xdr:from><xdr:col>${from.column - 1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${from.row - 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>`
      + `<xdr:to><xdr:col>${to.column}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${to.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>`
      + '<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Logo"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>'
      + `<xdr:blipFill><a:blip xmlns:r="${RELATIONSHIPS_NS}" r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>`
      + '<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="609600" cy="571500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>'
      + '<xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>';
  }

  /**
   * The zip of a one-sheet workbook. `printArea` is the sheet's `_xlnm.Print_Area`, and `logo` the range that the
   * logo picture covers.
   */
  toPackage(o: { printArea: string; logo: string; landscape?: boolean }): Uint8Array {
    // The sheet first: writing its cells is what gives the shared strings their indexes.
    const sheet = this.worksheetXml({ landscape: o.landscape ?? false });
    return zipOf({
      '[Content_Types].xml': contentTypesXml({
        'xl/workbook.xml': CONTENT_TYPE.workbook,
        'xl/worksheets/sheet1.xml': CONTENT_TYPE.worksheet,
        'xl/styles.xml': CONTENT_TYPE.excelStyles,
        'xl/sharedStrings.xml': CONTENT_TYPE.sharedStrings,
        'xl/drawings/drawing1.xml': CONTENT_TYPE.drawing,
      }),
      '_rels/.rels': relationshipsXml({ rId1: [REL_TYPE.officeDocument, 'xl/workbook.xml'] }),
      'xl/workbook.xml': this.workbookXml(o.printArea),
      'xl/_rels/workbook.xml.rels': relationshipsXml({
        rId1: [REL_TYPE.worksheet, 'worksheets/sheet1.xml'],
        rId2: [REL_TYPE.styles, 'styles.xml'],
        rId3: [REL_TYPE.sharedStrings, 'sharedStrings.xml'],
      }),
      'xl/worksheets/sheet1.xml': sheet,
      'xl/worksheets/_rels/sheet1.xml.rels': relationshipsXml({ rId1: [REL_TYPE.drawing, '../drawings/drawing1.xml'] }),
      'xl/drawings/drawing1.xml': Sheet.drawingXml(o.logo),
      'xl/drawings/_rels/drawing1.xml.rels': relationshipsXml({ rId1: [REL_TYPE.image, '../media/image1.png'] }),
      'xl/media/image1.png': PNG_1X1,
      'xl/styles.xml': STYLES,
      'xl/sharedStrings.xml': this.sharedStringsXml(),
    });
  }
}

/**
 * The block every form starts with, in rows 1 to 3: the logo's cell, the title, and the form code, revision and page.
 * The ranges say where each goes. The logo itself is the drawing, so its cells stay empty.
 */
export function headerBlock(sheet: Sheet, o: { logo: string; title: string; titleRange: string; code: string; revision: string; formRanges: [string, string, string] }): void {
  const [form, revision, page] = o.formRanges;
  sheet.merge(o.logo, STYLE.cell);
  sheet.merge(o.titleRange, STYLE.title, o.title);
  sheet.merge(form, STYLE.meta, `Form: ${o.code}`);
  sheet.merge(revision, STYLE.meta, `Revision: ${o.revision}`);
  sheet.merge(page, STYLE.meta, 'Page: 1 of 1');
}

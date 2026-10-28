import { describe, expect, it } from 'vitest';
import { readPackage, utf8 } from '../package';
import type { Package } from '../package';
import { parseXml } from '../xml';
import { conditionListXlsx, dayGridXlsx, inventoryXlsx, matrixXlsx } from './excelFixtures';

/*
 * What each Excel fixture holds, so that the tests of detection and writing can rely on it. The XML is read here in
 * the plainest way (by element name), not with the code under test.
 */

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const XDR = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
const all = (root: Document | Element, name: string, ns = MAIN): Element[] => Array.from(root.getElementsByTagNameNS(ns, name));
const part = (pkg: Package, path: string): Document => parseXml(utf8(pkg.entries.get(path)!));

interface Cell { text?: string; number?: number; formula?: string; style: number; numFmt: string; bordered: boolean }

/** The cells of the one sheet, by reference, with their text (from the shared strings), value, formula and format. */
function cellsOf(pkg: Package): Map<string, Cell> {
  const strings = all(part(pkg, 'xl/sharedStrings.xml'), 'si').map((si) => all(si, 't').map((t) => t.textContent).join(''));
  const styles = part(pkg, 'xl/styles.xml');
  const custom = new Map(all(styles, 'numFmt').map((f) => [f.getAttribute('numFmtId')!, f.getAttribute('formatCode')!]));
  const borders = all(all(styles, 'borders')[0]!, 'border');
  const formats = all(all(styles, 'cellXfs')[0]!, 'xf').map((xf) => ({
    numFmt: custom.get(xf.getAttribute('numFmtId')!) ?? `builtin ${xf.getAttribute('numFmtId')}`,
    bordered: all(borders[Number(xf.getAttribute('borderId'))]!, 'left').some((side) => side.getAttribute('style') === 'thin'),
  }));
  const cells = new Map<string, Cell>();
  for (const c of all(part(pkg, 'xl/worksheets/sheet1.xml'), 'c')) {
    const style = Number(c.getAttribute('s') ?? 0);
    const v = all(c, 'v')[0]?.textContent;
    const cell: Cell = { style, ...formats[style]! };
    if (c.getAttribute('t') === 's') cell.text = strings[Number(v)];
    else if (v !== undefined) cell.number = Number(v);
    if (all(c, 'f')[0]) cell.formula = all(c, 'f')[0]!.textContent!;
    cells.set(c.getAttribute('r')!, cell);
  }
  return cells;
}

const merges = (pkg: Package): string[] => all(part(pkg, 'xl/worksheets/sheet1.xml'), 'mergeCell').map((m) => m.getAttribute('ref')!);
const textAt = (cells: Map<string, Cell>, ref: string): string | undefined => cells.get(ref)?.text;
/** An empty cell that is there only for its border and format. */
const isBlank = (cells: Map<string, Cell>, ref: string): boolean => cells.has(ref) && cells.get(ref)!.text === undefined && cells.get(ref)!.number === undefined;

describe('every Excel fixture', () => {
  const builders = { inventoryXlsx, dayGridXlsx, matrixXlsx, conditionListXlsx };

  it.each(Object.entries(builders))('%s: has a print area, a styles part with thin borders, shared strings and one logo drawing', (_name, build) => {
    const pkg = readPackage(build());
    const workbook = part(pkg, 'xl/workbook.xml');
    const sheetName = all(workbook, 'sheet')[0]!.getAttribute('name')!;
    const printArea = all(workbook, 'definedName')[0]!;
    expect(printArea.getAttribute('name')).toBe('_xlnm.Print_Area');
    expect(printArea.getAttribute('localSheetId')).toBe('0');
    expect(printArea.textContent).toMatch(new RegExp(`^'${sheetName}'!\\$A\\$1:\\$[A-Z]+\\$\\d+$`));
    expect(all(workbook, 'calcPr')).toHaveLength(1);

    const styles = part(pkg, 'xl/styles.xml');
    expect(all(styles, 'left').some((side) => side.getAttribute('style') === 'thin')).toBe(true);
    expect(all(all(styles, 'cellXfs')[0]!, 'xf').length).toBeGreaterThan(5);

    const sst = all(part(pkg, 'xl/sharedStrings.xml'), 'sst')[0]!;
    expect(Number(sst.getAttribute('uniqueCount'))).toBe(all(sst, 'si').length);
    const references = all(part(pkg, 'xl/worksheets/sheet1.xml'), 'c').filter((c) => c.getAttribute('t') === 's');
    expect(Number(sst.getAttribute('count'))).toBe(references.length);
    for (const c of references) expect(Number(all(c, 'v')[0]!.textContent)).toBeLessThan(all(sst, 'si').length);

    const drawing = part(pkg, 'xl/drawings/drawing1.xml');
    expect(all(drawing, 'pic', XDR)).toHaveLength(1);
    expect(all(drawing, 'blip', 'http://schemas.openxmlformats.org/drawingml/2006/main')).toHaveLength(1);
    expect(pkg.entries.get('xl/media/image1.png')!.slice(0, 4)).toEqual(Uint8Array.of(0x89, 0x50, 0x4e, 0x47));
  });

  it.each(Object.entries(builders))('%s: has the title, form code, revision and page in rows 1 to 3, over merged cells', (_name, build) => {
    const pkg = readPackage(build());
    const top = [...cellsOf(pkg)].filter(([ref]) => /^[A-Z]+[1-3]$/.test(ref)).map(([, cell]) => cell.text).filter(Boolean);
    expect(top).toEqual([expect.stringMatching(/^Demo /), expect.stringMatching(/^Form: TST-1\d$/), 'Revision: 00 / 01.01.2026', 'Page: 1 of 1']);
    expect(merges(pkg).filter((range) => /^[A-Z]+[1-3]:[A-Z]+3$/.test(range)).length).toBeGreaterThanOrEqual(2);
  });

  it('builds the same bytes every time', () => {
    for (const build of Object.values(builders)) expect(build()).toEqual(build());
  });
});

describe('inventoryXlsx', () => {
  const pkg = readPackage(inventoryXlsx());
  const cells = cellsOf(pkg);

  it('has Vessel: at B6 and Date: at D6, each with an empty bordered cell after it', () => {
    expect([textAt(cells, 'B6'), textAt(cells, 'D6')]).toEqual(['Vessel:', 'Date:']);
    expect(isBlank(cells, 'C6') && cells.get('C6')!.bordered).toBe(true);
    expect(merges(pkg)).toContain('E6:F6');
    expect(isBlank(cells, 'E6') && isBlank(cells, 'F6')).toBe(true);
  });

  it('gives the Date value a date format and the Qty column a number format', () => {
    expect(cells.get('E6')!.numFmt).toBe('dd\\-mmm\\-yyyy');
    expect(cells.get('E9')!.numFmt).toBe('0.0');
    expect(cells.get('E128')!.numFmt).toBe('0.0');
  });

  it('has the header at row 8 and 120 item rows from row 9: the name filled in, the other cells empty and bordered', () => {
    expect(['B', 'C', 'D', 'E', 'F'].map((column) => textAt(cells, `${column}8`))).toEqual(['Description', 'Specification', 'Location', 'Qty', 'Unit']);
    expect(textAt(cells, 'B9')).toBe('Item 001');
    expect(textAt(cells, 'B128')).toBe('Item 120');
    for (const row of [9, 64, 128]) {
      for (const column of ['C', 'D', 'E', 'F']) expect(isBlank(cells, `${column}${row}`) && cells.get(`${column}${row}`)!.bordered, `${column}${row}`).toBe(true);
    }
  });

  it('has a total row with a formula and its cached value, and Signature C/O: below with an empty merged cell', () => {
    expect(textAt(cells, 'B129')).toBe('Total quantity');
    expect(cells.get('E129')).toMatchObject({ formula: 'SUM(E9:E128)', number: 0 });
    expect(textAt(cells, 'B131')).toBe('Signature C/O:');
    expect(merges(pkg)).toContain('C131:D131');
    expect(part(pkg, 'xl/workbook.xml').getElementsByTagNameNS(MAIN, 'definedName')[0]!.textContent).toBe("'Demo inventory'!$A$1:$F$131");
  });

  it('takes the number of item rows', () => {
    const small = cellsOf(readPackage(inventoryXlsx(10)));
    expect(textAt(small, 'B18')).toBe('Item 010');
    expect(small.get('E19')!.formula).toBe('SUM(E9:E18)');
    expect(textAt(small, 'B21')).toBe('Signature C/O:');
    expect(small.has('B19')).toBe(true);
    expect(cellsOf(readPackage(inventoryXlsx(500))).get('E509')!.formula).toBe('SUM(E9:E508)');
  });
});

describe('dayGridXlsx', () => {
  const pkg = readPackage(dayGridXlsx());
  const cells = cellsOf(pkg);

  it('has M/V at A6 with an empty merged cell after it', () => {
    expect(textAt(cells, 'A6')).toBe('M/V');
    expect(merges(pkg)).toContain('B6:E6');
  });

  it('has a two-row header: Hold 1 to Hold 6 over PORT and STBD, 12 value columns, then Remarks', () => {
    expect(textAt(cells, 'A8')).toBe('Day');
    expect(merges(pkg)).toEqual(expect.arrayContaining(['A8:A9', 'N8:N9', 'B8:C8', 'L8:M8']));
    const columns = 'BCDEFGHIJKLM'.split('');
    expect(columns.filter((_, i) => i % 2 === 0).map((c) => textAt(cells, `${c}8`))).toEqual(['Hold 1', 'Hold 2', 'Hold 3', 'Hold 4', 'Hold 5', 'Hold 6']);
    expect(columns.map((c) => textAt(cells, `${c}9`))).toEqual(Array.from({ length: 6 }, () => ['PORT', 'STBD']).flat());
    expect(textAt(cells, 'N8')).toBe('Remarks');
  });

  it('has the days 1 to 31 in A10 to A40, each row with 12 empty value cells and an empty remark', () => {
    expect(cells.get('A10')!.number).toBe(1);
    expect(cells.get('A37')!.number).toBe(28);
    expect(cells.get('A40')!.number).toBe(31);
    expect(cells.has('A41')).toBe(false);
    for (const row of [10, 37, 40]) {
      for (const column of 'BCDEFGHIJKLMN'.split('')) expect(isBlank(cells, `${column}${row}`) && cells.get(`${column}${row}`)!.bordered).toBe(true);
    }
  });

  it('has Dated: (with a date format) and Signed: below the grid', () => {
    expect([textAt(cells, 'A42'), textAt(cells, 'A43')]).toEqual(['Dated:', 'Signed:']);
    expect(merges(pkg)).toEqual(expect.arrayContaining(['B42:E42', 'B43:E43']));
    expect(cells.get('B42')!.numFmt).toBe('builtin 14');
  });
});

describe('matrixXlsx', () => {
  const pkg = readPackage(matrixXlsx());
  const cells = cellsOf(pkg);

  it('has nine equipment titles in B6 to J6 over a blank corner', () => {
    expect(isBlank(cells, 'A6')).toBe(true);
    expect('BCDEFGHIJ'.split('').map((c) => textAt(cells, `${c}6`))).toEqual(Array.from({ length: 9 }, (_, i) => `Equipment ${i + 1}`));
  });

  it('has the attribute names down column A, Dimensions and Schedule merged over two rows', () => {
    expect([7, 8, 9, 10, 11, 12, 13, 14, 15].map((row) => textAt(cells, `A${row}`))).toEqual(
      ['Kind', 'Dimensions', undefined, 'Rating', 'Schedule', undefined, 'Reserve', 'Notes', 'Place'],
    );
    expect(merges(pkg)).toEqual(expect.arrayContaining(['A8:A9', 'A11:A12']));
  });

  it('has empty bordered cells under every title, with number and date formats on some rows', () => {
    for (let row = 7; row <= 15; row += 1) {
      for (const column of 'BCDEFGHIJ'.split('')) expect(isBlank(cells, `${column}${row}`) && cells.get(`${column}${row}`)!.bordered, `${column}${row}`).toBe(true);
    }
    expect([8, 9].map((row) => cells.get(`B${row}`)!.numFmt)).toEqual(['0.0', '0.0']);
    expect([11, 12].map((row) => cells.get(`B${row}`)!.numFmt)).toEqual(['builtin 14', 'dd\\-mmm\\-yyyy']);
    expect(cells.get('B7')!.numFmt).toBe('builtin 0');
  });

  it('has Master: and C/O: at the bottom, each with an empty merged cell', () => {
    expect([textAt(cells, 'A17'), textAt(cells, 'A18')]).toEqual(['Master:', 'C/O:']);
    expect(merges(pkg)).toEqual(expect.arrayContaining(['B17:E17', 'B18:E18']));
  });
});

describe('conditionListXlsx', () => {
  const pkg = readPackage(conditionListXlsx());
  const cells = cellsOf(pkg);

  it('has M/V and Month : labels, each with an empty cell after it', () => {
    expect([textAt(cells, 'A6'), textAt(cells, 'C6')]).toEqual(['M/V', 'Month :']);
    expect(isBlank(cells, 'B6') && isBlank(cells, 'D6')).toBe(true);
  });

  it('has the header No. | Item | Condition | Remarks at row 8', () => {
    expect('ABCD'.split('').map((c) => textAt(cells, `${c}8`))).toEqual(['No.', 'Item', 'Condition', 'Remarks']);
  });

  it('has 100 item rows, each with its number and name filled in and an empty condition and remark', () => {
    expect(cells.get('A9')!.number).toBe(1);
    expect(cells.get('A108')!.number).toBe(100);
    expect(textAt(cells, 'B9')).toBe('Item 001');
    expect(textAt(cells, 'B108')).toBe('Item 100');
    expect(cells.has('A109')).toBe(false);
    for (const row of [9, 57, 108]) expect(isBlank(cells, `C${row}`) && isBlank(cells, `D${row}`)).toBe(true);
  });
});

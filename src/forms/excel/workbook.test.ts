import { describe, expect, it } from 'vitest';
import { bytesOf, partText, readPackage } from '../package';
import { inventoryXlsx } from '../testing/excelFixtures';
import { cellLoc, columnLetters, columnNumber, parseCellLoc } from './refs';
import { dateHintOf, kindOfFormat } from './numFmt';
import { loadWorkbook, parsePrintArea } from './workbook';

const SHEET = 'xl/worksheets/sheet1.xml';

describe('loadWorkbook', () => {
  it('reads the sheet, its cells, formats, merges and print area', () => {
    const wb = loadWorkbook(readPackage(inventoryXlsx(10)));
    expect(wb.date1904).toBe(false);
    expect(wb.sheets).toHaveLength(1);
    const sheet = wb.sheets[0]!;
    expect({ name: sheet.name, path: sheet.path, hidden: sheet.hidden, printArea: sheet.printArea }).toEqual({
      name: 'Demo inventory', path: SHEET, hidden: false, printArea: 'A1:F21',
    });
    expect(sheet.merges).toEqual(['A1:B3', 'C1:D3', 'E1:F1', 'E2:F2', 'E3:F3', 'E6:F6', 'C21:D21']);
    expect(sheet.cells.get('B6')).toMatchObject({ ref: 'B6', row: 6, col: 2, text: 'Vessel:', styleId: 1, bordered: false, bold: true });
    expect(sheet.cells.get('C6')).toMatchObject({ ref: 'C6', text: '', styleId: 4, bordered: true });
    expect(sheet.cells.get('C6')!.formula).toBeUndefined();
    expect(sheet.cells.get('E6')).toMatchObject({ numFmtId: 164, numFmt: 'dd\\-mmm\\-yyyy' });
    expect(sheet.cells.get('E9')).toMatchObject({ numFmtId: 165, numFmt: '0.0' });
    expect(sheet.cells.get('E19')).toMatchObject({ text: '0', formula: 'SUM(E9:E18)' });
    expect(sheet.cells.get('C1')).toMatchObject({ text: 'Demo Inventory', fontSize: 14 });
    expect(sheet.hiddenRows.size).toBe(0);
    expect(sheet.hiddenCols.size).toBe(0);
  });

  it('reads inline strings, formula strings, rich text, escapes, hidden rows and columns, and the 1904 date system', () => {
    const pkg = readPackage(inventoryXlsx(3));
    const sheet = partText(pkg, SHEET)!
      .replace('<col min="3" max="3" width="22" customWidth="1"/>', '<col min="3" max="4" width="22" customWidth="1" hidden="1"/>')
      .replace('<row r="9">', '<row r="9" hidden="true">')
      .replace('<c r="C6" s="4"/>', '<c r="C6" s="4" t="inlineStr"><is><r><t>A</t></r><r><t xml:space="preserve"> b</t></r></is></c>')
      .replace('<c r="C10" s="4"/>', '<c r="C10" s="4" t="str"><f>"x"&amp;"y"</f><v>xy</v></c>');
    pkg.entries.set(SHEET, bytesOf(sheet));
    pkg.entries.set('xl/sharedStrings.xml', bytesOf(partText(pkg, 'xl/sharedStrings.xml')!.replace(
      '<si><t xml:space="preserve">Vessel:</t></si>',
      '<si><r><t>Ves_x0073_el</t></r><r><t>:</t></r><rPh sb="0" eb="1"><t>phonetic</t></rPh></si>',
    )));
    pkg.entries.set('xl/workbook.xml', bytesOf(partText(pkg, 'xl/workbook.xml')!.replace('<workbookPr ', '<workbookPr date1904="1" ')));
    const wb = loadWorkbook(pkg);
    const s = wb.sheets[0]!;
    expect(wb.date1904).toBe(true);
    expect(s.cells.get('B6')!.text).toBe('Vessel:');
    expect(s.cells.get('C6')!.text).toBe('A b');
    expect(s.cells.get('C10')).toMatchObject({ text: 'xy', formula: '"x"&"y"' });
    expect([...s.hiddenCols]).toEqual([3, 4]);
    expect([...s.hiddenRows]).toEqual([9]);
  });
});

describe('parsePrintArea', () => {
  it('keeps the ranges of its own sheet, without $ and quotes, and whole rows or columns as ranges', () => {
    expect(parsePrintArea("'Demo inventory'!$A$1:$F$131", 'Demo inventory')).toBe('A1:F131');
    expect(parsePrintArea("'It''s'!$A$1:$B$2,'It''s'!$D$4", "It's")).toBe('A1:B2,D4');
    expect(parsePrintArea('Sheet1!$A:$C,Sheet1!$1:$2', 'Sheet1')).toBe('A1:C1048576,A1:XFD2');
    expect(parsePrintArea('Other!$A$1:$B$2', 'Sheet1')).toBeUndefined();
    expect(parsePrintArea('#REF!', 'Sheet1')).toBeUndefined();
  });
});

describe('number formats', () => {
  it('says which formats are dates, times and numbers', () => {
    expect(kindOfFormat(14, undefined)).toBe('date');
    expect(kindOfFormat(22, undefined)).toBe('date');
    expect(kindOfFormat(20, undefined)).toBe('time');
    expect(kindOfFormat(0, undefined)).toBe('text');
    expect(kindOfFormat(49, '@')).toBe('text');
    expect(kindOfFormat(2, undefined)).toBe('number');
    expect(kindOfFormat(164, 'dd\\-mmm\\-yyyy')).toBe('date');
    expect(kindOfFormat(170, '[$-409]d/m/yy;@')).toBe('date');
    expect(kindOfFormat(171, '"Day "0')).toBe('number');
    expect(kindOfFormat(172, '[h]:mm')).toBe('time');
    expect(kindOfFormat(173, '"dmy"@')).toBe('text');
    expect(kindOfFormat(174, '#,##0.00')).toBe('number');
    // R15: a code with both a date and a time is a date.
    expect(kindOfFormat(175, 'dd/mm hh:mm')).toBe('date');
    expect(kindOfFormat(176, 'd/m/yyyy h:mm')).toBe('date');
  });

  it('gives a date format as a hint formatDate can render, or nothing', () => {
    expect(dateHintOf('dd\\-mmm\\-yyyy')).toBe('dd-mmm-yyyy');
    expect(dateHintOf('dd/mm/yyyy;@')).toBe('dd/mm/yyyy');
    expect(dateHintOf('[$-809]dd mmmm yyyy')).toBe('dd mmmm yyyy');
    expect(dateHintOf('d/m/yy h:mm')).toBeUndefined();
    expect(dateHintOf('dd "de" mmmm yyyy')).toBeUndefined();
    expect(dateHintOf('mmmmm yy')).toBeUndefined();
    expect(dateHintOf('yyy-mm-dd')).toBeUndefined();
    expect(dateHintOf('0.0')).toBeUndefined();
  });
});

describe('cell references', () => {
  it('turns column numbers into letters and back, and makes and reads a cell address', () => {
    expect([1, 26, 27, 702, 703, 16384].map(columnLetters)).toEqual(['A', 'Z', 'AA', 'ZZ', 'AAA', 'XFD']);
    expect(['A', 'Z', 'AA', 'XFD'].map(columnNumber)).toEqual([1, 26, 27, 16384]);
    expect(cellLoc(SHEET, 3, 6)).toBe(`${SHEET}!C6`);
    expect(parseCellLoc(`${SHEET}!C6`)).toEqual({ part: SHEET, ref: 'C6', row: 6, col: 3 });
  });
});

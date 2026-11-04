import { STYLE, Sheet, columnName, headerBlock } from './excelXml';
import type { StyleId } from './excelXml';

/*
 * Synthetic Excel forms for the tests of the forms engine. Every text in them is invented: the only words they share
 * with real forms are generic ones (Vessel, Date, Signature). The package, styles and cell XML come from
 * `excelXml.ts`; each builder here only lays out its sheet. Every sheet starts with a header block in rows 1 to 3
 * (logo, title, `Form:`, `Revision:`, `Page:`), has its labels in row 6 and a print area.
 */

const REVISION = '00 / 01.01.2026';

/**
 * `TST-11 Demo Inventory`, columns A to F: `Vessel:` (B6) and `Date:` (D6) with an empty cell after each, a header at
 * row 8 (B to F), `rows` item rows from row 9 (the name in B, the rest empty and bordered, Qty with a number format),
 * a total row with a formula, and `Signature C/O:` two rows below it.
 */
export function inventoryXlsx(rows = 120): Uint8Array {
  const sheet = new Sheet('Demo inventory').columnWidths(2.7, 34, 22, 18, 12, 12);
  headerBlock(sheet, {
    logo: 'A1:B3', title: 'Demo Inventory', titleRange: 'C1:D3', code: 'TST-11', revision: REVISION, formRanges: ['E1:F1', 'E2:F2', 'E3:F3'],
  });
  sheet.set('B6', 'Vessel:', STYLE.label).blank('C6', STYLE.cell);
  sheet.set('D6', 'Date:', STYLE.label).merge('E6:F6', STYLE.date);

  ['Description', 'Specification', 'Location', 'Qty', 'Unit'].forEach((title, i) => sheet.set(`${columnName(2 + i)}8`, title, STYLE.header));
  for (let i = 1; i <= rows; i += 1) {
    const row = 8 + i;
    sheet.set(`B${row}`, `Item ${String(i).padStart(3, '0')}`, STYLE.bold);
    sheet.blank(`C${row}:D${row}`, STYLE.cell).blank(`E${row}`, STYLE.number).blank(`F${row}`, STYLE.cell);
  }

  const total = 9 + rows;
  sheet.set(`B${total}`, 'Total quantity', STYLE.bold).set(`E${total}`, { formula: `SUM(E9:E${8 + rows})`, value: 0 }, STYLE.number);
  const signature = total + 2;
  sheet.set(`B${signature}`, 'Signature C/O:', STYLE.label).merge(`C${signature}:D${signature}`, STYLE.cell);

  return sheet.toPackage({ printArea: `A1:F${signature}`, logo: 'A1:B3' });
}

/**
 * `TST-12 Demo Day Grid`, columns A to N: `M/V` (A6) with an empty merged cell after it; a two-row header (rows 8 and
 * 9) of `Day`, `Hold 1` to `Hold 6` each over `PORT` and `STBD`, and `Remarks`; the days 1 to 31 down column A (rows
 * 10 to 40) with 12 empty value cells and an empty remark each; then `Dated:` and `Signed:`.
 */
export function dayGridXlsx(options: { looseHeader?: boolean } = {}): Uint8Array {
  if (options.looseHeader) return looseDayGridXlsx();
  const sheet = new Sheet('Demo day grid').columnWidths(9, ...Array<number>(12).fill(8), 28);
  headerBlock(sheet, {
    logo: 'A1:B3', title: 'Demo Day Grid', titleRange: 'C1:J3', code: 'TST-12', revision: REVISION, formRanges: ['K1:N1', 'K2:N2', 'K3:N3'],
  });
  sheet.set('A6', 'M/V', STYLE.label).merge('B6:E6', STYLE.cell);

  sheet.merge('A8:A9', STYLE.header, 'Day').merge('N8:N9', STYLE.header, 'Remarks');
  for (let hold = 1; hold <= 6; hold += 1) {
    const port = columnName(2 * hold);
    const starboard = columnName(2 * hold + 1);
    sheet.merge(`${port}8:${starboard}8`, STYLE.header, `Hold ${hold}`);
    sheet.set(`${port}9`, 'PORT', STYLE.header).set(`${starboard}9`, 'STBD', STYLE.header);
  }
  for (let day = 1; day <= 31; day += 1) {
    const row = 9 + day;
    sheet.set(`A${row}`, day, STYLE.centered).blank(`B${row}:M${row}`, STYLE.cell).blank(`N${row}`, STYLE.wrapped);
  }

  sheet.set('A42', 'Dated:', STYLE.label).merge('B42:E42', STYLE.dateShort);
  sheet.set('A43', 'Signed:', STYLE.label).merge('B43:E43', STYLE.cell);

  return sheet.toPackage({ printArea: 'A1:N43', logo: 'A1:B3', landscape: true });
}

/**
 * `dayGridXlsx({ looseHeader: true })`: `TST-12 Demo Day Grid` laid out more loosely, columns A to L, as a day grid
 * drawn by hand often is:
 * - the corner A8 is an empty bordered cell, and `Day` sits under it in A9;
 * - `Tank 1` (B8:D8) is over `PORT`, `STBD` and `Centre`; `Tank 2` (E8:F8) over `PORT` and `STBD`;
 * - `Tank 3` (G8:J8) is over `PORT` (G9:H9) and `STBD` (I9:J9), and its value cells are merged in pairs the same way;
 * - `Remarks` (K8:L8) is over an empty merged cell (K9:L9), and its value cells are merged across K:L;
 * - the days 1 to 31 down column A (rows 10 to 40), with number cells, then `Dated:` and `Signed:`.
 */
function looseDayGridXlsx(): Uint8Array {
  const sheet = new Sheet('Demo day grid').columnWidths(9, ...Array<number>(9).fill(8), 14, 14);
  headerBlock(sheet, {
    logo: 'A1:B3', title: 'Demo Day Grid', titleRange: 'C1:H3', code: 'TST-12', revision: REVISION, formRanges: ['I1:L1', 'I2:L2', 'I3:L3'],
  });
  sheet.set('A6', 'M/V', STYLE.label).merge('B6:E6', STYLE.cell);

  sheet.set('A8', undefined, STYLE.header).set('A9', 'Day', STYLE.header);
  sheet.merge('B8:D8', STYLE.header, 'Tank 1').set('B9', 'PORT', STYLE.header).set('C9', 'STBD', STYLE.header).set('D9', 'Centre', STYLE.header);
  sheet.merge('E8:F8', STYLE.header, 'Tank 2').set('E9', 'PORT', STYLE.header).set('F9', 'STBD', STYLE.header);
  sheet.merge('G8:J8', STYLE.header, 'Tank 3').merge('G9:H9', STYLE.header, 'PORT').merge('I9:J9', STYLE.header, 'STBD');
  sheet.merge('K8:L8', STYLE.header, 'Remarks').merge('K9:L9', STYLE.header);
  for (let day = 1; day <= 31; day += 1) {
    const row = 9 + day;
    sheet.set(`A${row}`, day, STYLE.centered).blank(`B${row}:F${row}`, STYLE.number);
    sheet.merge(`G${row}:H${row}`, STYLE.number).merge(`I${row}:J${row}`, STYLE.number).merge(`K${row}:L${row}`, STYLE.wrapped);
  }

  sheet.set('A42', 'Dated:', STYLE.label).merge('B42:E42', STYLE.dateShort);
  sheet.set('A43', 'Signed:', STYLE.label).merge('B43:E43', STYLE.cell);

  return sheet.toPackage({ printArea: 'A1:L43', logo: 'A1:B3', landscape: true });
}

/**
 * `TST-13 Demo Matrix`, columns A to J: nine equipment titles in row 6 (B to J), the attribute names down column A
 * (rows 7 to 15, `Dimensions` and `Schedule` each merged over two rows), empty bordered cells under every title (a number
 * format on `Dimensions`, two date formats on `Schedule`), then `Master:` and `C/O:`.
 */
export function matrixXlsx(options: { subTitles?: boolean } = {}): Uint8Array {
  if (options.subTitles) return subTitledMatrixXlsx();
  const sheet = new Sheet('Demo matrix').columnWidths(22, ...Array<number>(9).fill(14));
  headerBlock(sheet, {
    logo: 'A1:A3', title: 'Demo Matrix', titleRange: 'B1:E3', code: 'TST-13', revision: REVISION, formRanges: ['F1:J1', 'F2:J2', 'F3:J3'],
  });

  sheet.set('A6', undefined, STYLE.header);
  for (let i = 1; i <= 9; i += 1) sheet.set(`${columnName(1 + i)}6`, `Equipment ${i}`, STYLE.header);

  const data = (row: number, style: StyleId) => sheet.blank(`B${row}:J${row}`, style);
  sheet.set('A7', 'Kind', STYLE.bold);
  data(7, STYLE.cell);
  sheet.merge('A8:A9', STYLE.bold, 'Dimensions');
  data(8, STYLE.number);
  data(9, STYLE.number);
  sheet.set('A10', 'Rating', STYLE.bold);
  data(10, STYLE.cell);
  sheet.merge('A11:A12', STYLE.bold, 'Schedule');
  data(11, STYLE.dateShort);
  data(12, STYLE.date);
  sheet.set('A13', 'Reserve', STYLE.bold);
  data(13, STYLE.cell);
  sheet.set('A14', 'Notes', STYLE.bold);
  data(14, STYLE.wrapped);
  sheet.set('A15', 'Place', STYLE.bold);
  data(15, STYLE.cell);

  sheet.set('A17', 'Master:', STYLE.label).merge('B17:E17', STYLE.cell);
  sheet.set('A18', 'C/O:', STYLE.label).merge('B18:E18', STYLE.cell);

  return sheet.toPackage({ printArea: 'A1:J18', logo: 'A1:A3', landscape: true });
}

/**
 * `matrixXlsx({ subTitles: true })`: `TST-13 Demo Matrix` with titles two columns wide, columns A to G. `Unit 1` (B6:C6),
 * `Unit 2` (D6:E6) and `Unit 3` (F6:G6) over a second title row where only `Unit 2` has words (`Fore side`, D7:E7) and
 * the others are empty merged cells; the attribute names down column A (rows 8 to 10: `Kind`, `Length` with a number
 * format, `Due` with a date format) beside value cells merged two columns wide; then `Master:`.
 */
function subTitledMatrixXlsx(): Uint8Array {
  const sheet = new Sheet('Demo matrix').columnWidths(22, ...Array<number>(6).fill(10));
  headerBlock(sheet, {
    logo: 'A1:A3', title: 'Demo Matrix', titleRange: 'B1:D3', code: 'TST-13', revision: REVISION, formRanges: ['E1:G1', 'E2:G2', 'E3:G3'],
  });
  sheet.set('A6', undefined, STYLE.header).set('A7', undefined, STYLE.header);
  sheet.merge('B6:C6', STYLE.header, 'Unit 1').merge('D6:E6', STYLE.header, 'Unit 2').merge('F6:G6', STYLE.header, 'Unit 3');
  sheet.merge('B7:C7', STYLE.header).merge('D7:E7', STYLE.header, 'Fore side').merge('F7:G7', STYLE.header);
  const values = (row: number, style: StyleId) => {
    for (const [from, to] of [['B', 'C'], ['D', 'E'], ['F', 'G']]) sheet.merge(`${from}${row}:${to}${row}`, style);
  };
  sheet.set('A8', 'Kind', STYLE.bold);
  values(8, STYLE.cell);
  sheet.set('A9', 'Length', STYLE.bold);
  values(9, STYLE.number);
  sheet.set('A10', 'Due', STYLE.bold);
  values(10, STYLE.date);

  sheet.set('A12', 'Master:', STYLE.label).merge('B12:D12', STYLE.cell);
  return sheet.toPackage({ printArea: 'A1:G12', logo: 'A1:A3' });
}

/**
 * `TST-14 Demo Conditions`, columns A to D: `M/V` (A6) and `Month :` (C6) with an empty cell after each; a header at
 * row 8 (`No.`, `Item`, `Condition`, `Remarks`); 100 item rows from row 9, each with its number and name filled in and
 * an empty condition and remark.
 */
export function conditionListXlsx(): Uint8Array {
  const sheet = new Sheet('Demo conditions').columnWidths(9, 42, 18, 36);
  headerBlock(sheet, {
    logo: 'A1:A3', title: 'Demo Conditions', titleRange: 'B1:C3', code: 'TST-14', revision: REVISION, formRanges: ['D1', 'D2', 'D3'],
  });
  sheet.set('A6', 'M/V', STYLE.label).blank('B6', STYLE.cell);
  sheet.set('C6', 'Month :', STYLE.label).blank('D6', STYLE.cell);

  ['No.', 'Item', 'Condition', 'Remarks'].forEach((title, i) => sheet.set(`${columnName(1 + i)}8`, title, STYLE.header));
  for (let i = 1; i <= 100; i += 1) {
    const row = 8 + i;
    sheet.set(`A${row}`, i, STYLE.centered).set(`B${row}`, `Item ${String(i).padStart(3, '0')}`, STYLE.cell);
    sheet.blank(`C${row}`, STYLE.cell).blank(`D${row}`, STYLE.wrapped);
  }

  return sheet.toPackage({ printArea: 'A1:D108', logo: 'A1:A3' });
}

import { describe, expect, it } from 'vitest';
import { bytesOf, partText, readPackage } from '../package';
import type { Package } from '../package';
import { conditionListXlsx, dayGridXlsx, inventoryXlsx, matrixXlsx } from '../testing/excelFixtures';
import { STYLE, Sheet, headerBlock } from '../testing/excelXml';
import type { FieldDef, FormSchema, RowGroupDef } from '../types';
import { detectExcel } from './detect';

const SHEET = 'xl/worksheets/sheet1.xml';
const WORKBOOK = 'xl/workbook.xml';
const STRINGS = 'xl/sharedStrings.xml';
const DOT = '·';

const detect = (bytes: Uint8Array | Package, name = 'form.xlsx'): FormSchema =>
  detectExcel(bytes instanceof Uint8Array ? readPackage(bytes) : bytes, name);

const byLabel = (s: FormSchema, label: string): FieldDef => {
  const found = s.fields.find((f) => f.label === label);
  if (!found) throw new Error(`no field ${label} in ${s.fields.map((f) => f.label).join(', ')}`);
  return found;
};

/** A fixture's package with some of its parts changed by text edits, as a person's own Excel file might differ. */
function edited(bytes: Uint8Array, edits: Record<string, (xml: string) => string>): Package {
  const pkg = readPackage(bytes);
  for (const [path, change] of Object.entries(edits)) {
    const before = partText(pkg, path)!;
    const after = change(before);
    if (after === before) throw new Error(`the edit of ${path} changed nothing`);
    pkg.entries.set(path, bytesOf(after));
  }
  return pkg;
}

/** Sets a cell's content in the sheet XML: replaces the `<c r="ref" .../>` or `<c r="ref" ...>...</c>` element. */
function setCell(xml: string, ref: string, cell: string): string {
  return xml.replace(new RegExp(`<c r="${ref}"[^>]*?(?:/>|>.*?</c>)`), cell);
}

/** A small sheet with the usual header block in rows 1 to 3 (columns A to D), for a layout the fixtures lack. */
function probeSheet(name: string): Sheet {
  const sheet = new Sheet(name);
  headerBlock(sheet, { logo: 'A1:A3', title: 'Probe form', titleRange: 'B1:C3', code: 'TST-90', revision: '00', formRanges: ['D1', 'D2', 'D3'] });
  return sheet;
}

const fieldSummary = (f: FieldDef) => ({
  id: f.id, kind: f.kind, label: f.label, loc: f.loc,
  ...(f.formatHint ? { formatHint: f.formatHint } : {}), ...(f.leftEmpty ? { leftEmpty: true } : {}),
});

describe('detectExcel on the fixtures (the brief\'s tests)', () => {
  it('finds Vessel and Date, and the inventory rows without the formula total row', () => {
    const s = detect(inventoryXlsx(120), 'inventory.xlsx');
    expect(s.kind).toBe('xlsx');
    const vessel = byLabel(s, 'Vessel');
    expect(vessel.loc).toBe(`${SHEET}!C6`);
    expect(byLabel(s, 'Date').kind).toBe('date');

    expect(s.rowGroups).toHaveLength(1);
    const g = s.rowGroups[0]!;
    expect(g.rowLabels).toHaveLength(120);
    expect(g.rowLabels!.slice(0, 2)).toEqual(['Item 001', 'Item 002']);
    expect(g.columns.map((c) => c.label)).toEqual(['Specification', 'Location', 'Qty', 'Unit']);
    expect(g.capacity).toBe(120);
    expect(g.firstRow).toBe(9);
    // The total row (129) holds the formula: it is neither a row of the group nor a field.
    expect(g.firstRow! + g.capacity - 1).toBe(128);
    expect(s.fields.some((f) => /!(?:[A-Z]+)129$/.test(f.loc))).toBe(false);
  });

  it('makes the day grid a dayGrid of 31 rows with two-row header labels', () => {
    const s = detect(dayGridXlsx(), 'daygrid.xlsx');
    expect(s.rowGroups).toHaveLength(1);
    const g = s.rowGroups[0]!;
    expect(g.shape).toBe('dayGrid');
    expect(g.rowLabels).toHaveLength(31);
    expect(g.rowLabels![27]).toBe('28');
    expect(g.columns.map((c) => c.label)).toContain('Hold 1 PORT');
  });

  it('merged_label_cells: labels a matrix cell by its column title and the merged attribute name', () => {
    const s = detect(matrixXlsx(), 'matrix.xlsx');
    const dims = s.fields.filter((f) => f.label === `Equipment 1 ${DOT} Dimensions`);
    expect(dims.map((f) => f.loc)).toEqual([`${SHEET}!B8`, `${SHEET}!B9`]);
    expect(dims.every((f) => f.kind === 'number')).toBe(true);
    expect(byLabel(s, `Equipment 9 ${DOT} Schedule`).kind).toBe('date');
    // Nothing is left without a label, and no label is a neighbour's.
    expect(s.fields.every((f) => f.label !== '' && f.confidence === 'high')).toBe(true);
  });

  it('makes the condition list a checklist of 100 rows', () => {
    const s = detect(conditionListXlsx(), 'conditions.xlsx');
    expect(s.rowGroups).toHaveLength(1);
    const g = s.rowGroups[0]!;
    expect(g.shape).toBe('checklist');
    expect(g.capacity).toBe(100);
    expect(g.rowLabels).toHaveLength(100);
  });

  it('large_grid_under_1s: detects a 500-row inventory and the day grid in under a second each', () => {
    const big = readPackage(inventoryXlsx(500));
    const grid = readPackage(dayGridXlsx());
    for (const pkg of [big, grid]) {
      const start = performance.now();
      const s = detectExcel(pkg, 'big.xlsx');
      expect(performance.now() - start).toBeLessThan(1000);
      expect(s.rowGroups).toHaveLength(1);
    }
    expect(detectExcel(big, 'big.xlsx').rowGroups[0]!.capacity).toBe(500);
  });
});

describe('detectExcel: the schema of each fixture', () => {
  it('inventory: ids, addresses, kinds and the signature', () => {
    const s = detect(inventoryXlsx(120), 'inventory.xlsx');
    expect(s.identity).toEqual({ code: 'TST-11', title: 'Demo Inventory', revision: '00 / 01.01.2026' });
    expect(s.fields.map(fieldSummary)).toEqual([
      { id: 'Demo inventory!C6', kind: 'text', label: 'Vessel', loc: `${SHEET}!C6` },
      // The cell's own format `dd\-mmm\-yyyy`, as formatDate reads it.
      { id: 'Demo inventory!E6', kind: 'date', label: 'Date', loc: `${SHEET}!E6`, formatHint: 'dd-mmm-yyyy' },
      { id: 'Demo inventory!C131', kind: 'text', label: 'Signature C/O', loc: `${SHEET}!C131`, leftEmpty: true },
    ]);
    expect(s.fields.every((f) => f.section === '' && f.confidence === 'high')).toBe(true);

    const g = s.rowGroups[0]!;
    expect({ ...g, columns: undefined, rowLabels: undefined }).toEqual({
      id: 'Demo inventory!g1', label: 'Table 1', section: '', loc: `${SHEET}!C9`, firstRow: 9,
      columns: undefined, capacity: 120, growable: false, rowLabels: undefined, shape: 'rows',
    });
    expect(g.columns.map((c) => [c.id, c.kind, c.label, c.loc])).toEqual([
      ['Demo inventory!g1.C', 'text', 'Specification', 'C'],
      ['Demo inventory!g1.D', 'text', 'Location', 'D'],
      ['Demo inventory!g1.E', 'number', 'Qty', 'E'],
      ['Demo inventory!g1.F', 'text', 'Unit', 'F'],
    ]);
    expect(g.fixedRows).toBeUndefined();
    expect(s.unsupported).toEqual([]);
  });

  it('day grid: M/V, Dated and Signed, and 13 columns from B to N', () => {
    const s = detect(dayGridXlsx(), 'daygrid.xlsx');
    expect(s.identity).toEqual({ code: 'TST-12', title: 'Demo Day Grid', revision: '00 / 01.01.2026' });
    expect(s.fields.map(fieldSummary)).toEqual([
      { id: 'Demo day grid!B6', kind: 'text', label: 'M/V', loc: `${SHEET}!B6` },
      // Built-in format 14 is a date, written as the locale shows it, so no hint is kept.
      { id: 'Demo day grid!B42', kind: 'date', label: 'Dated', loc: `${SHEET}!B42` },
      { id: 'Demo day grid!B43', kind: 'text', label: 'Signed', loc: `${SHEET}!B43`, leftEmpty: true },
    ]);
    const g = s.rowGroups[0]!;
    expect(g.loc).toBe(`${SHEET}!B10`);
    expect(g.firstRow).toBe(10);
    expect(g.capacity).toBe(31);
    expect(g.columns.map((c) => c.label)).toEqual([
      'Hold 1 PORT', 'Hold 1 STBD', 'Hold 2 PORT', 'Hold 2 STBD', 'Hold 3 PORT', 'Hold 3 STBD',
      'Hold 4 PORT', 'Hold 4 STBD', 'Hold 5 PORT', 'Hold 5 STBD', 'Hold 6 PORT', 'Hold 6 STBD', 'Remarks',
    ]);
    expect(g.columns.map((c) => c.loc)).toEqual(['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N']);
    expect(g.rowLabels).toEqual(Array.from({ length: 31 }, (_, i) => String(i + 1)));
    // Day 28 is row 37.
    expect(g.firstRow! + 27).toBe(37);
  });

  it('matrix: one field for each empty cell, with the kind of its own format, and no row group', () => {
    const s = detect(matrixXlsx(), 'matrix.xlsx');
    expect(s.identity).toEqual({ code: 'TST-13', title: 'Demo Matrix', revision: '00 / 01.01.2026' });
    expect(s.rowGroups).toEqual([]);
    const cells = s.fields.filter((f) => f.label.includes(DOT));
    expect(cells).toHaveLength(81);
    expect(cells.slice(0, 2).map(fieldSummary)).toEqual([
      { id: 'Demo matrix!B7', kind: 'text', label: `Equipment 1 ${DOT} Kind`, loc: `${SHEET}!B7` },
      { id: 'Demo matrix!C7', kind: 'text', label: `Equipment 2 ${DOT} Kind`, loc: `${SHEET}!C7` },
    ]);
    expect(fieldSummary(s.fields.find((f) => f.id === 'Demo matrix!B11')!)).toEqual(
      { id: 'Demo matrix!B11', kind: 'date', label: `Equipment 1 ${DOT} Schedule`, loc: `${SHEET}!B11` },
    );
    expect(fieldSummary(s.fields.find((f) => f.id === 'Demo matrix!B12')!)).toEqual(
      { id: 'Demo matrix!B12', kind: 'date', label: `Equipment 1 ${DOT} Schedule`, loc: `${SHEET}!B12`, formatHint: 'dd-mmm-yyyy' },
    );
    expect(byLabel(s, `Equipment 5 ${DOT} Notes`).id).toBe('Demo matrix!F14');
    expect(s.fields.slice(-2).map(fieldSummary)).toEqual([
      { id: 'Demo matrix!B17', kind: 'text', label: 'Master', loc: `${SHEET}!B17` },
      { id: 'Demo matrix!B18', kind: 'text', label: 'C/O', loc: `${SHEET}!B18` },
    ]);
  });

  it('matrix: every cell of the matrix carries the matrix as its block, and no other field has one (R14)', () => {
    const s = detect(matrixXlsx(), 'matrix.xlsx');
    const inBlock = s.fields.filter((f) => f.block !== undefined);
    expect(inBlock).toHaveLength(81);
    expect(new Set(inBlock.map((f) => f.block))).toEqual(new Set(['Demo matrix!m1']));
    expect(s.fields.filter((f) => f.block === undefined).map((f) => f.label)).toEqual(['Master', 'C/O']);
    for (const make of [() => inventoryXlsx(5), dayGridXlsx, conditionListXlsx]) {
      const other = detect(make());
      expect([...other.fields, ...other.rowGroups.flatMap((g) => g.columns)].some((f) => f.block !== undefined)).toBe(false);
    }
  });

  it('condition list: M/V and Month, and the Condition and Remarks columns', () => {
    const s = detect(conditionListXlsx(), 'conditions.xlsx');
    expect(s.identity).toEqual({ code: 'TST-14', title: 'Demo Conditions', revision: '00 / 01.01.2026' });
    expect(s.fields.map(fieldSummary)).toEqual([
      { id: 'Demo conditions!B6', kind: 'text', label: 'M/V', loc: `${SHEET}!B6` },
      // `Month :` keeps its visible case and loses the colon and the space before it.
      { id: 'Demo conditions!D6', kind: 'text', label: 'Month', loc: `${SHEET}!D6` },
    ]);
    const g = s.rowGroups[0]!;
    expect(g.columns.map((c) => [c.label, c.loc])).toEqual([['Condition', 'C'], ['Remarks', 'D']]);
    expect(g.firstRow).toBe(9);
    expect(g.rowLabels!.slice(0, 2)).toEqual(['1 Item 001', '2 Item 002']);
  });

  it('gives the same schema every time', () => {
    for (const make of [() => inventoryXlsx(30), dayGridXlsx, matrixXlsx, conditionListXlsx]) {
      expect(detect(make())).toEqual(detect(make()));
    }
  });
});

describe('detectExcel rules', () => {
  it('reads a label from a rich-text shared string and from an inline string, with spaces after the colon', () => {
    const pkg = edited(inventoryXlsx(5), {
      [STRINGS]: (xml) => xml.replace('<si><t xml:space="preserve">Vessel:</t></si>', '<si><r><t>Ves</t></r><r><rPr><b/></rPr><t xml:space="preserve">sel:  </t></r></si>'),
      [SHEET]: (xml) => setCell(xml, 'D6', '<c r="D6" s="1" t="inlineStr"><is><t xml:space="preserve">Date:   </t></is></c>'),
    });
    const s = detect(pkg);
    expect(byLabel(s, 'Vessel').loc).toBe(`${SHEET}!C6`);
    expect(byLabel(s, 'Date').loc).toBe(`${SHEET}!E6`);
  });

  it('leaves alone a label whose cell to the right holds a value or a formula', () => {
    const bytes = inventoryXlsx(5);
    const pkg = edited(bytes, {
      [SHEET]: (xml) => setCell(setCell(xml, 'C6', '<c r="C6" s="4" t="inlineStr"><is><t>Demo Star</t></is></c>'), 'E6', '<c r="E6" s="5"><f>TODAY()</f><v>46000</v></c>'),
    });
    const s = detect(pkg);
    expect(s.fields.map((f) => f.label)).toEqual(['Signature C/O']);
  });

  it('keeps out hidden rows, hidden columns and cells outside the print area', () => {
    const bytes = inventoryXlsx(10);
    const pkg = edited(bytes, {
      // Column D (Location) is hidden, row 6 (Vessel and Date) is hidden, and the print area ends before the signature.
      [SHEET]: (xml) => xml
        .replace('<col min="4" max="4" width="18" customWidth="1"/>', '<col min="4" max="4" width="18" customWidth="1" hidden="1"/>')
        .replace('<row r="6">', '<row r="6" hidden="1">'),
      [WORKBOOK]: (xml) => xml.replace('$A$1:$F$21', '$A$1:$F$19'),
    });
    const s = detect(pkg);
    expect(s.fields).toEqual([]);
    expect(s.rowGroups[0]!.columns.map((c) => c.label)).toEqual(['Specification', 'Qty', 'Unit']);
  });

  it('reads a print area of several ranges, with a quoted sheet name, and leaves out what is outside them', () => {
    const pkg = edited(inventoryXlsx(10), {
      // Rows 1 to 13 (the labels, the header and items 1 to 5) and rows 20 to 21 (the signature): the table ends where
      // the first range does.
      [WORKBOOK]: (xml) => xml.replace('\'Demo inventory\'!$A$1:$F$21', '\'Demo inventory\'!$A$1:$F$13,\'Demo inventory\'!$A$20:$F$21'),
    });
    const s = detect(pkg);
    expect(s.rowGroups.map((g) => [g.firstRow, g.capacity])).toEqual([[9, 5]]);
    expect(s.rowGroups[0]!.rowLabels).toEqual(['Item 001', 'Item 002', 'Item 003', 'Item 004', 'Item 005']);
    expect(s.fields.map((f) => f.label)).toEqual(['Vessel', 'Date', 'Signature C/O']);
  });

  it('ends a group at a hidden row', () => {
    const pkg = edited(inventoryXlsx(10), { [SHEET]: (xml) => xml.replace('<row r="14">', '<row r="14" hidden="1">') });
    const s = detect(pkg);
    expect(s.rowGroups.map((g) => [g.firstRow, g.capacity])).toEqual([[9, 5], [15, 4]]);
  });

  it('leaves out a hidden sheet, and names the fields of each visible sheet by its name', () => {
    const bytes = inventoryXlsx(5);
    const pkg = readPackage(bytes);
    const sheet = partText(pkg, SHEET)!;
    pkg.entries.set('xl/worksheets/sheet2.xml', bytesOf(sheet));
    pkg.entries.set('xl/worksheets/sheet3.xml', bytesOf(sheet));
    pkg.entries.set('xl/_rels/workbook.xml.rels', bytesOf(partText(pkg, 'xl/_rels/workbook.xml.rels')!.replace(
      '</Relationships>',
      '<Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet2.xml"/>'
      + '<Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/></Relationships>',
    )));
    pkg.entries.set(WORKBOOK, bytesOf(partText(pkg, WORKBOOK)!.replace(
      '</sheets>',
      '<sheet name="Old copy" sheetId="2" state="hidden" r:id="rId7"/><sheet name="Second" sheetId="3" r:id="rId8"/></sheets>',
    )));
    const s = detect(pkg);
    expect(s.fields.map((f) => f.id)).toEqual([
      'Demo inventory!C6', 'Demo inventory!E6', 'Demo inventory!C16', 'Second!C6', 'Second!E6', 'Second!C16',
    ]);
    expect(s.fields.find((f) => f.id === 'Second!C6')!.loc).toBe('xl/worksheets/sheet3.xml!C6');
    expect(s.rowGroups.map((g) => [g.id, g.loc])).toEqual([
      ['Demo inventory!g1', `${SHEET}!C9`], ['Second!g1', 'xl/worksheets/sheet3.xml!C9'],
    ]);
    // With more than one sheet, a field with no heading above it is in its sheet's section.
    expect(s.fields.find((f) => f.id === 'Second!C6')!.section).toBe('Second');
  });

  it('keeps fully filled rows between the header and the first empty row as fixed rows (R8)', () => {
    const pkg = edited(inventoryXlsx(10), {
      [SHEET]: (xml) => xml
        .replace(/<c r="C9" s="4"\/><c r="D9" s="4"\/><c r="E9" s="6"\/><c r="F9" s="4"\/>/,
          '<c r="C9" s="4" t="inlineStr"><is><t>Spec A</t></is></c><c r="D9" s="4" t="inlineStr"><is><t>Store</t></is></c><c r="E9" s="6"><v>2</v></c><c r="F9" s="4" t="inlineStr"><is><t>pcs</t></is></c>'),
    });
    const g = detect(pkg).rowGroups[0]!;
    expect(g.fixedRows).toEqual([{ label: 'Item 001', cells: ['Spec A', 'Store', '2', 'pcs'] }]);
    expect(g.firstRow).toBe(10);
    expect(g.capacity).toBe(9);
  });

  it('does not keep a filled row with a formula as a fixed row', () => {
    const pkg = edited(inventoryXlsx(10), {
      [SHEET]: (xml) => xml
        .replace(/<c r="C9" s="4"\/><c r="D9" s="4"\/><c r="E9" s="6"\/><c r="F9" s="4"\/>/,
          '<c r="C9" s="4" t="inlineStr"><is><t>Spec A</t></is></c><c r="D9" s="4" t="inlineStr"><is><t>Store</t></is></c><c r="E9" s="6"><f>1+1</f><v>2</v></c><c r="F9" s="4" t="inlineStr"><is><t>pcs</t></is></c>'),
    });
    const g = detect(pkg).rowGroups[0]!;
    expect(g.fixedRows).toBeUndefined();
    expect(g.firstRow).toBe(10);
  });

  it('makes a General cell after Dated: a date, and a cell with a time format a time', () => {
    const pkg = edited(dayGridXlsx(), {
      [SHEET]: (xml) => setCell(setCell(xml, 'B42', '<c r="B42" s="4"/>'), 'B43', '<c r="B43" s="12"/>'),
      [STRINGS]: (xml) => xml.replace('>Signed:<', '>Time:<'),
      // A new format 12: bordered, with the built-in time format 20 (h:mm).
      'xl/styles.xml': (xml) => xml.replace('<cellXfs count="12">', '<cellXfs count="13">')
        .replace('</cellXfs>', '<xf numFmtId="20" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/></cellXfs>'),
    });
    const s = detect(pkg);
    expect(fieldSummary(byLabel(s, 'Dated'))).toEqual({ id: 'Demo day grid!B42', kind: 'date', label: 'Dated', loc: `${SHEET}!B42` });
    expect(fieldSummary(byLabel(s, 'Time'))).toEqual({ id: 'Demo day grid!B43', kind: 'time', label: 'Time', loc: `${SHEET}!B43` });
  });

  it('takes the title from the largest font in rows 1 to 4, and the code and revision from the header cells', () => {
    const s = detect(inventoryXlsx(3), 'whatever name.xlsx');
    expect(s.identity.title).toBe('Demo Inventory');
  });

  it('falls back to the file name for the title when the header has no text', () => {
    const bytes = inventoryXlsx(3);
    const pkg = edited(bytes, {
      [SHEET]: (xml) => setCell(setCell(setCell(setCell(xml, 'C1', '<c r="C1" s="2"/>'), 'E1', '<c r="E1" s="10"/>'), 'E2', '<c r="E2" s="10"/>'), 'E3', '<c r="E3" s="10"/>'),
    });
    expect(detect(pkg, 'Store list.xlsx').identity).toEqual({ code: '', title: 'Store list', revision: '' });
  });

  it('reads the code from the page footer when the sheet has none', () => {
    const bytes = inventoryXlsx(3);
    const pkg = edited(bytes, {
      [SHEET]: (xml) => setCell(setCell(xml, 'E1', '<c r="E1" s="10"/>'), 'E2', '<c r="E2" s="10"/>').replace(
        '<drawing r:id="rId1"/>',
        '<headerFooter><oddFooter>&amp;L&amp;"Arial,Bold"&amp;8Form: TST-99&amp;RRevision: 02 / 01.05.2026&amp;C&amp;P</oddFooter></headerFooter><drawing r:id="rId1"/>',
      ),
    });
    expect(detect(pkg).identity).toEqual({ code: 'TST-99', title: 'Demo Inventory', revision: '02 / 01.05.2026' });
  });

  it('a group with a Status column is a checklist, and 30 numbered items with names are not a day grid', () => {
    const bytes = conditionListXlsx();
    const pkg = edited(bytes, {
      [STRINGS]: (xml) => xml.replace('<t xml:space="preserve">Condition</t>', '<t xml:space="preserve">Status</t>'),
      [WORKBOOK]: (xml) => xml.replace('$A$1:$D$108', '$A$1:$D$38'),
    });
    const g = detect(pkg).rowGroups[0]!;
    expect(g.capacity).toBe(30);
    expect(g.shape).toBe('checklist');
  });

  it('keeps a column of formulas out of the group, and a total row under it out of everything', () => {
    let xml = partText(readPackage(inventoryXlsx(5)), SHEET)!;
    for (let row = 9; row <= 13; row += 1) xml = setCell(xml, `F${row}`, `<c r="F${row}" s="4"><f>E${row}*2</f><v>0</v></c>`);
    const pkg = edited(inventoryXlsx(5), {
      // Every row works out F, and the total row (14) is bordered all along, with its sum in E.
      [SHEET]: () => xml.replace('<c r="E14" s="6">', '<c r="C14" s="4"/><c r="D14" s="4"/><c r="E14" s="6">'),
    });
    const s = detect(pkg);
    const g = s.rowGroups[0]!;
    expect([g.firstRow, g.capacity, g.columns.map((c) => c.loc)]).toEqual([9, 5, ['C', 'D', 'E']]);
    expect(s.fields.map((f) => f.id)).toEqual(['Demo inventory!C6', 'Demo inventory!E6', 'Demo inventory!C16']);
  });

  it('splits a table at a category row, which names the group under it', () => {
    const pkg = edited(inventoryXlsx(10), {
      [SHEET]: (xml) => setCell(xml, 'B13', '<c r="B13" s="9" t="inlineStr"><is><t>Deck stores</t></is></c>')
        .replace('<mergeCells count="7">', '<mergeCells count="8"><mergeCell ref="B13:F13"/>'),
    });
    const s = detect(pkg);
    expect(s.rowGroups.map((g) => [g.id, g.label, g.firstRow, g.capacity])).toEqual([
      ['Demo inventory!g1', 'Table 1', 9, 4], ['Demo inventory!g2', 'Deck stores', 14, 5],
    ]);
  });

  it('a table whose first column has no title is still a list of rows when its columns each hold one kind', () => {
    const pkg = edited(inventoryXlsx(10), {
      [SHEET]: (xml) => setCell(xml, 'B8', '<c r="B8" s="3"/>'),
    });
    const s = detect(pkg);
    expect(s.rowGroups).toHaveLength(1);
    expect(s.rowGroups[0]!.columns.map((c) => c.label)).toEqual(['Specification', 'Location', 'Qty', 'Unit']);
    expect(s.rowGroups[0]!.rowLabels![0]).toBe('Item 001');
  });

  it('makes a Remarks box merged down beside the rows one field, and keeps the rows a group', () => {
    const pkg = edited(dayGridXlsx(), {
      [SHEET]: (xml) => xml.replace('<mergeCells count="16">', '<mergeCells count="17"><mergeCell ref="N10:N40"/>'),
    });
    const s = detect(pkg);
    const g = s.rowGroups[0]!;
    expect([g.shape, g.firstRow, g.capacity, g.columns.length, g.columns[11]!.label]).toEqual(['dayGrid', 10, 31, 12, 'Hold 6 STBD']);
    expect(fieldSummary(byLabel(s, 'Remarks'))).toEqual({ id: 'Demo day grid!N10', kind: 'text', label: 'Remarks', loc: `${SHEET}!N10` });
  });

  it('marks a signature column of a group as left empty', () => {
    const pkg = edited(inventoryXlsx(10), {
      [STRINGS]: (xml) => xml.replace('<t xml:space="preserve">Unit</t>', '<t xml:space="preserve">Signature</t>'),
    });
    const col = detect(pkg).rowGroups[0]!.columns.find((c) => c.label === 'Signature')!;
    expect(col.leftEmpty).toBe(true);
  });

  it('lists the text in a shape as something that can\'t be filled here', () => {
    const shape = '<xdr:twoCellAnchor><xdr:from><xdr:col>6</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>5</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>'
      + '<xdr:to><xdr:col>8</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>7</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>'
      + '<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="3" name="Box"/><xdr:cNvSpPr txBox="1"/></xdr:nvSpPr><xdr:spPr/>'
      + '<xdr:txBody><a:bodyPr/><a:p><a:r><a:t>Note for the reader</a:t></a:r></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:twoCellAnchor>';
    const pkg = edited(inventoryXlsx(3), { 'xl/drawings/drawing1.xml': (xml) => xml.replace('</xdr:wsDr>', `${shape}</xdr:wsDr>`) });
    expect(detect(pkg).unsupported).toEqual(['Text box: "Note for the reader"']);
  });

  it('keeps a total row out of the group when only a column worked out on every row holds formulas', () => {
    const sheet = probeSheet('Totals');
    ['Item', 'Spec', 'Qty', 'Value'].forEach((t, i) => sheet.set(`${'BCDE'[i]}8`, t, STYLE.header));
    for (let r = 9; r <= 13; r += 1) {
      sheet.set(`B${r}`, `Item ${r}`, STYLE.cell).blank(`C${r}`, STYLE.cell).blank(`D${r}`, STYLE.number);
      sheet.set(`E${r}`, { formula: `D${r}*2`, value: 0 }, STYLE.number);
    }
    sheet.set('B14', 'Total', STYLE.cell).blank('C14', STYLE.cell).blank('D14', STYLE.number).set('E14', { formula: 'SUM(E9:E13)', value: 0 }, STYLE.number);
    const s = detect(sheet.toPackage({ printArea: 'A1:E16', logo: 'A1:A3' }));
    expect(s.rowGroups.map((g) => [g.firstRow, g.capacity, g.columns.map((c) => c.label), g.rowLabels!.at(-1)])).toEqual([[9, 5, ['Spec', 'Qty'], 'Item 13']]);
    expect(s.fields).toEqual([]);
  });

  /** Items 9 to 16 with Spec and Qty to fill and a Value column worked out on each row, and an optional last row. */
  function listWithValues(value: (r: number) => string, o: { label?: (r: number) => string; last?: [string, string] } = {}): Uint8Array {
    const sheet = probeSheet('List');
    ['Item', 'Spec', 'Qty', 'Value'].forEach((t, i) => sheet.set(`${'BCDE'[i]}8`, t, STYLE.header));
    for (let r = 9; r <= 16; r += 1) {
      sheet.set(`B${r}`, o.label?.(r) ?? `Item ${r}`, STYLE.cell).blank(`C${r}`, STYLE.cell).blank(`D${r}`, STYLE.number);
      sheet.set(`E${r}`, { formula: value(r), value: 0 }, STYLE.number);
    }
    if (o.last) sheet.set('B17', o.last[0], STYLE.cell).blank('C17', STYLE.cell).blank('D17', STYLE.number).set('E17', { formula: o.last[1], value: 0 }, STYLE.number);
    return sheet.toPackage({ printArea: 'A1:E20', logo: 'A1:A3' });
  }

  it.each([
    ['a running sum', (r: number) => `SUM($D$9:D${r})`],
    ['a rank', (r: number) => `RANK(D${r},$D$9:$D$16)`],
    ['a lookup elsewhere on the sheet', (r: number) => `VLOOKUP(B${r},$H$1:$I$50,2,0)`],
    ['a share of the total', (r: number) => `D${r}/SUM(D$9:D$16)`],
  ])('keeps every row in the group when each row works out %s, and still leaves out the sum under it', (_name, value) => {
    const whole = detect(listWithValues(value));
    expect(whole.rowGroups.map((g) => [g.firstRow, g.capacity, g.columns.map((c) => c.loc)])).toEqual([[9, 8, ['C', 'D']]]);
    // A last row named `Sum` (not `Total`) whose formula adds up the rows above it is a total.
    const withSum = detect(listWithValues(value, { last: ['Sum', 'SUM(E9:E16)'] }));
    expect(withSum.rowGroups.map((g) => [g.firstRow, g.capacity])).toEqual([[9, 8]]);
    expect(withSum.fields).toEqual([]);
  });

  it('does not take a range on another sheet for a total', () => {
    const s = detect(listWithValues((r) => `D${r}*2`, { last: ['Item 17', '\'Other sheet\'!D9:D16'] }));
    expect(s.rowGroups.map((g) => [g.firstRow, g.capacity])).toEqual([[9, 9]]);
  });

  it('keeps an item that only starts with the word Total in the group, and leaves out a row called Total:', () => {
    const label = (r: number) => (r === 12 ? 'Total hours' : `Item ${r}`);
    const s = detect(listWithValues((r) => `D${r}*2`, { label, last: ['Total:', 'D9'] }));
    const g = s.rowGroups[0]!;
    expect([s.rowGroups.length, g.capacity, g.rowLabels![3]]).toEqual([1, 8, 'Total hours']);
    expect(s.fields).toEqual([]);
  });

  it('keeps a total row out when it sums the rows, or is called Total, with no formula column above', () => {
    for (const [label, formula] of [['Sum', 'SUM(D9:D13)'], ['Grand total', 'D9+D10']] as const) {
      const sheet = probeSheet('Totals');
      ['Item', 'Spec', 'Qty', 'Unit'].forEach((t, i) => sheet.set(`${'BCDE'[i]}8`, t, STYLE.header));
      for (let r = 9; r <= 13; r += 1) sheet.set(`B${r}`, `Item ${r}`, STYLE.cell).blank(`C${r}`, STYLE.cell).blank(`D${r}`, STYLE.number).blank(`E${r}`, STYLE.cell);
      // The total row is bordered all along and has its formula in the Unit column, where the rows have none.
      sheet.set('B14', label, STYLE.cell).blank('C14:D14', STYLE.cell).set('E14', { formula, value: 0 }, STYLE.cell);
      const s = detect(sheet.toPackage({ printArea: 'A1:E16', logo: 'A1:A3' }));
      expect(s.rowGroups.map((g) => [g.firstRow, g.capacity])).toEqual([[9, 5]]);
      expect(s.fields).toEqual([]);
    }
  });

  it('merged_label_cells: reads attribute names from two columns when the corner is two cells, and flags a row with none', () => {
    for (const mergedCorner of [false, true]) {
      const sheet = probeSheet('Grid');
      if (mergedCorner) sheet.merge('A6:B6', STYLE.header);
      else sheet.set('A6', undefined, STYLE.header).set('B6', undefined, STYLE.header);
      for (let i = 0; i < 4; i += 1) sheet.set(`${'CDEF'[i]}6`, `Eq ${i + 1}`, STYLE.header);
      sheet.set('A7', 'Kind', STYLE.bold).blank('B7', STYLE.bold).blank('C7:F7', STYLE.cell);
      sheet.merge('A8:A9', STYLE.bold, 'Dimensions').set('B8', 'Length', STYLE.bold).set('B9', 'Width', STYLE.bold);
      sheet.blank('C8:F9', STYLE.number);
      // Row 10 names nothing.
      sheet.blank('A10:B10', STYLE.bold).blank('C10:F10', STYLE.cell);
      const s = detect(sheet.toPackage({ printArea: 'A1:F11', logo: 'A1:A3' }));
      const at = (ref: string) => s.fields.find((f) => f.id === `Grid!${ref}`)!;
      expect(s.rowGroups).toEqual([]);
      expect([at('C7').label, at('C8').label, at('D9').label]).toEqual([`Eq 1 ${DOT} Kind`, `Eq 1 ${DOT} Dimensions Length`, `Eq 2 ${DOT} Dimensions Width`]);
      expect([at('C8').confidence, at('C10').label, at('C10').confidence]).toEqual(['high', 'Eq 1', 'low']);
      expect(new Set(s.fields.map((f) => f.block))).toEqual(new Set(['Grid!m1']));
    }
  });

  it('R16: a list under an empty corner whose columns are all text is a row group, not a matrix', () => {
    const sheet = probeSheet('List');
    sheet.set('B8', undefined, STYLE.header);
    ['Spec', 'Location', 'Unit'].forEach((t, i) => sheet.set(`${'CDE'[i]}8`, t, STYLE.header));
    for (let r = 9; r <= 18; r += 1) sheet.set(`B${r}`, `Item ${r}`, STYLE.bold).blank(`C${r}:E${r}`, STYLE.cell);
    const s = detect(sheet.toPackage({ printArea: 'A1:E20', logo: 'A1:A3' }));
    expect(s.fields).toEqual([]);
    const g = s.rowGroups[0]!;
    expect([s.rowGroups.length, g.shape, g.firstRow, g.capacity, g.columns.map((c) => c.label), g.rowLabels![0]])
      .toEqual([1, 'rows', 9, 10, ['Spec', 'Location', 'Unit'], 'Item 9']);
  });

  it('handles a tall merge and a cell far down the sheet without indexing every row', () => {
    const pkg = edited(inventoryXlsx(5), {
      [SHEET]: (xml) => xml.replace('</sheetData>', '<row r="1048000"><c r="H1048000" t="inlineStr"><is><t>far</t></is></c></row></sheetData>')
        .replace('<mergeCells count="7">', '<mergeCells count="8"><mergeCell ref="H20:H1048576"/>'),
      [WORKBOOK]: (xml) => xml.replace(/<definedNames>.*<\/definedNames>/, ''),
    });
    const start = performance.now();
    const s = detect(pkg);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(s.rowGroups.map((g) => g.capacity)).toEqual([5]);
  });

  it('refuses a package with no workbook', () => {
    const pkg = readPackage(inventoryXlsx(3));
    pkg.entries.delete(WORKBOOK);
    expect(() => detect(pkg)).toThrow("This file isn't a Word or Excel form.");
  });
});

describe('detectExcel: what a group is made of', () => {
  it('every group column and field of every fixture has an address in its own sheet part', () => {
    for (const make of [() => inventoryXlsx(12), dayGridXlsx, matrixXlsx, conditionListXlsx]) {
      const s = detect(make());
      for (const f of s.fields) expect(f.loc).toMatch(/^xl\/worksheets\/sheet1\.xml![A-Z]+\d+$/);
      for (const g of s.rowGroups as RowGroupDef[]) {
        expect(g.loc).toBe(`${SHEET}!${g.columns[0]!.loc}${g.firstRow}`);
        for (const c of g.columns) expect(c.loc).toMatch(/^[A-Z]+$/);
        expect(new Set(g.columns.map((c) => c.id)).size).toBe(g.columns.length);
      }
      expect(new Set(s.fields.map((f) => f.id)).size).toBe(s.fields.length);
    }
  });
});

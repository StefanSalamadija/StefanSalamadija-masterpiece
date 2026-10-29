import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { FormWriteError } from '../errors';
import { bytesOf, partText, readPackage, writePackage } from '../package';
import type { Package } from '../package';
import { conditionListXlsx, dayGridXlsx, inventoryXlsx, matrixXlsx } from '../testing/excelFixtures';
import type { DraftValues, FieldDef, FieldKind, FormSchema, FormValue } from '../types';
import { parseXml } from '../xml';
import { detectExcel } from './detect';
import { readExcelValues } from './read';
import { isoToSerial, serialToIso } from './values';
import { canonicalExcelValue, writeExcel } from './write';

const SHEET = 'xl/worksheets/sheet1.xml';
const WORKBOOK = 'xl/workbook.xml';
const STRINGS = 'xl/sharedStrings.xml';
const WORKBOOK_RELS = 'xl/_rels/workbook.xml.rels';
const TYPES = '[Content_Types].xml';
const SML = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

const values = (fields: DraftValues['fields'] = {}, rows: DraftValues['rows'] = {}): DraftValues => ({ fields, rows });
const detect = (pkg: Package): FormSchema => detectExcel(pkg, 'form.xlsx');
const byLabel = (s: FormSchema, label: string): FieldDef => {
  const found = s.fields.find((f) => f.label === label);
  if (!found) throw new Error(`no field ${label} in ${s.fields.map((f) => f.label).join(', ')}`);
  return found;
};

/** Writes the values and reads the output back as a package. */
function fill(pkg: Package, s: FormSchema, v: DraftValues): { changed: Map<string, Uint8Array>; out: Package; bytes: Uint8Array } {
  const changed = writeExcel(pkg, s, v);
  const bytes = writePackage(pkg, changed);
  return { changed, out: readPackage(bytes), bytes };
}

const sheetJs = (bytes: Uint8Array): XLSX.WorkSheet => {
  const book = XLSX.read(bytes, { type: 'array' });
  return book.Sheets[book.SheetNames[0]!]!;
};

/** The `<c>` element of a cell in the output's sheet XML, or undefined. */
function cellEl(pkg: Package, ref: string, part = SHEET): Element | undefined {
  return Array.from(parseXml(partText(pkg, part)!).getElementsByTagNameNS(SML, 'c')).find((c) => c.getAttribute('r') === ref);
}
const childNames = (el: Element | undefined): string[] => Array.from(el?.childNodes ?? []).filter((n) => n.nodeType === 1).map((n) => (n as Element).localName);
const childText = (el: Element | undefined, name: string): string | undefined => {
  const found = Array.from(el?.childNodes ?? []).find((n) => n.nodeType === 1 && (n as Element).localName === name);
  return found?.textContent ?? undefined;
};

/** A fixture's package with some of its parts changed by text edits. */
function edited(bytes: Uint8Array | Package, edits: Record<string, (xml: string) => string>): Package {
  const pkg = bytes instanceof Uint8Array ? readPackage(bytes) : bytes;
  for (const [path, change] of Object.entries(edits)) {
    const before = partText(pkg, path)!;
    const after = change(before);
    if (after === before) throw new Error(`the edit of ${path} changed nothing`);
    pkg.entries.set(path, bytesOf(after));
  }
  return pkg;
}

/** Replaces the `<c r="ref" .../>` or `<c r="ref" ...>...</c>` element in sheet XML. */
function setCell(xml: string, ref: string, cell: string): string {
  return xml.replace(new RegExp(`<c r="${ref}"[^>]*?(?:/>|>.*?</c>)`), cell);
}

/** A field at a cell of the fixture's sheet, for layouts detection would not give. Its id is the cell. */
function field(ref: string, kind: FieldKind, extra: Partial<FieldDef> = {}): FieldDef {
  return { id: ref, kind, label: `Probe ${ref}`, section: '', loc: `${SHEET}!${ref}`, confidence: 'high', ...extra };
}
const schemaOf = (fields: FieldDef[]): FormSchema => ({
  kind: 'xlsx', identity: { code: 'TST-90', title: 'Probe', revision: '' }, fields, rowGroups: [], unsupported: [],
});

/** Every part of `out` that is not in `changed` has the very bytes of `pkg`'s part. */
function expectUntouched(pkg: Package, out: Package, changed: Map<string, Uint8Array>): void {
  expect(out.order.slice(0, pkg.order.length)).toEqual(pkg.order);
  for (const part of pkg.order) if (!changed.has(part)) expect(out.entries.get(part), part).toEqual(pkg.entries.get(part));
}

describe('writeExcel (the brief\'s tests)', () => {
  it('fills the inventory: Qty 2,5 is a number, Vessel is text, the total keeps its formula, only 3 parts change', () => {
    const pkg = readPackage(inventoryXlsx(10));
    const s = detect(pkg);
    const [group] = s.rowGroups;
    const col = (title: string) => group.columns.find((c) => c.label === title)!.id;
    const rows: Record<string, FormValue>[] = [{}, {}, { [col('Qty')]: '2,5', [col('Unit')]: 'pcs' }];
    const { changed, out, bytes } = fill(pkg, s, values({ [byLabel(s, 'Vessel').id]: 'MV DEMO STAR' }, { [group.id]: rows }));

    expect([...changed.keys()].sort()).toEqual([SHEET, STRINGS, WORKBOOK].sort());
    expectUntouched(pkg, out, changed);

    const ws = sheetJs(bytes);
    expect(ws.E11).toMatchObject({ t: 'n', v: 2.5 }); // the group's row 3 is sheet row 9 + 2
    expect(ws.F11).toMatchObject({ t: 's', v: 'pcs' });
    expect(ws.C6).toMatchObject({ t: 's', v: 'MV DEMO STAR' });
    expect(ws.E19.f).toBe('SUM(E9:E18)'); // the total row, 9 + 10
    expect(childNames(cellEl(out, 'E19'))).toContain('f');
    expect(cellEl(out, 'E11')!.getAttribute('t')).toBeNull();
    expect(cellEl(out, 'E11')!.getAttribute('s')).toBe(cellEl(pkg, 'E11')!.getAttribute('s'));

    const calcPr = parseXml(partText(out, WORKBOOK)!).getElementsByTagNameNS(SML, 'calcPr')[0]!;
    expect(calcPr.getAttribute('fullCalcOnLoad')).toBe('1');
    expect(calcPr.getAttribute('calcId')).toBe('191029'); // merged, not replaced

    const back = readExcelValues(out, s);
    expect(back.fields[byLabel(s, 'Vessel').id]).toBe('MV DEMO STAR');
    expect(back.rows[group.id]![2]).toMatchObject({ [col('Qty')]: '2.5', [col('Unit')]: 'pcs' });
  });

  it('escapes_in_cells: & < > " diacritics and a line break stay inside one cell and round-trip', () => {
    const pkg = readPackage(inventoryXlsx(10));
    const s = detect(pkg);
    const [group] = s.rowGroups;
    const tricky = 'Š & <x> "y"\nć đ second line';
    const vessel = byLabel(s, 'Vessel').id;
    const spec = group.columns[0].id;
    const { out, bytes } = fill(pkg, s, values({ [vessel]: tricky }, { [group.id]: [{ [spec]: tricky }] }));

    for (const part of [SHEET, STRINGS, WORKBOOK]) expect(() => parseXml(partText(out, part)!)).not.toThrow();
    const back = readExcelValues(out, s);
    expect(back.fields[vessel]).toBe(tricky);
    expect(back.rows[group.id]![0]![spec]).toBe(tricky);
    const ws = sheetJs(bytes);
    expect(ws.C6.v).toBe(tricky);
    expect(ws.C9.v).toBe(tricky);
    expect(ws.C10).toBeUndefined(); // the break did not spill into the next row
  });

  it('writes day 28 of the day grid into sheet row 37', () => {
    const pkg = readPackage(dayGridXlsx());
    const s = detect(pkg);
    const [group] = s.rowGroups;
    const rows: Record<string, FormValue>[] = Array.from({ length: 28 }, () => ({}));
    rows[27] = Object.fromEntries(group.columns.map((c, i) => [c.id, `v${i}`]));
    const { out, bytes } = fill(pkg, s, values({}, { [group.id]: rows }));

    const ws = sheetJs(bytes);
    group.columns.forEach((c, i) => expect(ws[`${c.loc}37`]?.v, c.loc).toBe(`v${i}`));
    expect(ws.B36?.v).toBeUndefined();
    expect(ws.B38?.v).toBeUndefined();
    const back = readExcelValues(out, s).rows[group.id]!;
    expect(back).toHaveLength(31);
    expect(back[27]).toEqual(rows[27]);
    expect(back[26]).toEqual(Object.fromEntries(group.columns.map((c) => [c.id, null])));
  });
});

describe('writeExcel: dates and times (R2, R15)', () => {
  it('writes a date as a serial in a date-formatted cell, keeping its style', () => {
    const pkg = readPackage(inventoryXlsx(5));
    const s = detect(pkg);
    const date = byLabel(s, 'Date');
    const { out, bytes } = fill(pkg, s, values({ [date.id]: '2026-10-28' }));
    expect(childText(cellEl(out, 'E6'), 'v')).toBe('46323');
    expect(cellEl(out, 'E6')!.getAttribute('t')).toBeNull();
    expect(cellEl(out, 'E6')!.getAttribute('s')).toBe(cellEl(pkg, 'E6')!.getAttribute('s'));
    expect(sheetJs(bytes).E6.w).toBe('28-Oct-2026');
    expect(readExcelValues(out, s).fields[date.id]).toBe('2026-10-28');
  });

  it('counts from 1904 when the workbook says so', () => {
    const pkg = edited(inventoryXlsx(5), { [WORKBOOK]: (x) => x.replace('<workbookPr ', '<workbookPr date1904="1" ') });
    const s = detect(pkg);
    const date = byLabel(s, 'Date');
    const { out } = fill(pkg, s, values({ [date.id]: '2026-10-28' }));
    expect(childText(cellEl(out, 'E6'), 'v')).toBe(String(46323 - 1462));
    expect(readExcelValues(out, s).fields[date.id]).toBe('2026-10-28');
  });

  it('converts serials with the 1900 leap-year bug, both ways', () => {
    expect(isoToSerial('1900-01-01', false)).toBe(1);
    expect(isoToSerial('1900-02-28', false)).toBe(59);
    expect(isoToSerial('1900-03-01', false)).toBe(61);
    expect(isoToSerial('2026-10-28', false)).toBe(46323);
    expect(isoToSerial('1899-12-31', false)).toBeUndefined();
    expect(isoToSerial('1904-01-01', true)).toBe(0);
    expect(isoToSerial('1903-12-31', true)).toBeUndefined();
    for (const iso of ['1900-01-01', '1900-02-28', '1900-03-01', '2000-02-29', '2026-10-28', '9999-12-31']) {
      expect(serialToIso(isoToSerial(iso, false)!, false)).toBe(iso);
      if (iso >= '1904') expect(serialToIso(isoToSerial(iso, true)!, true)).toBe(iso);
    }
    expect(serialToIso(60, false)).toBeUndefined(); // 29 February 1900, which never was
    expect(serialToIso(0, false)).toBeUndefined();
    expect(serialToIso(46323.75, false)).toBe('2026-10-28');
  });

  it('writes a date into a cell with no date format as text in the field\'s format, and reads it back as ISO', () => {
    const pkg = readPackage(inventoryXlsx(5));
    const s = schemaOf([field('G6', 'date', { formatHint: 'dd/MMM/yyyy' }), field('G7', 'date'), field('G8', 'date')]);
    const { out, bytes } = fill(pkg, s, values({ G6: '2026-10-28', G7: '2026-10-28', G8: 'next week' }));
    const ws = sheetJs(bytes);
    expect(ws.G6).toMatchObject({ t: 's', v: '28/Oct/2026' });
    expect(ws.G7).toMatchObject({ t: 's', v: '28-OCT-2026' });
    expect(ws.G8).toMatchObject({ t: 's', v: 'next week' });
    expect(readExcelValues(out, s).fields).toEqual({ G6: '2026-10-28', G7: '2026-10-28', G8: 'next week' });
  });

  it('writes a date before the workbook\'s first day as text, even in a date cell', () => {
    const pkg = readPackage(inventoryXlsx(5));
    const s = detect(pkg);
    const date = byLabel(s, 'Date');
    const { out, bytes } = fill(pkg, s, values({ [date.id]: '1899-12-30' }));
    expect(sheetJs(bytes).E6).toMatchObject({ t: 's', v: '30-Dec-1899' });
    expect(readExcelValues(out, s).fields[date.id]).toBe('1899-12-30');
  });

  it('writes a time as a fraction of a day in a time-formatted cell, and as HH:mm text elsewhere', () => {
    const pkg = edited(inventoryXlsx(5), {
      'xl/styles.xml': (x) => x.replace('<cellXfs count="12">', '<cellXfs count="13">')
        .replace('</cellXfs>', '<xf numFmtId="20" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/></cellXfs>'),
      [SHEET]: (x) => x.replace('</row><row r="8">', '<c r="G6" s="12"/></row><row r="8">'),
    });
    const s = schemaOf([field('G6', 'time'), field('H6', 'time'), field('I6', 'time')]);
    const { out, bytes } = fill(pkg, s, values({ G6: '10:30', H6: '9:05', I6: 'noon' }));
    expect(childText(cellEl(out, 'G6'), 'v')).toBe('0.4375');
    expect(cellEl(out, 'G6')!.getAttribute('s')).toBe('12');
    const ws = sheetJs(bytes);
    expect(ws.G6).toMatchObject({ t: 'n', v: 0.4375, w: '10:30' });
    expect(ws.H6).toMatchObject({ t: 's', v: '09:05' });
    expect(ws.I6).toMatchObject({ t: 's', v: 'noon' });
    expect(readExcelValues(out, s).fields).toEqual({ G6: '10:30', H6: '09:05', I6: 'noon' });
  });
});

describe('writeExcel: cells and typing', () => {
  it('creates a missing cell in column order and a missing row in row order, with the row\'s or column\'s style', () => {
    const pkg = edited(inventoryXlsx(5), {
      [SHEET]: (x) => x.replace('<row r="8">', '<row r="8" s="9" customFormat="1">')
        .replace('</cols>', '<col min="8" max="8" width="10" style="4" customWidth="1"/></cols>'),
    });
    // Row 7 has no <row>; A6 is before every cell of row 6; G8 is after them, in a row with a style; H7 is in a styled column.
    const s = schemaOf([field('A6', 'text'), field('G8', 'text'), field('H7', 'text'), field('C7', 'number')]);
    const { out, bytes } = fill(pkg, s, values({ A6: 'a', G8: 'g', H7: 'h', C7: '7' }));

    const doc = parseXml(partText(out, SHEET)!);
    const rows = Array.from(doc.getElementsByTagNameNS(SML, 'row'));
    const numbers = rows.map((r) => Number(r.getAttribute('r')));
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    expect(numbers).toContain(7);
    const refsOf = (n: number) => Array.from(rows.find((r) => r.getAttribute('r') === String(n))!.getElementsByTagNameNS(SML, 'c')).map((c) => c.getAttribute('r'));
    expect(refsOf(6)).toEqual(['A6', 'B6', 'C6', 'D6', 'E6', 'F6']);
    expect(refsOf(7)).toEqual(['C7', 'H7']);
    expect(refsOf(8).slice(-1)).toEqual(['G8']);
    expect(cellEl(out, 'G8')!.getAttribute('s')).toBe('9');
    expect(cellEl(out, 'H7')!.getAttribute('s')).toBe('4');
    expect(cellEl(out, 'A6')!.getAttribute('s')).toBeNull();
    expect(cellEl(out, 'C7')!.getAttribute('t')).toBeNull();
    expect(doc.getElementsByTagNameNS(SML, 'dimension')[0]!.getAttribute('ref')).toBe('A1:H16');

    const ws = sheetJs(bytes);
    expect([ws.A6.v, ws.G8.v, ws.H7.v, ws.C7.v]).toEqual(['a', 'g', 'h', 7]);
    expect(ws.B6.v).toBe('Vessel:'); // its neighbours did not move
    expect(readExcelValues(out, s).fields).toEqual({ A6: 'a', G8: 'g', H7: 'h', C7: '7' });
  });

  it('finds cells that have no r of their own, and adds a cell before them without moving them (R12)', () => {
    const pkg = edited(inventoryXlsx(5), {
      [SHEET]: (x) => x.replace(/<row r="6">(.*?)<\/row>/, (row: string) => row.replace(/<c r="[C-F]6"/g, '<c')),
    });
    const s = schemaOf([field('A6', 'text'), field('C6', 'text')]);
    expect(sheetJs(writePackage(pkg, new Map())).B6.v).toBe('Vessel:');
    const { out, bytes } = fill(pkg, s, values({ A6: 'first', C6: 'MV' }));
    const ws = sheetJs(bytes);
    expect([ws.A6.v, ws.B6.v, ws.C6.v, ws.D6.v]).toEqual(['first', 'Vessel:', 'MV', 'Date:']);
    const row6 = Array.from(parseXml(partText(out, SHEET)!).getElementsByTagNameNS(SML, 'row')).find((r) => r.getAttribute('r') === '6')!;
    expect(row6.getElementsByTagNameNS(SML, 'c')).toHaveLength(6);
    expect(readExcelValues(out, s).fields).toEqual({ A6: 'first', C6: 'MV' });
  });

  it('types the cell by what is written: stale t, v and is go; s stays', () => {
    const pkg = edited(inventoryXlsx(5), {
      [SHEET]: (x) => {
        let out = setCell(x, 'C9', '<c r="C9" s="4" t="s"><v>0</v></c>');
        out = setCell(out, 'D9', '<c r="D9" s="4"><v>12</v></c>');
        out = setCell(out, 'F9', '<c r="F9" s="4" t="inlineStr"><is><t>old</t></is></c>');
        out = setCell(out, 'C10', '<c r="C10" s="4" t="b"><v>1</v></c>');
        return setCell(out, 'D10', '<c r="D10" s="4" t="e"><v>#N/A</v></c>');
      },
    });
    const s = schemaOf([field('C9', 'number'), field('D9', 'text'), field('F9', 'number'), field('C10', 'text'), field('D10', 'number')]);
    const { out, bytes } = fill(pkg, s, values({ C9: '3', D9: 'twelve', F9: '4.25', C10: 'yes', D10: 'about 3' }));
    const t = (ref: string) => cellEl(out, ref)!.getAttribute('t');
    expect([t('C9'), t('D9'), t('F9'), t('C10'), t('D10')]).toEqual([null, 's', null, 's', 's']);
    expect(childNames(cellEl(out, 'F9'))).toEqual(['v']);
    for (const ref of ['C9', 'D9', 'F9', 'C10', 'D10']) expect(cellEl(out, ref)!.getAttribute('s')).toBe('4');
    const ws = sheetJs(bytes);
    expect([ws.C9.v, ws.D9.v, ws.F9.v, ws.C10.v, ws.D10.v]).toEqual([3, 'twelve', 4.25, 'yes', 'about 3']);
  });

  it('refuses to write into a formula cell', () => {
    const pkg = readPackage(inventoryXlsx(5));
    const s = schemaOf([field('E14', 'number')]);
    expect(() => writeExcel(pkg, s, values({ E14: '5' }))).toThrow(FormWriteError);
    expect(() => writeExcel(pkg, s, values({ E14: '5' }))).toThrow(/E14/);
  });

  it('refuses a value in a row beyond the group\'s capacity (R1), but not blank rows', () => {
    const pkg = readPackage(inventoryXlsx(5));
    const s = detect(pkg);
    const [group] = s.rowGroups;
    const spec = group.columns[0].id;
    const blank = Array.from({ length: 7 }, () => ({ [spec]: null }));
    expect(() => writeExcel(pkg, s, values({}, { [group.id]: blank }))).not.toThrow();
    const over = blank.map((row, i) => (i === 5 ? { [spec]: 'too many' } : row));
    expect(() => writeExcel(pkg, s, values({}, { [group.id]: over }))).toThrow(FormWriteError);
  });

  it('never writes a left-empty field or column, and writes nothing for blank values', () => {
    const pkg = readPackage(inventoryXlsx(5));
    const s = detect(pkg);
    const signature = s.fields.find((f) => f.leftEmpty)!;
    const { out } = fill(pkg, s, values({ [signature.id]: 'Someone', [byLabel(s, 'Vessel').id]: '' }));
    expect(childNames(cellEl(out, 'C16'))).toEqual([]);
    expect(childNames(cellEl(out, 'C6'))).toEqual([]);
    expect(readExcelValues(out, s).fields[signature.id]).toBeNull();
  });

  it('writes booleans for checkboxes, refuses them elsewhere, and keeps choices to their options', () => {
    const pkg = readPackage(inventoryXlsx(5));
    const s = schemaOf([field('G6', 'checkbox'), field('H6', 'checkbox'), field('I6', 'choice', { options: ['Yes', 'No'] }), field('J6', 'text')]);
    const { out } = fill(pkg, s, values({ G6: true, H6: false, I6: 'No' }));
    expect(readExcelValues(out, s).fields).toEqual({ G6: true, H6: false, I6: 'No', J6: null });
    expect(() => writeExcel(pkg, s, values({ J6: true }))).toThrow(FormWriteError);
    expect(() => writeExcel(pkg, s, values({ G6: 'yes' }))).toThrow(FormWriteError);
    expect(() => writeExcel(pkg, s, values({ I6: 'Maybe' }))).toThrow(FormWriteError);
  });
});

describe('writeExcel: shared strings', () => {
  it('appends new strings without reordering, reuses an identical one, and keeps count and uniqueCount right', () => {
    const pkg = readPackage(inventoryXlsx(5));
    const s = detect(pkg);
    const [group] = s.rowGroups;
    const spec = group.columns[0].id;
    const sstOf = (p: Package) => parseXml(partText(p, STRINGS)!).documentElement;
    const before = sstOf(pkg);
    const items = (root: Element) => Array.from(root.getElementsByTagNameNS(SML, 'si')).map((si) => si.textContent);
    const { out, bytes } = fill(pkg, s, values({ [byLabel(s, 'Vessel').id]: 'MV NEW' }, { [group.id]: [{ [spec]: 'MV NEW' }, { [spec]: 'Item 001' }] }));
    const after = sstOf(out);
    expect(items(after)).toEqual([...items(before), 'MV NEW']);
    expect(after.getAttribute('uniqueCount')).toBe(String(items(before).length + 1));
    expect(after.getAttribute('count')).toBe(String(Number(before.getAttribute('count')) + 3));
    expect(sheetJs(bytes).C10.v).toBe('Item 001');
  });

  it('keeps leading and trailing spaces, drops characters XML cannot hold, and keeps a literal _x0041_', () => {
    const pkg = readPackage(inventoryXlsx(5));
    const s = schemaOf([field('G6', 'text'), field('H6', 'text'), field('I6', 'text')]);
    const { out, bytes } = fill(pkg, s, values({ G6: '  padded ', H6: 'bell\u0007 and\r\nCRLF', I6: 'code _x0041_ here' }));
    const ws = sheetJs(bytes);
    expect([ws.G6.v, ws.H6.v, ws.I6.v]).toEqual(['  padded ', 'bell and\nCRLF', 'code _x0041_ here']);
    expect(readExcelValues(out, s).fields).toEqual({ G6: '  padded ', H6: 'bell and\nCRLF', I6: 'code _x0041_ here' });
    expect(canonicalExcelValue(s.fields[1]!, 'bell\u0007 and\r\nCRLF')).toBe('bell and\nCRLF');
  });

  it('creates sharedStrings.xml, its relationship and its content type when the workbook has none', () => {
    const pkg = withoutSharedStrings(inventoryXlsx(5));
    expect(pkg.entries.has(STRINGS)).toBe(false);
    const s = detect(pkg);
    const { changed, out, bytes } = fill(pkg, s, values({ [byLabel(s, 'Vessel').id]: 'MV DEMO STAR' }));
    expect([...changed.keys()].sort()).toEqual([TYPES, WORKBOOK, WORKBOOK_RELS, SHEET, STRINGS].sort());
    expectUntouched(pkg, out, changed);
    expect(partText(out, WORKBOOK_RELS)).toMatch(/Type="[^"]*\/sharedStrings" Target="sharedStrings.xml"/);
    expect(partText(out, TYPES)).toContain('<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>');
    const sst = parseXml(partText(out, STRINGS)!).documentElement;
    expect([sst.getAttribute('count'), sst.getAttribute('uniqueCount')]).toEqual(['1', '1']);
    const ws = sheetJs(bytes);
    expect(ws.C6).toMatchObject({ t: 's', v: 'MV DEMO STAR' });
    expect(ws.B6.v).toBe('Vessel:');
    expect(readExcelValues(out, s).fields[byLabel(s, 'Vessel').id]).toBe('MV DEMO STAR');
  });

  it('changes no part at all but workbook.xml when no value is given', () => {
    const pkg = readPackage(inventoryXlsx(5));
    const { changed } = fill(pkg, detect(pkg), values());
    expect([...changed.keys()]).toEqual([WORKBOOK]);
  });
});

describe('writeExcel: recalculation', () => {
  it('adds calcPr after definedNames and before oleSize when there is none', () => {
    const pkg = edited(inventoryXlsx(5), { [WORKBOOK]: (x) => x.replace('<calcPr calcId="191029"/>', '<oleSize ref="A1:F10"/>') });
    const { out } = fill(pkg, detect(pkg), values());
    const root = parseXml(partText(out, WORKBOOK)!).documentElement;
    const names = childNames(root);
    expect(names.slice(names.indexOf('definedNames'))).toEqual(['definedNames', 'calcPr', 'oleSize']);
    expect(root.getElementsByTagNameNS(SML, 'calcPr')[0]!.getAttribute('fullCalcOnLoad')).toBe('1');
  });

  it('leaves workbook.xml alone when it already recalculates on load', () => {
    const pkg = edited(inventoryXlsx(5), { [WORKBOOK]: (x) => x.replace('<calcPr calcId="191029"/>', '<calcPr calcId="191029" fullCalcOnLoad="1"/>') });
    expect([...writeExcel(pkg, detect(pkg), values()).keys()]).toEqual([]);
  });
});

/** A value of the field's kind for row `i`, as a person would type it. */
function sample(f: FieldDef, i: number): FormValue {
  switch (f.kind) {
    case 'number': return `${i},5`;
    case 'date': return `2026-10-${String((i % 28) + 1).padStart(2, '0')}`;
    case 'time': return `${String(i % 24).padStart(2, '0')}:15`;
    default: return `Text ${i} & <more>`;
  }
}

/** Every writable field and every row of every group, filled. */
function everything(s: FormSchema): DraftValues {
  const out = values();
  s.fields.forEach((f, i) => { if (!f.leftEmpty) out.fields[f.id] = sample(f, i); });
  for (const g of s.rowGroups) {
    out.rows[g.id] = Array.from({ length: g.capacity }, (_, i) => Object.fromEntries(g.columns.filter((c) => !c.leftEmpty).map((c) => [c.id, sample(c, i)])));
  }
  return out;
}

describe('writeExcel then readExcelValues on every fixture', () => {
  it.each([
    ['inventory', () => inventoryXlsx(120)],
    ['day grid', dayGridXlsx],
    ['matrix', matrixXlsx],
    ['condition list', conditionListXlsx],
  ])('%s: reads back the canonical value of everything written', (_name, make) => {
    const pkg = readPackage(make());
    const s = detect(pkg);
    const v = everything(s);
    const { out, changed, bytes } = fill(pkg, s, v);
    expectUntouched(pkg, out, changed);
    const back = readExcelValues(out, s);
    for (const f of s.fields) expect(back.fields[f.id], f.id).toEqual(f.leftEmpty ? null : canonicalExcelValue(f, v.fields[f.id]!));
    for (const g of s.rowGroups) {
      expect(back.rows[g.id]).toHaveLength(g.capacity);
      back.rows[g.id]!.forEach((row, i) => {
        for (const c of g.columns) expect(row[c.id], `${c.id} ${i}`).toEqual(c.leftEmpty ? null : canonicalExcelValue(c, v.rows[g.id]![i]![c.id]!));
      });
    }
    expect(() => XLSX.read(bytes, { type: 'array' })).not.toThrow();
    expect(() => detectExcel(out, 'out.xlsx')).not.toThrow();
  });

  it('reads an unfilled template as all null', () => {
    const pkg = readPackage(matrixXlsx());
    const s = detect(pkg);
    const back = readExcelValues(pkg, s);
    expect(Object.values(back.fields).every((v) => v === null)).toBe(true);
    expect(Object.keys(back.fields)).toHaveLength(s.fields.length);
  });

  it('canonicalExcelValue: numbers with a dot, padded times, ISO dates, text as written', () => {
    expect(canonicalExcelValue(field('A1', 'number'), '2,5')).toBe('2.5');
    expect(canonicalExcelValue(field('A1', 'number'), '007')).toBe('7');
    expect(canonicalExcelValue(field('A1', 'number'), 'about 3')).toBe('about 3');
    expect(canonicalExcelValue(field('A1', 'time'), '9:05')).toBe('09:05');
    expect(canonicalExcelValue(field('A1', 'date'), '2026-10-28')).toBe('2026-10-28');
    expect(canonicalExcelValue(field('A1', 'text'), '007')).toBe('007');
    expect(canonicalExcelValue(field('A1', 'text'), null)).toBeNull();
  });

  it('large_grid_under_1s: fills a 120-row inventory and the full 31 x 13 day grid in well under 1 s', () => {
    const inventory = readPackage(inventoryXlsx(120));
    const grid = readPackage(dayGridXlsx());
    const si = detect(inventory);
    const sg = detect(grid);
    const vi = everything(si);
    const vg = everything(sg);
    const start = performance.now();
    writeExcel(inventory, si, vi);
    writeExcel(grid, sg, vg);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

/**
 * The fixture with every shared string turned into an inline string, and `sharedStrings.xml`, its relationship and its
 * content type removed: a workbook as some tools save it.
 */
function withoutSharedStrings(bytes: Uint8Array): Package {
  const pkg = readPackage(bytes);
  const strings = Array.from(partText(pkg, STRINGS)!.matchAll(/<si><t xml:space="preserve">(.*?)<\/t><\/si>/g), (m) => m[1]!);
  const sheet = partText(pkg, SHEET)!.replace(/<c r="([A-Z]+\d+)"( s="\d+")? t="s"><v>(\d+)<\/v><\/c>/g,
    (_m, ref: string, style: string | undefined, index: string) => `<c r="${ref}"${style ?? ''} t="inlineStr"><is><t>${strings[Number(index)]}</t></is></c>`);
  pkg.entries.set(SHEET, bytesOf(sheet));
  pkg.entries.delete(STRINGS);
  pkg.order = pkg.order.filter((p) => p !== STRINGS);
  pkg.entries.set(WORKBOOK_RELS, bytesOf(partText(pkg, WORKBOOK_RELS)!.replace(/<Relationship [^>]*sharedStrings[^>]*\/>/, '')));
  pkg.entries.set(TYPES, bytesOf(partText(pkg, TYPES)!.replace(/<Override [^>]*sharedStrings[^>]*\/>/, '')));
  return pkg;
}

import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { makeWorkbook } from '../../test/makeWorkbook';
import { readSpreadsheet, UnreadableFileError, UnsupportedFileError } from './readSpreadsheet';

const encode = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer;
const HTML_TABLE = '<table><tr><td>Surname</td></tr><tr><td>Šašić</td></tr></table>';
const book = [{ name: 'Crew', rows: [['Surname', 'DOB', 'No'], ['PETROVIĆ', null, 7]] }, { name: 'Notes', rows: [['x']] }];
const dob = [{ sheet: 0, addr: 'B2', serial: 31052 }];

describe('readSpreadsheet', () => {
  it('reads every sheet of .xlsx and .xls files, turning date-formatted numbers into UTC dates', async () => {
    for (const [fileName, type] of [['CREW.XLSX', 'xlsx'], ['crew.xls', 'biff8']] as const) {
      const sheets = await readSpreadsheet(fileName, makeWorkbook(book, type, dob));
      expect(sheets.map(s => s.name)).toEqual(['Crew', 'Notes']);
      expect(sheets[0].rows[1]).toEqual(['PETROVIĆ', new Date(Date.UTC(1985, 0, 5)), 7]);
    }
  });

  it('drops the time of day from a date-formatted number', async () => {
    const sheets = await readSpreadsheet('a.xlsx', makeWorkbook([{ name: 'S', rows: [['d']] }], 'xlsx', [{ sheet: 0, addr: 'A2', serial: 31052.75 }]));
    expect(sheets[0].rows[1][0]).toEqual(new Date(Date.UTC(1985, 0, 5)));
  });

  it('maps a sheet whose used range starts at C3 onto sheet rows and columns', async () => {
    // aoa_to_sheet with an origin still writes a range from A1, so the second fixture sets a range that really starts at C3.
    const offset = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(offset, XLSX.utils.aoa_to_sheet([['Surname']], { origin: 'C3' } as XLSX.AOA2SheetOpts), 'S');
    const grid = (await readSpreadsheet('o.xlsx', XLSX.write(offset, { type: 'array', bookType: 'xlsx' })))[0].rows;
    expect(grid[2][2]).toBe('Surname');
    expect(grid[0][0]).toBeNull();

    for (const bookType of ['xlsx', 'biff8'] as const) {
      const lower = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(lower, { C3: { t: 's', v: 'Surname' }, D4: { t: 'n', v: 7 }, '!ref': 'C3:D4' }, 'S');
      const read = XLSX.read(XLSX.write(lower, { type: 'array', bookType }), { type: 'array' });
      expect(read.Sheets.S['!ref']).toBe('C3:D4');
      const rows = (await readSpreadsheet('o.xlsx', XLSX.write(lower, { type: 'array', bookType })))[0].rows;
      expect(rows).toEqual([[null, null, null, null], [null, null, null, null], [null, null, 'Surname', null], [null, null, null, 7]]);
    }
  });

  it('reads strings, numbers, booleans and errors from cells', async () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([['text', 12.5, true]]);
    ws.D1 = { t: 'e', v: 7, w: '#DIV/0!' };
    ws['!ref'] = 'A1:D1';
    XLSX.utils.book_append_sheet(wb, ws, 'S');
    const sheets = await readSpreadsheet('types.xlsx', XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
    expect(sheets[0].rows).toEqual([['text', 12.5, true, null]]);
  });

  it('reads a CSV file as UTF-8, naming the sheet after the file', async () => {
    const csv = await readSpreadsheet('crew.csv', encode('Surname\nŠašić'));
    expect(csv).toEqual([{ name: 'crew', rows: [['Surname'], ['Šašić']] }]);
    expect((await readSpreadsheet('Crew List.2026.CSV', encode('a')))[0].name).toBe('Crew List.2026');
  });

  it('rejects other file types', async () => {
    await expect(readSpreadsheet('crew.pdf', new ArrayBuffer(8))).rejects.toBeInstanceOf(UnsupportedFileError);
    await expect(readSpreadsheet('crew', new ArrayBuffer(8))).rejects.toBeInstanceOf(UnsupportedFileError);
    await expect(readSpreadsheet('crew.xlsx.txt', new ArrayBuffer(8))).rejects.toThrow("This file type isn't supported. Use an Excel file (.xlsx or .xls) or a CSV file.");
  });

  describe('container signature check', () => {
    const xlsx = () => makeWorkbook(book, 'xlsx');
    const biff8 = () => makeWorkbook(book, 'biff8');

    it('accepts a ZIP container for .xlsx and a CFB container for .xls', async () => {
      expect((await readSpreadsheet('a.xlsx', xlsx()))[0].rows[0]).toEqual(['Surname', 'DOB', 'No']);
      expect((await readSpreadsheet('a.xls', biff8()))[0].rows[0]).toEqual(['Surname', 'DOB', 'No']);
    });

    it('accepts either binary container under either extension', async () => {
      expect((await readSpreadsheet('misnamed.xls', xlsx()))[0].name).toBe('Crew');
      expect((await readSpreadsheet('misnamed.xlsx', biff8()))[0].name).toBe('Crew');
    });

    it('reads an HTML table saved as .xls', async () => {
      const sheets = await readSpreadsheet('legacy.xls', encode(HTML_TABLE));
      expect(sheets[0].rows).toEqual([['Surname'], ['Šašić']]);
    });

    it('reads HTML .xls files that start with a BOM and/or whitespace', async () => {
      const bom = [0xef, 0xbb, 0xbf];
      for (const prefix of [bom, [...bom, 0x0d, 0x0a, 0x20], [0x09], [0x20, 0x20]]) {
        const bytes = new Uint8Array([...prefix, ...new TextEncoder().encode(HTML_TABLE)]);
        expect((await readSpreadsheet('legacy.xls', bytes.buffer))[0].rows).toEqual([['Surname'], ['Šašić']]);
      }
    });

    it('reads an XML spreadsheet saved as .xls', async () => {
      const xml = '<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">'
        + '<Worksheet ss:Name="Crew"><Table><Row><Cell><ss:Data ss:Type="String">Surname</ss:Data></Cell></Row></Table></Worksheet></Workbook>';
      expect(await readSpreadsheet('legacy.xls', encode(xml))).toEqual([{ name: 'Crew', rows: [['Surname']] }]);
    });

    it('rejects text that is not a workbook, under either extension', async () => {
      await expect(readSpreadsheet('crew.xlsx', encode('not a workbook \u0000\u0001'))).rejects.toBeInstanceOf(UnreadableFileError);
      await expect(readSpreadsheet('crew.xls', encode('Surname,Rank\nPetrović,Master'))).rejects.toBeInstanceOf(UnreadableFileError);
    });

    it('rejects markup that SheetJS cannot read as a workbook', async () => {
      await expect(readSpreadsheet('crew.xls', encode('<hello world'))).rejects.toBeInstanceOf(UnreadableFileError);
    });

    it('does not accept HTML for .xlsx', async () => {
      await expect(readSpreadsheet('crew.xlsx', encode(HTML_TABLE))).rejects.toBeInstanceOf(UnreadableFileError);
    });

    it('rejects empty and tiny files', async () => {
      await expect(readSpreadsheet('crew.xlsx', new ArrayBuffer(0))).rejects.toBeInstanceOf(UnreadableFileError);
      await expect(readSpreadsheet('crew.xls', new Uint8Array([0x50, 0x4b]).buffer)).rejects.toBeInstanceOf(UnreadableFileError);
    });

    it('turns a failure inside SheetJS into UnreadableFileError', async () => {
      await expect(readSpreadsheet('crew.xlsx', xlsx().slice(0, 100))).rejects.toBeInstanceOf(UnreadableFileError);
    });

    it('treats a password-protected workbook (a CFB container SheetJS refuses) as unreadable', async () => {
      const cfb = XLSX.CFB.utils.cfb_new();
      XLSX.CFB.utils.cfb_add(cfb, 'EncryptionInfo', new Uint8Array([4, 0, 4, 0, 0x40, 0, 0, 0]));
      XLSX.CFB.utils.cfb_add(cfb, 'EncryptedPackage', new Uint8Array(64));
      const bytes = new Uint8Array(XLSX.CFB.write(cfb, { type: 'array' }));
      await expect(readSpreadsheet('locked.xlsx', bytes.buffer)).rejects.toThrow("This file can't be read. If it's password-protected in Excel, remove the password, save it again and retry.");
    });
  });
});

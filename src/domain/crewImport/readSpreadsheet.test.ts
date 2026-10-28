import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { makeWorkbook } from '../../test/makeWorkbook';
import { EncodingError, readSpreadsheet, sheetToGrid, SpreadsheetError, TooLargeFileError, UnreadableFileError, UnsupportedFileError } from './readSpreadsheet';

const encode = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer;
const HTML_TABLE = '<table><tr><td>Surname</td></tr><tr><td>Šašić</td></tr></table>';
const CSV_ENCODING_MESSAGE = "This CSV file isn't saved as UTF-8, so letters like Š, Ć or Đ would be garbled. In Excel choose File → Save As → CSV UTF-8 (Comma delimited), or import the .xlsx file instead.";
const MARKUP_ENCODING_MESSAGE = "This file's text encoding can't be read reliably. Open it in Excel, save it as an Excel Workbook (.xlsx), then import that file.";
const TOO_LARGE_MESSAGE = 'This sheet is too large to import (more than 5,000 rows or 200 columns of data). Copy the crew list into a new workbook and import that.';
const WINDOWS_1250: Record<string, number> = { Š: 0x8a, š: 0x9a, ć: 0xe6 };
/** Windows-1250 bytes for text that only uses ASCII and the few letters above. */
const windows1250 = (text: string): ArrayBuffer => Uint8Array.from([...text].map(ch => WINDOWS_1250[ch] ?? ch.charCodeAt(0))).buffer;
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

  it('rejects a CSV that is not valid UTF-8, such as Excel\'s windows-1250 CSV', async () => {
    const error = await readSpreadsheet('crew.csv', windows1250('Surname\nŠašić')).catch(e => e);
    expect(error).toBeInstanceOf(EncodingError);
    expect(error.message).toBe(CSV_ENCODING_MESSAGE);
  });

  it('strips the BOM of a UTF-8 CSV', async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('Surname,Rank\nŠašić,Master')]);
    expect((await readSpreadsheet('crew.csv', bytes.buffer))[0].rows).toEqual([['Surname', 'Rank'], ['Šašić', 'Master']]);
  });

  it('shares one base class between all the errors it throws', async () => {
    const errors = [new UnsupportedFileError(), new UnreadableFileError(), new EncodingError(CSV_ENCODING_MESSAGE), new TooLargeFileError()];
    for (const error of errors) expect(error).toBeInstanceOf(SpreadsheetError);
    expect(errors.map(e => e.name)).toEqual(['UnsupportedFileError', 'UnreadableFileError', 'EncodingError', 'TooLargeFileError']);
    expect(new TooLargeFileError().message).toBe(TOO_LARGE_MESSAGE);
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

    it('reads windows-1250 HTML when the file declares its charset', async () => {
      const html = (head: string) => windows1250(`<html><head>${head}</head><body><table><tr><td>Surname</td></tr><tr><td>Šašić</td></tr></table></body></html>`);
      for (const head of ['<meta charset="windows-1250">', '<meta http-equiv=Content-Type content="text/html; charset=windows-1250">']) {
        expect((await readSpreadsheet('legacy.xls', html(head)))[0].rows).toEqual([['Surname'], ['Šašić']]);
      }
    });

    it('reads a windows-1250 XML spreadsheet that declares its encoding', async () => {
      const xml = windows1250('<?xml version="1.0" encoding="windows-1250"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">'
        + '<Worksheet ss:Name="Crew"><Table><Row><Cell><Data ss:Type="String">Šašić</Data></Cell></Row></Table></Worksheet></Workbook>');
      expect(await readSpreadsheet('legacy.xls', xml)).toEqual([{ name: 'Crew', rows: [['Šašić']] }]);
    });

    it('never guesses the encoding of non-UTF-8 markup', async () => {
      const undeclared = windows1250(`<html><body>${HTML_TABLE}</body></html>`);
      const unknown = windows1250(`<html><head><meta charset="x-no-such-charset"></head><body>${HTML_TABLE}</body></html>`);
      const lying = windows1250(`<html><head><meta charset="utf-8"></head><body>${HTML_TABLE}</body></html>`);
      for (const bytes of [undeclared, unknown, lying]) {
        const error = await readSpreadsheet('legacy.xls', bytes).catch(e => e);
        expect(error).toBeInstanceOf(EncodingError);
        expect(error.message).toBe(MARKUP_ENCODING_MESSAGE);
      }
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

describe('the size of a CSV file', () => {
  const rowsOf = (count: number): string => Array.from({ length: count }, (_, i) => `Name${i},P${i}`).join('\n');

  it('is limited to 5,000 rows and 200 columns, as a workbook is', async () => {
    expect((await readSpreadsheet('crew.csv', encode(rowsOf(5000))))[0].rows).toHaveLength(5000);
    await expect(readSpreadsheet('crew.csv', encode(rowsOf(5001)))).rejects.toBeInstanceOf(TooLargeFileError);
    await expect(readSpreadsheet('crew.csv', encode(rowsOf(5001)))).rejects.toThrow(TOO_LARGE_MESSAGE);
    const wide = (columns: number): ArrayBuffer => encode(Array.from({ length: columns }, (_, i) => `C${i}`).join(','));
    expect((await readSpreadsheet('crew.csv', wide(200)))[0].rows[0]).toHaveLength(200);
    await expect(readSpreadsheet('crew.csv', wide(201))).rejects.toBeInstanceOf(TooLargeFileError);
  });

  it('does not count the empty rows at the end', async () => {
    expect((await readSpreadsheet('crew.csv', encode(`${rowsOf(5000)}\n\n,\n`)))[0].rows).toHaveLength(5000);
  });
});

describe('1904 date system', () => {
  it('reads date-formatted serials of a 1904-system workbook as the same calendar date', async () => {
    for (const bookType of ['xlsx', 'biff8'] as const) {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, { A1: { t: 'n', v: 29590.5, z: 'dd.mm.yyyy' }, B1: { t: 'n', v: 7 }, '!ref': 'A1:B1' }, 'S');
      wb.Workbook = { WBProps: { date1904: true } };
      const sheets = await readSpreadsheet('old.xls', XLSX.write(wb, { type: 'array', bookType }));
      expect(sheets[0].rows).toEqual([[new Date(Date.UTC(1985, 0, 5)), 7]]);
    }
  });
});

describe('sheetToGrid', () => {
  const text = (v: string): XLSX.CellObject => ({ t: 's', v });

  it('does not walk a huge declared range, only the cells that exist', () => {
    const sheet: XLSX.WorkSheet = { '!ref': 'A1:XFD1048576', A1: text('Surname'), C1: { t: 'n', v: 7 }, A3: { t: 'b', v: true }, B4: text('end') };
    const started = performance.now();
    const rows = sheetToGrid(sheet);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(rows).toEqual([['Surname', null, 7], [null, null, null], [true, null, null], [null, 'end', null]]);
  });

  it('stops at the end of the declared range when cells exist beyond it', () => {
    expect(sheetToGrid({ '!ref': 'A1:B2', A1: text('a'), D4: text('outside') })).toEqual([['a', null], [null, null]]);
  });

  it('returns no rows for a sheet without cells or without a range', () => {
    expect(sheetToGrid({})).toEqual([]);
    expect(sheetToGrid({ '!ref': 'A1:C3' })).toEqual([]);
  });

  it('accepts data right up to 5,000 rows and 200 columns', () => {
    const tall = sheetToGrid({ '!ref': 'A1:XFD1048576', A5000: text('last row') });
    expect(tall).toHaveLength(5000);
    expect(tall[4999][0]).toBe('last row');
    const wide = sheetToGrid({ '!ref': 'A1:XFD1048576', [XLSX.utils.encode_cell({ r: 0, c: 199 })]: text('last column') });
    expect(wide[0]).toHaveLength(200);
    expect(wide[0][199]).toBe('last column');
  });

  it('throws TooLargeFileError for data beyond 5,000 rows or 200 columns', () => {
    const farRow = { '!ref': 'A1:XFD1048576', A1: text('x'), A5001: text('too far down') };
    const farColumn = { '!ref': 'A1:XFD1048576', A1: text('x'), [XLSX.utils.encode_cell({ r: 0, c: 200 })]: text('too far right') };
    for (const sheet of [farRow, farColumn]) {
      expect(() => sheetToGrid(sheet)).toThrow(TooLargeFileError);
      expect(() => sheetToGrid(sheet)).toThrow(TOO_LARGE_MESSAGE);
    }
  });

  it('lets TooLargeFileError through readSpreadsheet instead of calling the file unreadable', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, { A1: text('x'), A5001: text('too far down'), '!ref': 'A1:A5001' }, 'S');
    await expect(readSpreadsheet('big.xlsx', XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))).rejects.toBeInstanceOf(TooLargeFileError);
  });
});

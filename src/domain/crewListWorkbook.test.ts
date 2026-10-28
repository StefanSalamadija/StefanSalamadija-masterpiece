import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { readSpreadsheet } from './crewImport/readSpreadsheet';
import type { Cell } from './crewImport/readSpreadsheet';
import { buildCrewList, CREW_LIST_COLUMNS } from './crewList';
import { crewListWorkbook } from './crewListWorkbook';
import type { CrewMember, ShipProfile } from './types';

const ship: ShipProfile = {
  id: 'ship-1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'test-device',
  deleted: false, scope: 'ship',
  particulars: {
    name: 'MV OCEAN STAR', imo: '9074729', callSign: '9HAB2', mmsi: '', flag: 'Malta', portOfRegistry: 'Valletta',
    owners: '', managers: '', pandi: '', classSociety: '',
  },
};

function member(over: Partial<CrewMember> = {}): CrewMember {
  return {
    id: 'crew-1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'test-device', deleted: false, scope: 'ship', shipId: 'ship-1',
    surname: 'PETROVIĆ', givenNames: 'Ivan', rank: 'master', nationality: 'Serbian',
    dateOfBirth: '1985-01-05', placeOfBirth: 'Kotor', passportNo: '012345678', passportExpiry: '2030-03-01',
    seamansBookNo: 'SB-998', seamansBookExpiry: '2029-07-15', signOnDate: '2026-06-01', signOnPort: 'Rotterdam',
    ...over,
  };
}

const DEFAULTS = CREW_LIST_COLUMNS.filter((c) => c.byDefault).map((c) => c.key);
const table = buildCrewList({
  crew: [member(), member({ id: 'crew-2', surname: "O'BRIEN", givenNames: 'Jean-Luc', rank: 'ab', signOnPort: '' })],
  docs: [], columns: DEFAULTS, asAt: '2026-10-25', filter: 'onboard',
});

/** A row as the sheet has it: the grid is a rectangle, so the empty cells after the last one are cut off. */
function trimmed(row: Cell[]): Cell[] {
  let end = row.length;
  while (end > 0 && row[end - 1] === null) end -= 1;
  return row.slice(0, end);
}

async function read(workbook: ArrayBuffer) {
  const sheets = await readSpreadsheet('crew-list.xlsx', workbook);
  return { sheets, rows: sheets[0].rows.map(trimmed) };
}

describe('crewListWorkbook', () => {
  it('makes one sheet named Crew list, with the title, the ship, the port and date, a blank row, the headers and the crew', async () => {
    const workbook = crewListWorkbook({ ship, port: 'Rotterdam', date: '2026-10-25', table });
    const { sheets, rows } = await read(workbook);
    expect(sheets).toHaveLength(1);
    expect(sheets[0].name).toBe('Crew list');
    expect(rows.slice(0, 6)).toEqual([
      ['CREW LIST'],
      ['Vessel', 'MV OCEAN STAR', 'IMO', '9074729'],
      ['Call sign', '9HAB2', 'Flag', 'Malta'],
      ['Port', 'Rotterdam', 'Date', '25-OCT-2026'],
      [],
      table.headers,
    ]);
    expect(rows[6]).toEqual(table.rows[0]);
    expect(rows).toHaveLength(8);
  });

  it('is an .xlsx file: a zip', () => {
    const bytes = new Uint8Array(crewListWorkbook({ ship, port: '', date: '2026-10-25', table }));
    expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it('keeps blank values blank, and the letters and the leading zeros of the crew as they are', async () => {
    const { sheets, rows } = await read(crewListWorkbook({ ship, port: '', date: '2026-10-25', table }));
    expect(rows[3]).toEqual(['Port', null, 'Date', '25-OCT-2026']);
    expect(rows[6][1]).toBe('PETROVIĆ');
    expect(rows[6][7]).toBe('012345678');
    expect(rows[7].slice(1, 3)).toEqual(["O'BRIEN", 'Jean-Luc']);
    expect(sheets[0].rows[7][10]).toBeNull();             // the sign-on port that was blank
  });

  it('has a sheet with only the headers when nobody is onboard', async () => {
    const empty = { headers: table.headers, rows: [] };
    const { rows } = await read(crewListWorkbook({ ship, port: 'Rotterdam', date: '2026-10-25', table: empty }));
    expect(rows).toHaveLength(6);
    expect(rows[5]).toEqual(table.headers);
  });

  it('has a date it cannot format left as given', async () => {
    const { rows } = await read(crewListWorkbook({ ship, port: 'Rotterdam', date: '', table }));
    expect(rows[3]).toEqual(['Port', 'Rotterdam', 'Date']);
  });

  it('writes a sheet from a damaged record and a ship with details missing, as text: a missing value is blank and a number is its digits', async () => {
    const bare = { ...ship, particulars: { ...ship.particulars, imo: undefined as unknown as string, callSign: 9 as unknown as string } };
    const damaged = { headers: ['Surname', 'Given names', 'Place of birth'], rows: [[undefined, 7, 'Kotor'], [null, 'Ivan', 42]] as unknown as string[][] };
    const { rows } = await read(crewListWorkbook({ ship: bare, port: undefined as unknown as string, date: '2026-10-25', table: damaged }));
    expect(rows.slice(0, 4)).toEqual([['CREW LIST'], ['Vessel', 'MV OCEAN STAR', 'IMO'], ['Call sign', '9', 'Flag', 'Malta'], ['Port', null, 'Date', '25-OCT-2026']]);
    expect(rows.slice(5)).toEqual([['Surname', 'Given names', 'Place of birth'], [null, '7', 'Kotor'], [null, 'Ivan', '42']]);
  });

  describe('the cells in the file', () => {
    /** The XML of the first sheet and the shared strings, taken out of the zip as the file is, without SheetJS reading any cell. */
    function parts(workbook: ArrayBuffer): { sheet: string; strings: string } {
      const zip = XLSX.CFB.read(new Uint8Array(workbook), { type: 'array' });
      const text = (name: string): string => {
        const part = XLSX.CFB.find(zip, `/${name}`);
        return part ? new TextDecoder().decode(part.content as Uint8Array) : '';
      };
      return { sheet: text('xl/worksheets/sheet1.xml'), strings: text('xl/sharedStrings.xml') };
    }

    const nasty = '=HYPERLINK("http://example.com","x")';
    const workbook = crewListWorkbook({
      ship: { ...ship, particulars: { ...ship.particulars, name: nasty } }, port: '+SUM(A1)', date: '2026-10-25',
      table: buildCrewList({ crew: [member({ surname: nasty, givenNames: '@SUM(A1)' })], docs: [], columns: DEFAULTS, asAt: '2026-10-25', filter: 'onboard' }),
    });

    it('are shared-string cells (t="s"), with no formula (<f>) and no formula-result string (t="str") or inline string', () => {
      const { sheet } = parts(workbook);
      expect(sheet).not.toMatch(/<f[\s>/]/);
      expect(sheet).not.toContain('t="str"');
      expect(sheet).not.toContain('t="inlineStr"');
      expect(sheet).not.toMatch(/<is>/);
      const types = [...sheet.matchAll(/<c [^>]*t="([^"]+)"/g)].map((match) => match[1]);
      expect(types.length).toBeGreaterThan(20);
      expect(new Set(types)).toEqual(new Set(['s']));
      expect(sheet).not.toMatch(/<c (?![^>]*t="s")[^>]*>/);              // every cell has a type, and it is s
    });

    it('keep the text of a formula in the shared strings, as text', () => {
      const { strings } = parts(workbook);
      expect(strings).toContain('=HYPERLINK(&quot;http://example.com&quot;,&quot;x&quot;)');
      expect(strings).toContain('+SUM(A1)');
      expect(strings).toContain('@SUM(A1)');
    });
  });

  describe('formulas', () => {
    const risky = ['=HYPERLINK("http://example.com","x")', '=1+1', '+SUM(A1)', '-2+3', '@SUM(A1)', '=cmd|\' /C calc\'!A0'];

    it.each(risky)('keeps %s as the text it is: a string cell, no formula', async (text) => {
      const shipNamed = { ...ship, particulars: { ...ship.particulars, name: text } };
      const people = buildCrewList({
        crew: [member({ surname: text, givenNames: text, placeOfBirth: text, signOnPort: text })],
        docs: [], columns: DEFAULTS, asAt: '2026-10-25', filter: 'onboard',
      });
      const workbook = crewListWorkbook({ ship: shipNamed, port: text, date: '2026-10-25', table: people });

      const { rows } = await read(workbook);
      expect(rows[1][1]).toBe(text);
      expect(rows[3][1]).toBe(text);
      expect(rows[6].slice(1, 3)).toEqual([text, text]);
      expect(rows[6][6]).toBe(text);

      // Read the cells as SheetJS holds them, formulas included: every one is a string, none has a formula.
      const book = XLSX.read(workbook, { type: 'array', cellFormula: true });
      const sheet = book.Sheets[book.SheetNames[0]];
      const cells = Object.entries(sheet).filter(([address]) => !address.startsWith('!'));
      expect(cells.length).toBeGreaterThan(20);
      for (const [address, cell] of cells) {
        const found = cell as XLSX.CellObject;
        expect(found.t, address).toBe('s');
        expect(found.f, address).toBeUndefined();
      }
    });
  });

  it('keeps text that looks like a number or a date as text', async () => {
    const looks = buildCrewList({
      crew: [member({ passportNo: '1E5', seamansBookNo: '12/05', placeOfBirth: '1.50', signOnPort: 'TRUE' })],
      docs: [], columns: ['placeOfBirth', 'passportNo', 'seamansBookNo', 'signOnPort'], asAt: '2026-10-25', filter: 'onboard',
    });
    const { rows } = await read(crewListWorkbook({ ship, port: '', date: '2026-10-25', table: looks }));
    expect(rows[6]).toEqual(['1.50', '1E5', '12/05', 'TRUE']);
  });
});

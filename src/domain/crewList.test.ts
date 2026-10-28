import { describe, expect, it } from 'vitest';
import {
  asText, buildCrewList, CREW_LIST_COLUMNS, crewListColumnsOf, crewListFileName, DEFAULT_CREW_LIST_COLUMNS, masterName, shownColumns,
} from './crewList';
import type { CrewListColumn, CrewDocument, CrewMember, ShipProfile } from './types';

let seq = 0;
function member(over: Partial<CrewMember> = {}): CrewMember {
  seq += 1;
  return {
    id: `crew-${seq}`, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'test-device', deleted: false, scope: 'ship', shipId: 'ship-1',
    surname: 'PETROVIĆ', givenNames: 'Ivan', rank: 'master', nationality: 'Serbian',
    dateOfBirth: '1985-01-05', placeOfBirth: 'Kotor', passportNo: '012345678', passportExpiry: '2030-03-01',
    seamansBookNo: 'SB-998', seamansBookExpiry: '2029-07-15', signOnDate: '2026-06-01', signOnPort: 'Rotterdam',
    ...over,
  };
}

function document(over: Partial<CrewDocument> = {}): CrewDocument {
  seq += 1;
  return {
    id: `doc-${seq}`, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'test-device', deleted: false, scope: 'ship', shipId: 'ship-1', crewId: 'crew-x', type: 'coc',
    grade: 'Master (unlimited)', number: 'CoC-123', issuedBy: 'Maritime Administration', issueDate: '2024-01-01',
    remarks: '',
    ...over,
  };
}

const master = member({ id: 'master' });
const ab = member({
  id: 'ab', surname: "O'BRIEN", givenNames: 'Jean-Luc', rank: 'ab', nationality: 'Irish', dateOfBirth: '1990-02-28',
  placeOfBirth: 'Cork', passportNo: 'X1', passportExpiry: '2031-12-31', signOnDate: '2026-08-10', signOnPort: 'Antwerp',
});
const offSigned = member({
  id: 'off', surname: 'ŠAŠIĆ', givenNames: 'Marko', rank: 'thirdOfficer', signOnDate: '2026-01-10', signOffDate: '2026-09-01',
});
const cocDoc = document({ crewId: 'master' });

const DEFAULTS = CREW_LIST_COLUMNS.filter((c) => c.byDefault).map((c) => c.key);

describe('CREW_LIST_COLUMNS', () => {
  it('lists every column in the order of the sheet, with its label', () => {
    expect(CREW_LIST_COLUMNS.map((c) => [c.key, c.label])).toEqual([
      ['no', 'No.'], ['surname', 'Surname'], ['givenNames', 'Given names'], ['rank', 'Rank'], ['nationality', 'Nationality'],
      ['dateOfBirth', 'Date of birth'], ['placeOfBirth', 'Place of birth'], ['passportNo', 'Passport no.'],
      ['passportExpiry', 'Passport expiry'], ['seamansBookNo', "Seaman's book no."], ['seamansBookExpiry', "Seaman's book expiry"],
      ['signOnDate', 'Sign-on date'], ['signOnPort', 'Sign-on port'], ['cocNumber', 'CoC no.'], ['contractEnd', 'Contract end'],
    ]);
  });

  it('has the first nine columns, the sign-on date and the sign-on port on by default', () => {
    expect(DEFAULTS).toEqual([
      'no', 'surname', 'givenNames', 'rank', 'nationality', 'dateOfBirth', 'placeOfBirth', 'passportNo', 'passportExpiry',
      'signOnDate', 'signOnPort',
    ]);
    expect(DEFAULT_CREW_LIST_COLUMNS).toEqual(DEFAULTS);
  });
});

describe('the kind of each column', () => {
  it('is a date for every date, a number for every number, and text for names and places', () => {
    const kinds = Object.fromEntries(CREW_LIST_COLUMNS.map((c) => [c.key, c.kind]));
    expect(kinds).toEqual({
      no: 'number', surname: 'text', givenNames: 'text', rank: 'text', nationality: 'text', dateOfBirth: 'date', placeOfBirth: 'text',
      passportNo: 'number', passportExpiry: 'date', seamansBookNo: 'number', seamansBookExpiry: 'date', signOnDate: 'date',
      signOnPort: 'text', cocNumber: 'number', contractEnd: 'date',
    });
  });
});

describe('shownColumns', () => {
  it('is the chosen columns, with their labels and kinds, in the order of the sheet', () => {
    expect(shownColumns(['contractEnd', 'surname', 'no']).map((c) => [c.key, c.label, c.kind])).toEqual([
      ['no', 'No.', 'number'], ['surname', 'Surname', 'text'], ['contractEnd', 'Contract end', 'date'],
    ]);
  });
});

describe('asText', () => {
  it('is the text of a value, and an empty text for what is missing', () => {
    expect(asText('Ivan')).toBe('Ivan');
    expect(asText(42)).toBe('42');
    expect(asText(undefined)).toBe('');
    expect(asText(null)).toBe('');
    expect(asText('')).toBe('');
  });
});

describe('buildCrewList', () => {
  it('turns a damaged record into text instead of failing: a missing field is empty, and a number is its digits', () => {
    const damaged = member({
      id: 'damaged', surname: undefined as unknown as string, givenNames: 7 as unknown as string, nationality: null as unknown as string,
      placeOfBirth: 42 as unknown as string, dateOfBirth: 19850105 as unknown as string, passportExpiry: undefined as unknown as string,
      rank: 'other', rankOther: 5 as unknown as string,
    });
    const t = buildCrewList({
      crew: [damaged], docs: [document({ crewId: 'damaged', number: 123 as unknown as string })], asAt: '2026-10-25', filter: 'all',
      columns: ['no', 'surname', 'givenNames', 'rank', 'nationality', 'dateOfBirth', 'placeOfBirth', 'passportExpiry', 'cocNumber'],
    });
    expect(t.rows).toEqual([['1', '', '7', 'Other', '', '19850105', '42', '', '123']]);
    for (const cell of t.rows[0]) expect(typeof cell).toBe('string');
  });

  it('builds the default columns for the crew onboard, in rank order, with the signed-off left out', () => {
    const t = buildCrewList({ crew: [ab, master, offSigned], docs: [cocDoc], columns: DEFAULTS, asAt: '2026-10-25', filter: 'onboard' });
    expect(t.headers).toEqual([
      'No.', 'Surname', 'Given names', 'Rank', 'Nationality', 'Date of birth', 'Place of birth', 'Passport no.', 'Passport expiry',
      'Sign-on date', 'Sign-on port',
    ]);
    expect(t.rows.map((r) => r[3])).toEqual(['Master', 'AB']);
    expect(t.rows[0]).toEqual([
      '1', 'PETROVIĆ', 'Ivan', 'Master', 'Serbian', '05-JAN-1985', 'Kotor', '012345678', '01-MAR-2030', '01-JUN-2026', 'Rotterdam',
    ]);
    expect(t.rows[1].slice(0, 3)).toEqual(['2', "O'BRIEN", 'Jean-Luc']);
  });

  it('shows every contract, the signed-off too, for All, in the same order', () => {
    const t = buildCrewList({ crew: [ab, master, offSigned], docs: [], columns: ['no', 'surname', 'rank'], asAt: '2026-10-25', filter: 'all' });
    expect(t.rows).toEqual([['1', 'PETROVIĆ', 'Master'], ['2', 'ŠAŠIĆ', '3rd Officer'], ['3', "O'BRIEN", 'AB']]);
  });

  it('shows who was onboard on the date, not today', () => {
    const build = (asAt: string) => buildCrewList({ crew: [ab, master, offSigned], docs: [], columns: ['surname'], asAt, filter: 'onboard' }).rows;
    expect(build('2026-08-15')).toEqual([['PETROVIĆ'], ['ŠAŠIĆ'], ["O'BRIEN"]]);
    expect(build('2026-08-01')).toEqual([['PETROVIĆ'], ['ŠAŠIĆ']]);
    expect(build('2026-09-01')).toEqual([['PETROVIĆ'], ['ŠAŠIĆ'], ["O'BRIEN"]]);   // the sign-off day itself is onboard
  });

  it('leaves out deleted contracts, with All as well', () => {
    const gone = member({ id: 'gone', surname: 'GONE', deleted: true });
    const t = buildCrewList({ crew: [master, gone], docs: [], columns: ['surname'], asAt: '2026-10-25', filter: 'all' });
    expect(t.rows).toEqual([['PETROVIĆ']]);
  });

  it('numbers the rows 1 to n in the order shown', () => {
    const crew = [1, 2, 3].map((n) => member({ id: `m${n}`, surname: `S${n}`, rank: 'ab', signOnDate: `2026-0${n}-01` }));
    const t = buildCrewList({ crew, docs: [], columns: ['no', 'surname'], asAt: '2026-10-25', filter: 'onboard' });
    expect(t.rows).toEqual([['1', 'S1'], ['2', 'S2'], ['3', 'S3']]);
  });

  it('keeps the order of the sheet whatever order the columns are listed in', () => {
    const reversed: CrewListColumn[] = ['cocNumber', 'surname'];
    expect(buildCrewList({ crew: [ab, master, offSigned], docs: [cocDoc], columns: reversed, asAt: '2026-10-25', filter: 'all' }).headers)
      .toEqual(['Surname', 'CoC no.']);
    expect(buildCrewList({ crew: [master], docs: [cocDoc], columns: ['surname', 'cocNumber'], asAt: '2026-10-25', filter: 'all' }).rows[0])
      .toEqual(['PETROVIĆ', 'CoC-123']);
    expect(buildCrewList({ crew: [master], docs: [cocDoc], columns: reversed, asAt: '2026-10-25', filter: 'all' }).rows[0])
      .toEqual(['PETROVIĆ', 'CoC-123']);
  });

  it('writes the dates of the optional columns as DD-MMM-YYYY', () => {
    const withContract = member({ id: 'c', contractMonths: 4 });
    const t = buildCrewList({
      crew: [withContract], docs: [], asAt: '2026-10-25', filter: 'all',
      columns: ['seamansBookNo', 'seamansBookExpiry', 'contractEnd'],
    });
    expect(t.headers).toEqual(["Seaman's book no.", "Seaman's book expiry", 'Contract end']);
    expect(t.rows).toEqual([['SB-998', '15-JUL-2029', '01-OCT-2026']]);
  });

  it('leaves the contract end blank for a contract with no length', () => {
    expect(buildCrewList({ crew: [master], docs: [], columns: ['contractEnd'], asAt: '2026-10-25', filter: 'all' }).rows).toEqual([['']]);
  });

  it('names the rank typed for Other', () => {
    const other = member({ rank: 'other', rankOther: 'Pilot' });
    expect(buildCrewList({ crew: [other], docs: [], columns: ['rank'], asAt: '2026-10-25', filter: 'all' }).rows).toEqual([['Pilot']]);
  });

  describe('the CoC number', () => {
    const build = (docs: CrewDocument[]) =>
      buildCrewList({ crew: [master], docs, columns: ['cocNumber'], asAt: '2026-10-25', filter: 'all' }).rows[0][0];

    it('is the number of the CoC issued last', () => {
      const older = document({ crewId: 'master', number: 'OLD-1', issueDate: '2019-01-01' });
      expect(build([older, cocDoc])).toBe('CoC-123');
      expect(build([cocDoc, older])).toBe('CoC-123');
    });

    it('ignores other kinds of paper, other people, and deleted papers', () => {
      const medical = document({ crewId: 'master', type: 'medical', number: 'MED-9', issueDate: '2026-01-01' });
      const someoneElse = document({ crewId: 'ab', number: 'OTHER-1', issueDate: '2026-02-01' });
      const deleted = document({ crewId: 'master', number: 'DEL-1', issueDate: '2026-03-01', deleted: true });
      expect(build([medical, someoneElse, deleted, cocDoc])).toBe('CoC-123');
    });

    it('is blank when the contract has none', () => {
      expect(build([])).toBe('');
      expect(build([document({ crewId: 'master', type: 'medical' })])).toBe('');
    });
  });

  it('has no rows, only the headers, when nobody is onboard', () => {
    const t = buildCrewList({ crew: [offSigned], docs: [], columns: ['surname'], asAt: '2026-10-25', filter: 'onboard' });
    expect(t).toEqual({ headers: ['Surname'], rows: [] });
  });

  it('shows a date that is not a date as it is stored', () => {
    const damaged = member({ dateOfBirth: '05.01.1985', passportExpiry: '' });
    expect(buildCrewList({ crew: [damaged], docs: [], columns: ['dateOfBirth', 'passportExpiry'], asAt: '2026-10-25', filter: 'all' }).rows)
      .toEqual([['05.01.1985', '']]);
  });

  it('does not change what it is given', () => {
    const crew = [ab, master];
    const columns: CrewListColumn[] = ['surname', 'no'];
    buildCrewList({ crew, docs: [], columns, asAt: '2026-10-25', filter: 'all' });
    expect(crew).toEqual([ab, master]);
    expect(columns).toEqual(['surname', 'no']);
  });
});

describe('crewListColumnsOf', () => {
  const ship = (crewListColumns?: unknown) => ({ crewListColumns }) as Pick<ShipProfile, 'crewListColumns'>;

  it('is the default columns for a ship that has chosen none', () => {
    expect(crewListColumnsOf(ship())).toEqual(DEFAULTS);
  });

  it('is the chosen columns, in the order of the sheet', () => {
    expect(crewListColumnsOf(ship(['cocNumber', 'surname', 'no']))).toEqual(['no', 'surname', 'cocNumber']);
  });

  it('ignores a key it does not know, and a key repeated', () => {
    expect(crewListColumnsOf(ship(['surname', 'shoeSize', 'surname', 7, null]))).toEqual(['surname']);
  });

  it('is the default columns when the stored value is empty, or nothing in it is a column', () => {
    expect(crewListColumnsOf(ship([]))).toEqual(DEFAULTS);
    expect(crewListColumnsOf(ship(['shoeSize']))).toEqual(DEFAULTS);
  });

  it('is the default columns when the stored value is not a list', () => {
    for (const damaged of [null, 'surname', 7, { surname: true }, true]) expect(crewListColumnsOf(ship(damaged)), String(damaged)).toEqual(DEFAULTS);
  });

  it('gives a new list each time, so that a caller cannot change the defaults', () => {
    crewListColumnsOf(ship()).push('cocNumber');
    expect(crewListColumnsOf(ship())).toEqual(DEFAULTS);
  });
});

describe('masterName', () => {
  it('is the full name of the Master onboard on the date', () => {
    expect(masterName([ab, master, offSigned], '2026-10-25')).toBe('Ivan PETROVIĆ');
  });

  it('is the name of a Master whose record is damaged, without "undefined" in it', () => {
    const nameless = member({ id: 'nameless', givenNames: undefined as unknown as string });
    expect(masterName([nameless], '2026-10-25')).toBe('PETROVIĆ');
  });

  it('is blank when no Master is onboard on the date', () => {
    expect(masterName([ab, offSigned], '2026-10-25')).toBe('');
    expect(masterName([master], '2026-05-31')).toBe('');
    expect(masterName([], '2026-10-25')).toBe('');
  });

  it('does not count a Master who has signed off, or a deleted contract, or another rank', () => {
    const left = member({ id: 'left', signOffDate: '2026-09-30' });
    const deleted = member({ id: 'deleted', deleted: true });
    const chief = member({ id: 'chief', rank: 'chiefOfficer', surname: 'KOVAČ' });
    expect(masterName([left, deleted, chief], '2026-10-25')).toBe('');
    expect(masterName([left], '2026-09-30')).toBe('Ivan PETROVIĆ');
  });

  it('is the first Master of the list when two are onboard on the date', () => {
    const relief = member({ id: 'relief', surname: 'KOVAČ', givenNames: 'Luka', signOnDate: '2026-10-20' });
    expect(masterName([relief, master], '2026-10-25')).toBe('Ivan PETROVIĆ');
  });
});

describe('crewListFileName', () => {
  it('names the file after the ship and the date, in a form every file system takes', () => {
    expect(crewListFileName('M/V Ocean Star', '2026-10-25')).toBe('crew-list-m-v-ocean-star-2026-10-25.xlsx');
    expect(crewListFileName('MV OCEAN STAR', '2026-10-25')).toBe('crew-list-mv-ocean-star-2026-10-25.xlsx');
    expect(crewListFileName('Šibenik Đuro', '2026-10-25')).toBe('crew-list-sibenik-duro-2026-10-25.xlsx');
  });

  it('says "ship" when nothing of the name is usable', () => {
    expect(crewListFileName('///', '2026-10-25')).toBe('crew-list-ship-2026-10-25.xlsx');
  });
});

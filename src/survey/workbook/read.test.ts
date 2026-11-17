import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  FAKE_SHIP, fakeHydroRows, IRREGULAR_DRAFT, makeSurveyWorkbook, moveCell,
} from '../../../e2e/fixtures/makeSurveyWorkbook';
import type { FakeHydroRow, SurveyWorkbookOptions } from '../../../e2e/fixtures/makeSurveyWorkbook';
import { missingCells, readSurveyWorkbook } from './read';
import type { ImportedWorkbook } from './read';

function read(options?: SurveyWorkbookOptions): ImportedWorkbook {
  const result = readSurveyWorkbook(makeSurveyWorkbook(options));
  if ('error' in result) throw new Error(`refused: ${result.error}`);
  return result;
}
function refusal(options?: SurveyWorkbookOptions): string {
  const result = readSurveyWorkbook(makeSurveyWorkbook(options));
  if (!('error' in result)) throw new Error('expected a refusal');
  return result.error;
}
const withRows = (edit: (rows: FakeHydroRow[]) => FakeHydroRow[]): SurveyWorkbookOptions => ({ hydroRows: edit(fakeHydroRows()) });

describe('readSurveyWorkbook: the HYDRO table', () => {
  it('reads every row, the irregular one included, from the typed columns and the formulas’ cached values', () => {
    const { hydro, warnings } = read();
    const fake = fakeHydroRows();
    expect(hydro).toHaveLength(61);
    expect(hydro[0].draft).toBe(1);
    expect(hydro.at(-1)!.draft).toBe(6.9);
    expect(hydro.map((row) => row.draft)).toContain(IRREGULAR_DRAFT);
    hydro.forEach((row, i) => {
      expect(row).toMatchObject({ draft: fake[i].draft, displacement: fake[i].displacement, tpc: fake[i].tpc, mtc: fake[i].mtc });
      expect(row.lcbMid).toBe(75 - fake[i].lcfTabled); // the sheet's "LCB from midship" = LBP/2 − "LCF Tabled"
      expect(row.lcfMid).toBe(75 - fake[i].lcbTabled); // the sheet's "LCF from midship" = LBP/2 − "LCB Tabled"
      expect(row.lcfTabledMid).toBe(FAKE_SHIP.lbp / 2 - fake[i].lcfTabled);
    });
    expect(warnings).toEqual([]);
  });

  it('refuses drafts out of order', () => {
    const error = refusal(withRows((rows) => { [rows[10], rows[11]] = [rows[11], rows[10]]; return rows; }));
    expect(error).toMatch(/isn't in draught order/);
  });

  it('refuses a repeated draft', () => {
    expect(refusal(withRows((rows) => { rows[11] = { ...rows[11], draft: rows[10].draft }; return rows; }))).toMatch(/isn't in draught order/);
  });

  it('refuses a gap of more than 0.1 m, but takes steps of exactly 0.1 m', () => {
    expect(refusal(withRows((rows) => rows.filter((_, i) => i !== 20)))).toMatch(/gap of more than 0\.1 m/);
    expect(read().hydro.length).toBe(61); // 0.1 m steps, which are not exactly 0.1 in binary
  });

  it('refuses a missing column, naming it', () => {
    expect(refusal({ hydroHeaders: { F: null } })).toMatch(/"LCF from midship"/);
    expect(refusal({ hydroHeaders: { C: null, D: null } })).toMatch(/"TPC".*"MTC"/);
  });

  it('refuses a table with no rows', () => {
    expect(refusal({ hydroRows: [] })).toMatch(/no table rows/);
  });

  it('refuses a number missing from a row', () => {
    const error = refusal({ edit: (book) => { delete book.Sheets.HYDRO.C10; } });
    expect(error).toMatch(/row 10/);
  });

  it('refuses formula cells that have no saved value', () => {
    const error = refusal({ edit: (book) => { delete book.Sheets.HYDRO.F5.v; book.Sheets.HYDRO.F5.t = 'z'; } });
    expect(error).toMatch(/row 5/);
  });

  it('reads the headers whatever their case, spacing and line breaks', () => {
    const { hydro } = read({ hydroHeaders: { A: ' DRAUGHT ', F: 'LCF  from\r\nMidship' } });
    expect(hydro).toHaveLength(61);
  });

  it('works without the "LCF Tabled" column, with a warning, and no tabled LCF', () => {
    const { hydro, warnings } = read({ hydroHeaders: { H: null } });
    expect(hydro[0].lcfTabledMid).toBeUndefined();
    expect(warnings.join(' ')).toMatch(/LCF Tabled/);
  });
});

describe('readSurveyWorkbook: the ship data and look-up ranges', () => {
  it('reads the particulars from the INITIAL sheet’s labels, numbers with units included', () => {
    const { ship } = read();
    expect(ship).toEqual({
      lbp: FAKE_SHIP.lbp, dF: FAKE_SHIP.dF, dM: FAKE_SHIP.dM, dA: FAKE_SHIP.dA, beam: FAKE_SHIP.beam,
      keelPlateCorr: 0, lightShip: FAKE_SHIP.lightShip, summerDraught: FAKE_SHIP.summerDraught, summerDwt: FAKE_SHIP.summerDwt,
      depth: FAKE_SHIP.depth, gt: FAKE_SHIP.gt, lcfSource: 'workbook',
      ranges: { initial: { dispTpcMtcFrom: 2.5, lcfFrom: 1 }, final: { dispTpcMtcFrom: 4.5, lcfFrom: 4.5 } },
    });
  });

  it('takes a decimal comma in a particular written as text', () => {
    const { ship } = read({ edit: (book) => { book.Sheets.INITIAL.H6 = { t: 's', v: '9,85 m' }; } });
    expect(ship.summerDraught).toBe(9.85);
  });

  it('refuses a workbook without an LBP', () => {
    expect(refusal({ edit: (book) => { delete book.Sheets.INITIAL.B11; } })).toMatch(/LBP/);
  });

  it('warns when the three keel-plate corrections differ, and uses the forward one', () => {
    const { ship, warnings } = read({ edit: (book) => { book.Sheets.INITIAL.Z16 = { t: 'n', v: 0.01 }; } });
    expect(ship.keelPlateCorr).toBe(0);
    expect(warnings.join(' ')).toMatch(/keel plate/i);
  });

  it('warns when FINAL’s own dA or LBP differs from INITIAL’s', () => {
    const { warnings } = read({ edit: (book) => { book.Sheets.FINAL.Z11 = { t: 'n', v: 3.3 }; } });
    expect(warnings.join(' ')).toMatch(/FINAL.*dA/);
  });

  it('follows the look-up start rows written in the formulas', () => {
    const edit = (book: XLSX.WorkBook) => {
      for (const cell of Object.values(book.Sheets.FINAL)) {
        if (cell && typeof cell === 'object' && 'f' in cell && typeof cell.f === 'string') cell.f = cell.f.replaceAll('HYDRO!A37:', "'HYDRO'!$A$42:");
      }
    };
    expect(read({ edit }).ship.ranges.final).toEqual({ dispTpcMtcFrom: 5, lcfFrom: 5 });
  });

  it('refuses a missing survey sheet', () => {
    expect(refusal({ edit: (book) => { book.SheetNames = book.SheetNames.filter((name) => name !== 'FINAL'); } })).toMatch(/FINAL/);
  });

  it('refuses a file that is not a workbook', () => {
    expect(readSurveyWorkbook(new TextEncoder().encode('just some text'))).toEqual({ error: expect.stringMatching(/can't be read/) });
  });
});

describe('readSurveyWorkbook: the input cells', () => {
  it('finds every input cell on INITIAL and FINAL from the labels', () => {
    const { cellMap, warnings } = read();
    const deductibles = { ballast: 'I37', freshWater: 'I38', vlsfo: 'I39', lsmgo: 'I40', lubOil: 'I41', other: 'I42' };
    const drafts = { fP: 'I13', fS: 'I14', mP: 'Q13', mS: 'Q14', aP: 'Z13', aS: 'Z14' };
    expect(cellMap.INITIAL).toEqual({
      operation: 'H3', cargoTitle: 'O3', port: 'Z5', cargo: 'P6', terminal: 'Z6', holds: 'P7', date: 'Z7', blQty: 'P8',
      timeFrom: 'Z8', timeTill: 'AC8', windBft: 'R9', swell: 'Z9', ...drafts, density: 'Z29', ...deductibles,
      remarks: 'P37', surveyor: 'E47', chiefOfficer: 'S47',
    });
    // On FINAL the ship and voyage fields are formulas on INITIAL, so they are not inputs there.
    expect(cellMap.FINAL).toEqual({
      terminal: 'Z6', date: 'Z7', blQty: 'P8', timeFrom: 'Z8', timeTill: 'AC8', windBft: 'R9', swell: 'Z9', ...drafts, density: 'Y29',
      ...deductibles, comparedQty: 'Y37', remarks: 'P41', surveyor: 'E47', chiefOfficer: 'S47', finalOwnDA: 'Z11', finalOwnLBP: 'E11',
    });
    expect(missingCells(cellMap)).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('matches labels whatever their case, spaces and colons', () => {
    const { cellMap } = read({ edit: (book) => { book.Sheets.INITIAL.M7 = { t: 's', v: ' HOLDS : ' }; book.Sheets.INITIAL.B37 = { t: 's', v: 'ballast:' }; } });
    expect(cellMap.INITIAL).toMatchObject({ holds: 'P7', ballast: 'I37' });
  });

  it('a moved label leaves the input unmapped: the workbook can\'t be filled, but the numbers are read', () => {
    const result = read({ edit: (book) => { moveCell(book.Sheets.INITIAL, 'B37', 'AT60'); } });
    expect(result.cellMap.INITIAL.ballast).toBeUndefined();
    expect(missingCells(result.cellMap)).toEqual(['INITIAL: Ballast']);
    expect(result.warnings).toEqual([expect.stringMatching(/can't be filled in.*INITIAL: Ballast wasn't found\./)]);
    expect(result.hydro).toHaveLength(61);
    expect(result.ship.lbp).toBe(FAKE_SHIP.lbp);
  });

  it('a moved draft heading leaves its drafts unmapped', () => {
    const result = read({ edit: (book) => { moveCell(book.Sheets.FINAL, 'X12', 'AT12'); } });
    expect(missingCells(result.cellMap)).toEqual(['FINAL: Aft port draft', 'FINAL: Aft starboard draft']);
  });

  it('an input cell that holds a formula is not an input', () => {
    const result = read({ edit: (book) => { book.Sheets.FINAL.Y29 = { t: 'n', v: 1.02, f: 'INITIAL!Z29' }; } });
    expect(result.cellMap.FINAL.density).toBeUndefined();
    expect(missingCells(result.cellMap)).toEqual(['FINAL: Density']);
  });
});

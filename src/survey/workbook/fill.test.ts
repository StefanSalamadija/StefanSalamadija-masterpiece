import { describe, expect, it } from 'vitest';
import { FAKE_FINAL, FAKE_INITIAL, makeSurveyWorkbook } from '../../../e2e/fixtures/makeSurveyWorkbook';
import { partText, readPackage } from '../../forms/package';
import type { Package } from '../../forms/package';
import { loadWorkbook } from '../../forms/excel/workbook';
import type { CellModel, SheetModel } from '../../forms/excel/workbook';
import type { DraftSurvey, DraftSurveyShip } from '../../domain/types';
import { fillSurveyWorkbook, surveyFileName } from './fill';
import type { FillInput } from './fill';
import { readSurveyWorkbook } from './read';
import type { CellMap } from './types';

// The workbook and every figure here are made up (e2e/fixtures/makeSurveyWorkbook.ts).

const template = makeSurveyWorkbook();
const book = readSurveyWorkbook(template);
if ('error' in book) throw new Error(book.error);
const cellMap = book.cellMap;
// dA differs from the template's typed FINAL dA (3.1), so writing FINAL's own dA from the ship record shows.
const ship: DraftSurveyShip = {
  ...book.ship, dA: 3.15, id: 'survey-ship:s1', shipId: 's1', createdAt: '', updatedAt: '', updatedBy: '', deleted: false, scope: 'ship',
};

const base = { shipId: 's1', createdAt: '', updatedAt: '', updatedBy: '', deleted: false, scope: 'ship' as const };
const initial: DraftSurvey = {
  ...base, id: 'i', kind: 'initial', operation: 'discharging', port: 'Newhaven', terminal: 'South Pier', cargo: 'Sand', holds: '1-5',
  date: '2026-10-25', timeFrom: '08:30', timeTill: '09:15', windBft: 5, swell: 1.5, blQty: 9000,
  drafts: { fP: 6.1, fS: 6.12, mP: 6.2, mS: 6.22, aP: 6.3, aS: 6.34 }, density: 1.019,
  deductibles: { ballast: 100.5, freshWater: 90.25, vlsfo: 300, lsmgo: 40, lubOil: 10 },
  surveyor: 'C. Surveyor', chiefOfficer: 'D. Officer', remarks: 'Made-up remark',
};
// Its stored operation is stale ('loading'): the fill follows the initial survey's.
const final: DraftSurvey = {
  ...base, id: 'f', kind: 'final', initialId: 'i', operation: 'loading', terminal: 'South Pier', date: '2026-10-27',
  drafts: { fP: 3.3, fS: 3.32, mP: 3.5, mS: 3.52, aP: 3.7, aS: 3.74 }, density: 1.024,
  deductibles: { ballast: 2000, freshWater: 80, vlsfo: 250, lsmgo: 35, lubOil: 9, other: 1.5 }, comparedQty: 8990,
  surveyor: 'C. Surveyor', chiefOfficer: 'D. Officer',
};

const input = (more: Partial<FillInput>): FillInput => ({ bytes: template, cellMap, ship, shipName: 'Testa Marina', ...more });

function filled(more: Partial<FillInput>): { fileName: string; pkg: Package } {
  const result = fillSurveyWorkbook(input(more));
  if ('error' in result) throw new Error(`refused: ${result.error}`);
  return { fileName: result.fileName, pkg: readPackage(result.bytes) };
}
function refusal(more: Partial<FillInput>): string {
  const result = fillSurveyWorkbook(input(more));
  if (!('error' in result)) throw new Error('expected a refusal');
  return result.error;
}

const original = readPackage(template);
const sheetOf = (pkg: Package, name: string): SheetModel => loadWorkbook(pkg).sheets.find((s) => s.name === name)!;
const pathOf = (name: string) => sheetOf(original, name).path;
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, i) => byte === b[i]);
const shown = (cell: CellModel | undefined) => ({ text: cell?.text ?? '', formula: cell?.formula, styleId: cell?.styleId ?? 0 });

/** The cells of a sheet that differ between the template and the output, by reference. */
function changedCells(pkg: Package, name: string): Set<string> {
  const before = sheetOf(original, name).cells;
  const after = sheetOf(pkg, name).cells;
  const refs = new Set([...before.keys(), ...after.keys()]);
  return new Set([...refs].filter((ref) => JSON.stringify(shown(before.get(ref))) !== JSON.stringify(shown(after.get(ref)))));
}
const cell = (pkg: Package, name: string, ref: string) => sheetOf(pkg, name).cells.get(ref);
const mapped = (sheet: 'INITIAL' | 'FINAL') => new Set(Object.values(cellMap[sheet]));

describe('fillSurveyWorkbook: an initial survey', () => {
  const { pkg } = filled({ initial });

  it('changes only the INITIAL sheet, the shared strings and the workbook part: every other part is the template’s to the byte', () => {
    // The made-up template keeps its text inline, so the writer adds a shared strings part, with its relationship and type.
    expect(original.entries.has('xl/sharedStrings.xml')).toBe(false);
    const allowed = new Set([pathOf('INITIAL'), 'xl/sharedStrings.xml', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', '[Content_Types].xml']);
    expect([...pkg.entries.keys()].sort()).toEqual([...original.entries.keys(), 'xl/sharedStrings.xml'].sort());
    for (const [part, bytes] of original.entries) {
      if (allowed.has(part)) continue;
      expect(same(pkg.entries.get(part)!, bytes), part).toBe(true);
    }
  });

  it('changes only input cells on INITIAL, never a formula, a label or a style', () => {
    const changed = changedCells(pkg, 'INITIAL');
    for (const ref of changed) expect(mapped('INITIAL'), ref).toContain(ref);
    expect(changed.size).toBeGreaterThan(20);
    for (const ref of changed) {
      expect(cell(pkg, 'INITIAL', ref)?.formula).toBeUndefined();
      expect(cell(pkg, 'INITIAL', ref)?.styleId ?? 0).toBe(cell(original, 'INITIAL', ref)?.styleId ?? 0);
    }
  });

  it('writes the survey’s inputs into their cells', () => {
    const at = (key: keyof CellMap['INITIAL']) => cell(pkg, 'INITIAL', cellMap.INITIAL[key]!)?.text;
    expect(at('fP')).toBe('6.1');
    expect(at('aS')).toBe('6.34');
    expect(at('density')).toBe('1.019');
    expect(at('ballast')).toBe('100.5');
    expect(at('freshWater')).toBe('90.25');
    expect(at('port')).toBe('Newhaven');
    expect(at('cargo')).toBe('Sand');
    expect(at('cargoTitle')).toBe('Sand');
    expect(at('operation')).toBe('Discharging of');
    expect(at('surveyor')).toBe('C. Surveyor');
    expect(at('remarks')).toBe('Made-up remark');
    expect(at('windBft')).toBe('5');
    expect(at('blQty')).toBe('9000');
  });

  it('clears an input the survey leaves empty, so the template’s old value does not stay', () => {
    // The made-up template has "Other" 0 and the survey none; a cleared deductible counts as 0, as in the app.
    const other = cell(pkg, 'INITIAL', cellMap.INITIAL.other!);
    expect(other?.text ?? '').toBe('');
    const { pkg: noPort } = filled({ initial: { ...initial, port: undefined } });
    expect(cell(noPort, 'INITIAL', cellMap.INITIAL.port!)?.text ?? '').toBe('');
    expect(cell(original, 'INITIAL', cellMap.INITIAL.port!)?.text).toBe(FAKE_INITIAL.port);
  });

  it('clears a shared-string cell and lowers the shared strings count to match', () => {
    // One fill's output keeps its text in shared strings: used as the template of a second fill, port and cargo are cleared.
    const first = fillSurveyWorkbook(input({ initial }));
    if ('error' in first) throw new Error(first.error);
    const firstPkg = readPackage(first.bytes);
    const port = cellMap.INITIAL.port!;
    const cargo = cellMap.INITIAL.cargo!;
    expect(cell(firstPkg, 'INITIAL', port)?.type).toBe('s');
    expect(cell(firstPkg, 'INITIAL', cargo)?.type).toBe('s');

    const second = fillSurveyWorkbook(input({ bytes: first.bytes, initial: { ...initial, port: undefined, cargo: undefined } }));
    if ('error' in second) throw new Error(second.error);
    const pkg2 = readPackage(second.bytes);
    expect(cell(pkg2, 'INITIAL', port)?.text ?? '').toBe('');
    expect(cell(pkg2, 'INITIAL', cargo)?.text ?? '').toBe('');

    const references = (p: Package) => loadWorkbook(p).sheets
      .map((s) => (partText(p, s.path)!.match(/<c\b[^>]*\bt="s"[^>]*>(?:(?!<\/c>)[\s\S])*?<v>/g) ?? []).length)
      .reduce((a, b) => a + b, 0);
    const countOf = (p: Package) => Number(/<(?:\w+:)?sst\b[^>]*?\bcount="(\d+)"/.exec(partText(p, 'xl/sharedStrings.xml')!)![1]);
    expect(countOf(firstPkg)).toBe(references(firstPkg));
    expect(references(pkg2)).toBeLessThan(references(firstPkg));
    expect(countOf(pkg2)).toBe(references(pkg2));
  });

  it('sets the workbook to recalculate fully when it is opened', () => {
    expect(partText(pkg, 'xl/workbook.xml')).toMatch(/<calcPr\b[^>]*fullCalcOnLoad="1"/);
  });

  it('writes "Loading of" for a constant check, so the sheet calls it the constant', () => {
    const { pkg: constant } = filled({ initial: { ...initial, kind: 'constant', operation: 'discharging' } });
    expect(cell(constant, 'INITIAL', cellMap.INITIAL.operation!)?.text).toBe('Loading of');
  });
});

describe('fillSurveyWorkbook: an initial and a final survey together', () => {
  const { pkg, fileName } = filled({ initial, other: final });

  it('changes only the input cells of INITIAL and FINAL; "FINAL (2)", HYDRO and the DS Report stay as they were', () => {
    for (const name of ['INITIAL', 'FINAL'] as const) for (const ref of changedCells(pkg, name)) expect(mapped(name), `${name}!${ref}`).toContain(ref);
    for (const name of ['HYDRO', 'FINAL (2)', 'DS Report']) {
      expect(same(pkg.entries.get(pathOf(name))!, original.entries.get(pathOf(name))!), name).toBe(true);
    }
  });

  it('writes the final’s inputs on FINAL, and FINAL’s own dA and LBP from the ship record', () => {
    const at = (key: keyof CellMap['FINAL']) => cell(pkg, 'FINAL', cellMap.FINAL[key]!)?.text;
    expect(at('fP')).toBe('3.3');
    expect(at('density')).toBe('1.024');
    expect(at('other')).toBe('1.5');
    expect(at('comparedQty')).toBe('8990');
    expect(at('finalOwnDA')).toBe('3.15');
    expect(at('finalOwnLBP')).toBe(String(ship.lbp));
    expect(cell(original, 'FINAL', cellMap.FINAL.finalOwnDA!)?.text).toBe('3.1');
    // The B/L quantity the final leaves empty is cleared, not left at the template's.
    expect(cell(original, 'FINAL', cellMap.FINAL.blQty!)?.text).toBe(String(FAKE_FINAL.blQty));
    expect(at('blQty') ?? '').toBe('');
  });

  it('takes the operation from the initial survey, not the final’s stored one', () => {
    expect(cell(pkg, 'INITIAL', cellMap.INITIAL.operation!)?.text).toBe('Discharging of');
  });

  it('is named after the ship, the final’s date and both kinds', () => {
    expect(fileName).toBe('Draft_Survey_Testa_Marina_2026-10-27_Initial_Final.xlsx');
  });

  it('can write the final alone, on FINAL', () => {
    const alone = filled({ other: final });
    expect(changedCells(alone.pkg, 'INITIAL').size).toBe(0);
    expect(changedCells(alone.pkg, 'FINAL').size).toBeGreaterThan(10);
    expect(alone.fileName).toBe('Draft_Survey_Testa_Marina_2026-10-27_Final.xlsx');
    expect(filled({ other: { ...final, kind: 'interim' } }).fileName).toBe('Draft_Survey_Testa_Marina_2026-10-27_Interim.xlsx');
  });
});

describe('fillSurveyWorkbook: a changed template is refused, and nothing is written', () => {
  const withMap = (sheet: 'INITIAL' | 'FINAL', change: Partial<Record<keyof CellMap['INITIAL'], string | undefined>>): CellMap => {
    const map: CellMap = { INITIAL: { ...cellMap.INITIAL }, FINAL: { ...cellMap.FINAL } };
    for (const [key, ref] of Object.entries(change)) {
      if (ref === undefined) delete map[sheet][key as keyof CellMap['INITIAL']];
      else map[sheet][key as keyof CellMap['INITIAL']] = ref;
    }
    return map;
  };

  it('refuses a cell map with a required input missing, naming it', () => {
    const error = refusal({ initial, cellMap: withMap('INITIAL', { ballast: undefined }) });
    expect(error).toMatch(/can't be filled in/);
    expect(error).toContain("INITIAL: Ballast wasn't found in it.");
    const two = refusal({ initial, cellMap: withMap('INITIAL', { ballast: undefined, density: undefined }) });
    expect(two).toMatch(/INITIAL: (Ballast|Density), INITIAL: (Ballast|Density) weren't found in it\./);
  });

  it('asks only for the sheets it writes', () => {
    expect('error' in fillSurveyWorkbook(input({ initial, cellMap: withMap('FINAL', { density: undefined }) }))).toBe(false);
    expect(refusal({ initial, other: final, cellMap: withMap('FINAL', { density: undefined }) })).toContain('FINAL: Density');
  });

  it('refuses a target that is a formula', () => {
    expect(refusal({ initial, cellMap: withMap('INITIAL', { density: 'Y30' }) })).toMatch(/INITIAL.*Density.*Y30.*formula/);
  });

  it('refuses a target that is the unit or the label beside the input', () => {
    expect(refusal({ initial, cellMap: withMap('INITIAL', { density: 'AC29' }) })).toMatch(/INITIAL.*Density.*AC29.*t\/m3/);
    expect(refusal({ initial, cellMap: withMap('INITIAL', { port: 'V5' }) })).toMatch(/INITIAL.*Port.*V5.*Port:/);
    expect(refusal({ initial, cellMap: withMap('INITIAL', { timeTill: 'AB8' }) })).toMatch(/Time \(till\).*AB8/);
  });

  it('refuses an operation cell that holds anything but "Loading of" or "Discharging of"', () => {
    expect(refusal({ initial, cellMap: withMap('INITIAL', { operation: 'O3' }) })).toMatch(/Loading of \/ Discharging of.*O3/);
  });

  it('refuses a cell inside a merged block that is not its first cell', () => {
    expect(refusal({ initial, cellMap: withMap('INITIAL', { fP: 'J13' }) })).toMatch(/Forward port draft.*J13.*merged/);
  });

  it('refuses two inputs that point to the same cell, naming both', () => {
    const error = refusal({ initial, cellMap: withMap('INITIAL', { fS: cellMap.INITIAL.fP }) });
    expect(error).toMatch(/can't be filled in/);
    expect(error).toContain(`INITIAL: Forward port draft and Forward starboard draft (${cellMap.INITIAL.fP}) are the same cell`);
  });

  it('refuses a file that is not the workbook', () => {
    expect(refusal({ initial, bytes: new Uint8Array([1, 2, 3]) })).toMatch(/couldn't be read/);
  });
});

describe('surveyFileName', () => {
  it('is Draft_Survey_<Ship>_<YYYY-MM-DD>_<kind>.xlsx, with the ship’s name safe for a file', () => {
    expect(surveyFileName('Testa Marina', '2026-10-25', 'Initial')).toBe('Draft_Survey_Testa_Marina_2026-10-25_Initial.xlsx');
    expect(surveyFileName(' M/V  Test:a ', '2026-10-25', 'Constant')).toBe('Draft_Survey_M-V_Test-a_2026-10-25_Constant.xlsx');
    expect(surveyFileName('', '2026-10-25', 'Final')).toBe('Draft_Survey_Ship_2026-10-25_Final.xlsx');
  });
});

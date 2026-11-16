import { describe, expect, it } from 'vitest';
import { FAKE_FINAL, FAKE_INITIAL, makeSurveyWorkbook } from '../../e2e/fixtures/makeSurveyWorkbook';
import type { DraftSurvey, DraftSurveyShip } from '../domain/types';
import { calcOutcome, calcSheet, OUT_OF_RANGE } from './calc';
import type { SheetResult } from './calc';
import { reportFigures } from './report';
import type { ReportFigures } from './report';
import { readSurveyWorkbook } from './workbook/read';

/* Expected values: from the independent script that copies the DS Report's formulas literally (see calc.test.ts). */

const book = readSurveyWorkbook(makeSurveyWorkbook());
if ('error' in book) throw new Error(book.error);
const ship: DraftSurveyShip = { ...book.ship, id: 'survey-ship:s1', shipId: 's1', createdAt: '', updatedAt: '', updatedBy: '', deleted: false, scope: 'ship' };
const hydro = book.hydro;

const base = { shipId: 's1', operation: 'loading' as const, createdAt: '', updatedAt: '', updatedBy: '', deleted: false, scope: 'ship' as const };
const initial: DraftSurvey = { ...base, id: 'i', kind: 'initial', drafts: FAKE_INITIAL.drafts, density: FAKE_INITIAL.density, deductibles: FAKE_INITIAL.deductibles };
const final: DraftSurvey = { ...base, id: 'f', kind: 'final', initialId: 'i', drafts: FAKE_FINAL.drafts, density: FAKE_FINAL.density,
  deductibles: FAKE_FINAL.deductibles, comparedQty: FAKE_FINAL.comparedQty };

function ok(result: ReportFigures | { error: string }): ReportFigures {
  if ('error' in result) throw new Error(result.error);
  return result;
}
function sheet(result: SheetResult | { error: string }): SheetResult {
  if ('error' in result) throw new Error(result.error);
  return result;
}

describe('reportFigures: the DS Report’s own formulas', () => {
  it('works the initial column out with QM = ROUND((F + 6M + A)/8, 4) and its own trim corrections', () => {
    const r = ok(reportFigures(ship, hydro, initial));
    expect(r.lbp).toBe(150);
    expect(r.lightShip).toBe(6850.4);
    const c = r.initial;
    expect(c.quarterMean).toBe(3.6276);
    expect(c.sheet.qmDisplacement).toBe(10137.974); // E19 = INITIAL!Y25
    expect(c.trimCorr1).toBe(-46.678);
    expect(c.trimCorr2).toBe(2.601);
    expect(c.displCorrected).toBe(10093.897);
    expect(c.density).toBe(1.02);
    expect(c.gross).toBe(10044.658);
    expect(c.deductibles).toEqual({ fuel: 466, freshWater: 180.2, ballast: 5210.5, lubOther: 12.1, total: 5868.8 });
    expect(c.nett).toBe(4175.857999999999);
    expect(r.constant).toBe(4175.857999999999 - 6850.4);
    expect(r.constantLabel).toBe('Constant');
    expect(r.other).toBeUndefined();
    expect(r.cargo).toBeUndefined();
  });

  it('adds the final column, the cargo from the report’s own netts, and the sheet’s difference lines', () => {
    const r = ok(reportFigures(ship, hydro, initial, final));
    const c = r.other!;
    expect(c.quarterMean).toBe(5.9069);
    expect(c.trimCorr1).toBe(-9.963);
    expect(c.trimCorr2).toBe(0.134);
    expect(c.gross).toBe(17707.5);
    expect(c.deductibles).toEqual({ fuel: 448, freshWater: 150.9, ballast: 310.4, lubOther: 11.6, total: 920.9 });
    expect(c.nett).toBe(16786.6);
    expect(r.cargo).toBe(16786.6 - 4175.857999999999);
    expect(r.cargoLabel).toBe('loaded');
    const out = calcOutcome(sheet(calcSheet(ship, hydro, initial, 'initial')), sheet(calcSheet(ship, hydro, final, 'final')), ship, final);
    expect(r.comparedQty).toBe(15020);
    expect(r.differenceT).toBe(out.differenceT);
    expect(r.differencePct).toBe(out.differencePct);
  });

  it('sums the deductibles in the report’s groups, which can differ from the sheet’s SUM in the last bit', () => {
    const ded = { ballast: 713.9, freshWater: 1632.7, vlsfo: 1109.9, lsmgo: 1811.8, lubOil: 1877.2, other: 196.6 };
    const s = { ...initial, deductibles: ded };
    const onSheet = sheet(calcSheet(ship, hydro, s, 'initial'));
    const r = ok(reportFigures(ship, hydro, s));
    expect(onSheet.deductibles).toBe(7342.1); // SUM(I37:I42)
    expect(r.initial.deductibles.total).toBe(7342.099999999999); // SUM(M20:N23) of the groups
    expect(onSheet.nett).toBe(2702.557999999999);
    expect(r.initial.nett).toBe(2702.558);
  });

  it('calls the initial result "Cargo + Constant" when discharging', () => {
    const r = ok(reportFigures(ship, hydro, { ...initial, operation: 'discharging' }));
    expect(r.constantLabel).toBe('Cargo + Constant');
  });

  it('gives the cargo discharged positive, from the report’s own netts (E46 = E26 − E45)', () => {
    const dIni: DraftSurvey = { ...initial, operation: 'discharging', drafts: { fP: 6.1, fS: 6.12, mP: 6.2, mS: 6.22, aP: 6.3, aS: 6.3 }, density: 1.024,
      deductibles: { ballast: 150.2, freshWater: 160.3, vlsfo: 420.1, lsmgo: 60.2, lubOil: 12.3, other: 1.5 } };
    const dFin: DraftSurvey = { ...final, operation: 'discharging', drafts: { fP: 5.4, fS: 5.42, mP: 5.5, mS: 5.52, aP: 5.62, aS: 5.64 }, density: 1.023,
      deductibles: { ballast: 2100.6, freshWater: 120.4, vlsfo: 380.5, lsmgo: 55.1, lubOil: 11.9, other: 1.5 }, comparedQty: 4400 };
    const r = ok(reportFigures(ship, hydro, dIni, dFin));
    expect(r.constantLabel).toBe('Cargo + Constant');
    expect(r.cargoLabel).toBe('discharged');
    expect(r.cargo).toBe(r.initial.nett - r.other!.nett);
    expect(r.cargo).toBeGreaterThan(0);
    expect(r.cargo).toBeCloseTo(18044.864 - 13683.59, 9);
    expect(r.differenceT).toBe(18044.864 - 13683.59 - 4400); // the sheet's difference line, app sign
  });

  it('refuses when either survey is outside the table', () => {
    expect(reportFigures(ship, hydro, initial, { ...final, drafts: FAKE_INITIAL.drafts })).toEqual({ error: OUT_OF_RANGE });
  });
});

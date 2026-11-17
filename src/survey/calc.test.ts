import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FAKE_FINAL, FAKE_INITIAL, makeSurveyWorkbook } from '../../e2e/fixtures/makeSurveyWorkbook';
import type { DraftSurvey, DraftSurveyShip, HydroRow, SurveyDeductibles, SurveyDrafts } from '../domain/types';
import { calcOutcome, calcSheet, MISSING_INPUT, NO_TABLED_LCF, OUT_OF_RANGE } from './calc';
import { setLookupCompare } from './excel';
import type { LookupCompare } from './excel';
import type { SheetResult } from './calc';
import { readSurveyWorkbook } from './workbook/read';

/*
 * Expected values: worked out for the made-up table by an independent script that copies the company workbook's
 * formulas literally (Excel ROUND half away from zero on the decimal value, VLOOKUP approximate), then pinned here.
 */

function imported(): { ship: DraftSurveyShip; hydro: HydroRow[] } {
  const result = readSurveyWorkbook(makeSurveyWorkbook());
  if ('error' in result) throw new Error(result.error);
  const ship: DraftSurveyShip = {
    ...result.ship, id: 'survey-ship:s1', shipId: 's1', createdAt: '', updatedAt: '', updatedBy: '', deleted: false, scope: 'ship',
  };
  return { ship, hydro: result.hydro };
}
const { ship, hydro } = imported();

function survey(kind: DraftSurvey['kind'], drafts: SurveyDrafts, density: number, deductibles: SurveyDeductibles,
  more: Partial<DraftSurvey> = {}): DraftSurvey {
  return { id: `${kind}-1`, shipId: 's1', kind, operation: 'loading', drafts, density, deductibles,
    createdAt: '', updatedAt: '', updatedBy: '', deleted: false, scope: 'ship', ...more };
}
const fakeInitial = () => survey('initial', FAKE_INITIAL.drafts, FAKE_INITIAL.density, FAKE_INITIAL.deductibles);
const fakeFinal = () => survey('final', FAKE_FINAL.drafts, FAKE_FINAL.density, FAKE_FINAL.deductibles,
  { initialId: 'initial-1', comparedQty: FAKE_FINAL.comparedQty });
const even = (d: number): SurveyDrafts => ({ fP: d, fS: d, mP: d, mS: d, aP: d, aS: d });
const none: SurveyDeductibles = {};

function ok(result: SheetResult | { error: string }): SheetResult {
  if ('error' in result) throw new Error(result.error);
  return result;
}

describe('the imported made-up ship', () => {
  it('has the per-sheet look-up starts the sheets use', () => {
    expect(ship.ranges).toEqual({ initial: { dispTpcMtcFrom: 2.5, lcfFrom: 1 }, final: { dispTpcMtcFrom: 4.5, lcfFrom: 4.5 } });
    expect(ship.lcfSource).toBe('workbook');
  });
});

describe('calcSheet: a full INITIAL sheet', () => {
  const r = ok(calcSheet(ship, hydro, fakeInitial(), 'initial'));

  it('works the drafts out as the sheet does', () => {
    expect(r.means).toEqual({ F: 3.12, M: 3.6100000000000003, A: 4.220000000000001 });
    expect(r.apparentTrim).toBe(1.1000000000000005);
    expect(r.perp).toEqual({ F: -0.0176, M: 0.0026, A: 0.0227 });
    expect(r.corrected).toEqual({ F: 3.1024000000000003, M: 3.6126000000000005, A: 4.242700000000001 });
    expect(r.foreAftMean).toBe(3.6725500000000006);
    expect(r.meanOfMeans).toBe(3.642575000000001);
    expect(r.quarterMean).toBe(3.6276);
    expect(r.trim).toBe(1.1403000000000008);
  });

  it('shows the deflection and the list', () => {
    expect(r.deflection).toEqual({ kind: 'HOG', cm: 6 });
    expect(r.list.side).toBe('STBD');
    expect(r.list.deg).toBeCloseTo(0.0465853555896298, 14);
  });

  it('looks the table up and corrects for trim', () => {
    expect(r.qmDisplacement).toBe(10137.974);
    expect(r.tpc).toBe(31.392);
    expect(r.lcf).toBe(-1.956);
    expect(r.mtcPlus).toBe(204.766);
    expect(r.mtcMinus).toBe(198.766);
    expect(r.dMdZ).toBe(6);
    expect(r.trimCorr1).toBe(-46.678);
    expect(r.trimCorr2).toBe(2.601);
    expect(r.displCorrected).toBe(10093.897);
  });

  it('gives the gross and nett displacement', () => {
    expect(r.density).toBe(1.02);
    expect(r.gross).toBe(10044.658);
    expect(r.deductibles).toBe(5868.8);
    expect(r.nett).toBe(4175.857999999999);
  });

  it('shows the other LCF source as a check line', () => {
    expect(r.lcfCheck).toEqual({ lcf: 2.907, trimCorr1: 69.373 });
  });
});

describe('calcSheet: head-down trim (forward deeper than aft)', () => {
  const r = ok(calcSheet(ship, hydro, survey('initial', { fP: 4.3, fS: 4.32, mP: 3.95, mS: 3.97, aP: 3.6, aS: 3.62 }, 1.015,
    { ballast: 1200.4, freshWater: 90.1, vlsfo: 300.2, lsmgo: 40.3, lubOil: 10.5, other: 2.2 }), 'initial'));

  it('keeps the workbook’s signs', () => {
    expect(r.apparentTrim).toBe(-0.7000000000000002);
    expect(r.perp).toEqual({ F: 0.0112, M: -0.0016, A: -0.0145 });
    expect(r.corrected).toEqual({ F: 4.3212, M: 3.9584, A: 3.5955000000000004 });
    expect(r.quarterMean).toBe(3.9584);
    expect(r.trim).toBe(-0.7256999999999998);
    expect(r.deflection).toEqual({ kind: 'SAG', cm: 0 });
    expect(r.qmDisplacement).toBe(11186.88);
    expect(r.tpc).toBe(32.021);
    expect(r.lcf).toBe(-1.906);
    expect(r.trimCorr1).toBe(29.527);
    expect(r.trimCorr2).toBe(1.053);
    expect(r.displCorrected).toBe(11217.46);
    expect(r.gross).toBe(11108.021);
    expect(r.deductibles).toBe(1643.7);
    expect(r.nett).toBe(9464.321);
  });

  it('names the list side PORT when the port midships draft is deeper', () => {
    const port = ok(calcSheet(ship, hydro, survey('initial', { fP: 3.6, fS: 3.6, mP: 3.62, mS: 3.6, aP: 3.6, aS: 3.6 }, 1.025, none), 'initial'));
    expect(port.list.side).toBe('PORT');
    expect(port.list.deg).toBeCloseTo(57.3 * Math.atan(0.02 / 24.6), 12);
  });
});

describe('calcSheet: the irregular table row (5.065 between 5.00 and 5.10)', () => {
  it('takes VL(x + 0.1) as a second look-up: at QM 4.9814 it lands on the 5.065 row, not on 5.00', () => {
    const r = ok(calcSheet(ship, hydro, survey('initial', { fP: 4.95, fS: 4.97, mP: 4.98, mS: 4.98, aP: 5, aS: 5.02 }, 1.025, none), 'initial'));
    expect(r.quarterMean).toBe(4.9814);
    expect(r.qmDisplacement).toBe(14742.166);
    expect(r.tpc).toBe(34.066);
    expect(r.lcf).toBe(-1.745);
    expect(r.mtcPlus).toBe(212.888);
    expect(r.mtcMinus).toBe(206.888);
    expect(r.trimCorr1).toBe(-2.053);
    expect(r.trimCorr2).toBe(0.005);
    expect(r.gross).toBe(14740.118);
  });

  it('takes the MTC fraction at QM while its look-ups are at QM + 0.5 and QM + 0.6 (here across the 5.065 row)', () => {
    const r = ok(calcSheet(ship, hydro, survey('initial', { fP: 4.55, fS: 4.55, mP: 4.56, mS: 4.56, aP: 4.58, aS: 4.58 }, 1.025, none), 'initial'));
    expect(r.quarterMean).toBe(4.5613);
    expect(r.qmDisplacement).toBe(13151.948);
    expect(r.mtcPlus).toBe(210.368);
    expect(r.mtcMinus).toBe(204.368);
    expect(r.trimCorr1).toBe(-1.249);
    expect(r.trimCorr2).toBe(0.002);
    expect(r.gross).toBe(13150.701);
  });
});

describe('calcSheet: the table’s range', () => {
  it('uses the last usable row: QM + 0.6 exactly on the last draft', () => {
    const r = ok(calcSheet(ship, hydro, survey('initial', even(6.3), 1.025, none), 'initial'));
    expect(r.qmDisplacement).toBe(19205.6);
    expect(r.mtcPlus).toBe(220.8);
    expect(r.mtcMinus).toBe(214.8);
    expect(r.lcf).toBe(-1.555);
  });

  it('refuses QM + 0.6 past the end of the table', () => {
    expect(calcSheet(ship, hydro, survey('initial', even(6.31), 1.025, none), 'initial')).toEqual({ error: OUT_OF_RANGE });
  });

  it('uses the first usable row: QM − 0.5 exactly on the INITIAL range start', () => {
    const r = ok(calcSheet(ship, hydro, survey('initial', even(3), 1.025, none), 'initial'));
    expect(r.qmDisplacement).toBe(8205);
    expect(r.mtcMinus).toBe(195);
    expect(r.lcf).toBe(-2.05);
  });

  it('refuses QM − 0.5 below the range start', () => {
    expect(calcSheet(ship, hydro, survey('initial', even(2.99), 1.025, none), 'initial')).toEqual({ error: OUT_OF_RANGE });
  });

  it('uses the FINAL range for interim and final surveys: the initial drafts are out of it', () => {
    expect(calcSheet(ship, hydro, survey('final', FAKE_INITIAL.drafts, 1.02, none), 'final')).toEqual({ error: OUT_OF_RANGE });
    expect(OUT_OF_RANGE).toBe("Outside the ship's hydrostatic table");
  });

  it('shows no result while a draft or the density is missing', () => {
    const missing = calcSheet(ship, hydro, survey('initial', { ...FAKE_INITIAL.drafts, mS: undefined }, 1.02, none), 'initial');
    expect(missing).toEqual({ error: MISSING_INPUT });
    const noDensity = calcSheet(ship, hydro, { ...fakeInitial(), density: undefined }, 'initial');
    expect(noDensity).toEqual({ error: MISSING_INPUT });
  });
});

describe('calcSheet: a full FINAL sheet', () => {
  it('works with the FINAL ranges', () => {
    const r = ok(calcSheet(ship, hydro, fakeFinal(), 'final'));
    expect(r.quarterMean).toBe(5.9069);
    expect(r.trim).toBe(0.2591999999999999);
    expect(r.deflection).toEqual({ kind: 'SAG', cm: 1.5 });
    expect(r.qmDisplacement).toBe(17786.702);
    expect(r.tpc).toBe(35.723);
    expect(r.lcf).toBe(-1.614);
    expect(r.mtcPlus).toBe(218.441);
    expect(r.mtcMinus).toBe(212.441);
    expect(r.trimCorr1).toBe(-9.963);
    expect(r.trimCorr2).toBe(0.134);
    expect(r.displCorrected).toBe(17776.873);
    expect(r.gross).toBe(17707.5);
    expect(r.deductibles).toBe(920.9);
    expect(r.nett).toBe(16786.6);
  });
});

describe('calcSheet: the LCF source', () => {
  it('uses "LCF Tabled" when the ship says so, and shows the workbook column as the check line', () => {
    const tabled = { ...ship, lcfSource: 'tabled' as const };
    const r = ok(calcSheet(tabled, hydro, fakeInitial(), 'initial'));
    expect(r.lcf).toBe(2.907);
    expect(r.trimCorr1).toBe(69.373);
    expect(r.displCorrected).toBe(10209.948);
    expect(r.gross).toBe(10160.143);
    expect(r.nett).toBe(4291.343);
    expect(r.lcfCheck).toEqual({ lcf: -1.956, trimCorr1: -46.678 });
  });

  it('has no check line when the table has no "LCF Tabled" column', () => {
    const plain = hydro.map(({ lcfTabledMid: _dropped, ...row }) => row);
    const r = ok(calcSheet(ship, plain, fakeInitial(), 'initial'));
    expect(r.lcf).toBe(-1.956);
    expect(r.lcfCheck).toBeUndefined();
  });

  it('refuses the "tabled" source when the table has no "LCF Tabled" column', () => {
    const plain = hydro.map(({ lcfTabledMid: _dropped, ...row }) => row);
    const result = calcSheet({ ...ship, lcfSource: 'tabled' }, plain, fakeInitial(), 'initial');
    expect(result).toEqual({ error: NO_TABLED_LCF });
  });
});

describe('calcOutcome', () => {
  const initial = ok(calcSheet(ship, hydro, fakeInitial(), 'initial'));
  const final = ok(calcSheet(ship, hydro, fakeFinal(), 'final'));

  it('gives the constant of an initial survey when loading: nett − light ship', () => {
    expect(calcOutcome(initial, undefined, ship, fakeInitial())).toEqual({ constant: 4175.857999999999 - 6850.4, constantLabel: 'Constant' });
  });

  it('calls the same figure "Cargo + Constant" on an initial survey when discharging', () => {
    const out = calcOutcome(initial, undefined, ship, { ...fakeInitial(), operation: 'discharging' });
    expect(out).toEqual({ constant: 4175.857999999999 - 6850.4, constantLabel: 'Cargo + Constant' });
  });

  it('gives the constant of a constant check', () => {
    const check = { ...fakeInitial(), kind: 'constant' as const };
    expect(calcOutcome(initial, undefined, ship, check)).toMatchObject({ constant: 4175.857999999999 - 6850.4, constantLabel: 'Constant' });
  });

  it('gives the cargo loaded, positive, and the difference as ship’s figure − compared quantity', () => {
    const out = calcOutcome(initial, final, ship, fakeFinal());
    const cargo = 16786.6 - 4175.857999999999; // FINAL Y34 = 1*(Y32-Y33)
    expect(out.cargo).toBe(cargo);
    expect(out.cargo).toBeGreaterThan(0);
    expect(out.cargoLabel).toBe('loaded');
    // The workbook's Y38 = Y37 − Y34 and Y39 = 100·Y38/Y37: the same magnitudes, the user's sign.
    expect(out.differenceT).toBe(-(15020 - cargo));
    expect(out.differencePct).toBe(-(100 * (15020 - cargo) / 15020));
    expect(out.differenceT).toBeCloseTo(-2409.258, 9);
    expect(out.differencePct).toBeCloseTo(-16.0403328895, 9);
  });

  it('gives the cargo discharged, positive', () => {
    const dIni = { ...survey('initial', { fP: 6.1, fS: 6.12, mP: 6.2, mS: 6.22, aP: 6.3, aS: 6.3 }, 1.024,
      { ballast: 150.2, freshWater: 160.3, vlsfo: 420.1, lsmgo: 60.2, lubOil: 12.3, other: 1.5 }), operation: 'discharging' as const };
    const dFin = { ...survey('final', { fP: 5.4, fS: 5.42, mP: 5.5, mS: 5.52, aP: 5.62, aS: 5.64 }, 1.023,
      { ballast: 2100.6, freshWater: 120.4, vlsfo: 380.5, lsmgo: 55.1, lubOil: 11.9, other: 1.5 }),
    operation: 'discharging' as const, comparedQty: 4400 };
    const ini = ok(calcSheet(ship, hydro, dIni, 'initial'));
    const fin = ok(calcSheet(ship, hydro, dFin, 'final'));
    expect(ini.nett).toBe(18044.864);
    expect(fin.quarterMean).toBe(5.513);
    expect(fin.trimCorr1).toBe(-8.894);
    expect(fin.trimCorr2).toBe(0.104);
    expect(fin.gross).toBe(16353.59);
    expect(fin.nett).toBe(13683.59);
    const out = calcOutcome(ini, fin, ship, dFin);
    expect(out.cargo).toBe(18044.864 - 13683.59);
    expect(out.cargoLabel).toBe('discharged');
    expect(out.differenceT).toBe(18044.864 - 13683.59 - 4400);
    expect(out.differencePct).toBe(100 * (18044.864 - 13683.59 - 4400) / 4400);
  });

  it('shows a cargo that went the wrong way for the operation as negative, not forced positive', () => {
    // A loading "final" whose nett is below its initial's: the drafts went the other way.
    const lighter = ok(calcSheet(ship, hydro, survey('final', even(5.5), 1.025, { ballast: 13000 }, { comparedQty: 100 }), 'final'));
    const deeper = ok(calcSheet(ship, hydro, fakeInitial(), 'initial'));
    expect(lighter.nett).toBeLessThan(deeper.nett);
    const out = calcOutcome(deeper, lighter, ship, survey('final', even(5.5), 1.025, { ballast: 13000 }, { comparedQty: 100 }));
    expect(out.cargo).toBe(lighter.nett - deeper.nett);
    expect(out.cargo).toBeLessThan(0);
    expect(out.cargoLabel).toBe('loaded');
    expect(out.differenceT).toBe(lighter.nett - deeper.nett - 100);
  });

  it('works an interim survey with the FINAL formulas against its initial', () => {
    const interim = { ...fakeFinal(), kind: 'interim' as const, comparedQty: 12000 };
    const sheet = ok(calcSheet(ship, hydro, interim, 'final'));
    expect(sheet).toEqual(final);
    const out = calcOutcome(initial, sheet, ship, interim);
    expect(out.cargo).toBe(16786.6 - 4175.857999999999);
    expect(out.cargoLabel).toBe('loaded');
    expect(out.differenceT).toBe(16786.6 - 4175.857999999999 - 12000);
  });

  it('gives no difference without a compared quantity', () => {
    const out = calcOutcome(initial, final, ship, { ...fakeFinal(), comparedQty: undefined });
    expect(out.cargo).toBe(16786.6 - 4175.857999999999);
    expect(out.differenceT).toBeUndefined();
    expect(out.differencePct).toBeUndefined();
  });
});

describe('calcSheet: a rounding tie through the sheet', () => {
  it('rounds the QM up where its sum is a x.xxxx5 tie in decimal but just below it in binary', () => {
    const r = ok(calcSheet(ship, hydro, survey('initial', { fP: 4.557, fS: 4.559, mP: 4.834, mS: 4.834, aP: 5.476, aS: 5.479 }, 1.025, none), 'initial'));
    const sum = (r.corrected.M + r.meanOfMeans) / 2;
    expect(Math.round(sum * 1e4) / 1e4).toBe(4.882); // a binary rounding would go down
    expect(r.quarterMean).toBe(4.8821); // Excel ROUND goes up
    expect(r.trim).toBe(0.9532000000000007);
    expect(r.qmDisplacement).toBe(14225.641);
    expect(r.tpc).toBe(33.776);
    expect(r.lcf).toBe(-1.768);
    expect(r.mtcPlus).toBe(212.293);
    expect(r.mtcMinus).toBe(206.293);
    expect(r.trimCorr1).toBe(-37.948);
    expect(r.trimCorr2).toBe(1.817);
    expect(r.gross).toBe(14189.51);
  });
});

/*
 * The VLOOKUP compare rule is pending confirmation in Excel (see excel.ts). At these QMs a look-up's y lands just below
 * a row's draft in binary (4.965 + 0.1, 4.465 + 0.6 and 5.465 − 0.4 are all 5.0649999999999995, against the 5.065
 * row), so the two rules give different figures. Both are pinned; one will remain.
 */
describe.each<[LookupCompare, { disp: number; tpc: number; lcf: number; mtcPlus4465: number; mtcMinus5465: number }]>([
  ['decimal15', { disp: 14650.26, tpc: 34.014, lcf: -1.749, mtcPlus4465: 210.044, mtcMinus5465: 210.044 }],
  ['binary', { disp: 14506.35, tpc: 33.934, lcf: -1.755, mtcPlus4465: 209.79, mtcMinus5465: 209.79 }],
])('calcSheet with the %s VLOOKUP compare', (rule, expected) => {
  let previous: LookupCompare;
  beforeEach(() => { previous = setLookupCompare(rule); });
  afterEach(() => { setLookupCompare(previous); });

  it('QM 4.965: the look-ups at QM + 0.1', () => {
    expect(4.965 + 0.1).toBe(5.0649999999999995);
    const r = ok(calcSheet(ship, hydro, survey('initial', even(4.965), 1.025, none), 'initial'));
    expect(r.quarterMean).toBe(4.965);
    expect(r.qmDisplacement).toBe(expected.disp);
    expect(r.tpc).toBe(expected.tpc);
    expect(r.lcf).toBe(expected.lcf);
    expect(r.mtcPlus).toBe(212.79);
    expect(r.mtcMinus).toBe(206.79);
  });

  it('QM 4.465: MTC + 0.5, through its look-up at QM + 0.6', () => {
    expect(4.465 + 0.6).toBe(5.0649999999999995);
    const r = ok(calcSheet(ship, hydro, survey('initial', even(4.465), 1.025, none), 'initial'));
    expect(r.qmDisplacement).toBe(12833.44);
    expect(r.mtcPlus).toBe(expected.mtcPlus4465);
    expect(r.mtcMinus).toBe(203.79);
  });

  it('QM 5.465: MTC − 0.5, through its look-up at QM − 0.4', () => {
    expect(5.465 - 0.4).toBe(5.0649999999999995);
    const r = ok(calcSheet(ship, hydro, survey('initial', even(5.465), 1.025, none), 'initial'));
    expect(r.qmDisplacement).toBe(16226.79);
    expect(r.mtcPlus).toBe(215.79);
    expect(r.mtcMinus).toBe(expected.mtcMinus5465);
  });
});

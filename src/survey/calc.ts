import type { DraftSurvey, DraftSurveyShip, HydroRow, SheetRanges, SurveyDeductibles } from '../domain/types';
import { excelRound } from './excel';
import { atQm, interpolate } from './hydro';
import type { HydroColumn } from './hydro';

/*
 * The company workbook's INITIAL and FINAL sheet formulas (spec §4.2 items 1–18), step by step in the sheets' own order
 * of operations, rounding exactly where a formula rounds and nowhere else. Cell references are the workbook's.
 *
 * Initial surveys and constant checks use the INITIAL sheet's look-up ranges; interim and final surveys use FINAL's
 * (spec §2: interims follow FINAL, not the broken "FINAL (2)"). The ship record gives LBP, dF, dM, dA and the beam to
 * both sheets (item 20).
 */

/** The out-of-range message (exact copy). No result is shown with it. */
export const OUT_OF_RANGE = "Outside the ship's hydrostatic table";
export const MISSING_INPUT = 'Enter all six drafts and the density';
export const NO_TABLED_LCF = 'The ship’s table has no “LCF Tabled” column: set the LCF source back to the workbook’s';

export interface Marks { F: number; M: number; A: number }

/** Every figure of a survey sheet, by the sheet's line. Unrounded lines keep the sheet's binary arithmetic. */
export interface SheetResult {
  /** I15, Q15, Z15: (port + starboard) ÷ 2. */
  means: Marks;
  /** I17, Q17, Z17: ROUND(dX × apparent trim ÷ LBP, 4). */
  perp: Marks;
  /** I18, Q18, Z18: mean + keel-plate correction + perpendicular correction. */
  corrected: Marks;
  /** I20 = aft mean − forward mean. */
  apparentTrim: number;
  /** Z20 = (F + A) ÷ 2, corrected. */
  foreAftMean: number;
  /** Z21 = (M + fore-to-aft mean) ÷ 2. */
  meanOfMeans: number;
  /** Z22 = ROUND((M + mean of means) ÷ 2, 4). */
  quarterMean: number;
  /** I25 = corrected A − corrected F. */
  trim: number;
  /** H23 and J23: SAG when M is below the fore-to-aft mean, and ROUND(|100 × (M − fore-to-aft mean)|, 1) cm. Shown only. */
  deflection: { kind: 'HOG' | 'SAG'; cm: number };
  /** H22 and J22: 57.3 × ATAN(|Mp − Ms| ÷ beam) degrees, PORT when the port midships draft is deeper. Shown only. */
  list: { side: 'PORT' | 'STBD'; deg: number };
  /** Y25, I26, I27: the look-ups at the QM. */
  qmDisplacement: number; tpc: number; lcf: number;
  /** I31, I32: MTC at QM + 0.5 and QM − 0.5. */
  mtcPlus: number; mtcMinus: number;
  /** I33 = MTC+0.5 − MTC−0.5. */
  dMdZ: number;
  /** I29 = ROUND(trim × TPC × LCF × 100 ÷ LBP, 3). */
  trimCorr1: number;
  /** I34 = ROUND(trim² × dM/dZ × 50 ÷ LBP, 3). */
  trimCorr2: number;
  /** Y28 = QM displacement + first + second trim correction. */
  displCorrected: number;
  density: number;
  /** Y30 = ROUND(corrected × density ÷ 1.025, 3). */
  gross: number;
  /** I43 = SUM of the six deductibles. */
  deductibles: number;
  /** Y32 = gross − deductibles. */
  nett: number;
  /** The other LCF source's LCF and first trim correction, shown until the user confirms the source (spec §2). */
  lcfCheck?: { lcf: number; trimCorr1: number };
}

export interface Outcome {
  /** Initial survey or constant check: INITIAL Y34 = nett − light ship. */
  constant?: number;
  /** INITIAL P34: "Cargo + Constant" on an initial survey when discharging. */
  constantLabel?: 'Constant' | 'Cargo + Constant';
  /** Final or interim survey: the cargo, positive when it went the survey's way (FINAL Y34 = final nett − initial nett). */
  cargo?: number;
  cargoLabel?: 'loaded' | 'discharged';
  /** Ship's figure − compared quantity (FINAL Y37), in tonnes and in % of the compared quantity. */
  differenceT?: number;
  differencePct?: number;
}

export type SheetKind = 'initial' | 'final';

/** The sheet a survey is worked on: INITIAL for initial surveys and constant checks, FINAL for interims and finals. */
export function sheetFor(survey: Pick<DraftSurvey, 'kind'>): SheetKind {
  return survey.kind === 'initial' || survey.kind === 'constant' ? 'initial' : 'final';
}

const DEDUCTIBLE_KEYS: readonly (keyof SurveyDeductibles)[] = ['ballast', 'freshWater', 'vlsfo', 'lsmgo', 'lubOil', 'other'];

/** The deductibles as the sheet's cells hold them: an empty one counts as 0, as in Excel. */
export function deductibleValues(deductibles: SurveyDeductibles): Record<keyof SurveyDeductibles, number> {
  return Object.fromEntries(DEDUCTIBLE_KEYS.map((key) => [key, deductibles[key] ?? 0])) as Record<keyof SurveyDeductibles, number>;
}

const finite = (x: number | undefined): x is number => typeof x === 'number' && Number.isFinite(x);

/** One survey sheet's figures, or why there are none. */
export function calcSheet(ship: DraftSurveyShip, hydro: readonly HydroRow[], survey: DraftSurvey, sheet: SheetKind): SheetResult | { error: string } {
  const { fP, fS, mP, mS, aP, aS } = survey.drafts;
  const density = survey.density;
  if (!finite(fP) || !finite(fS) || !finite(mP) || !finite(mS) || !finite(aP) || !finite(aS) || !finite(density)) return { error: MISSING_INPUT };
  const ranges: SheetRanges = ship.ranges[sheet];
  const { lbp, keelPlateCorr: keel } = ship;

  // Items 1–6: drafts.
  const means = { F: (fP + fS) / 2, M: (mP + mS) / 2, A: (aP + aS) / 2 };
  const apparentTrim = means.A - means.F;
  const perp = {
    F: excelRound((ship.dF * apparentTrim) / lbp, 4),
    M: excelRound((ship.dM * apparentTrim) / lbp, 4),
    A: excelRound((ship.dA * apparentTrim) / lbp, 4),
  };
  const corrected = { F: means.F + keel + perp.F, M: means.M + keel + perp.M, A: means.A + keel + perp.A };
  const foreAftMean = (corrected.F + corrected.A) / 2;
  const meanOfMeans = (corrected.M + foreAftMean) / 2;
  const qm = excelRound((corrected.M + meanOfMeans) / 2, 4);
  const trim = corrected.A - corrected.F;

  // Items 7–8: shown only.
  const deflection = { kind: corrected.M > foreAftMean ? 'SAG' as const : 'HOG' as const, cm: excelRound(Math.abs(100 * (corrected.M - foreAftMean)), 1) };
  const list = { side: mP > mS ? 'PORT' as const : 'STBD' as const, deg: 57.3 * Math.atan(Math.abs((mP - mS) / ship.beam)) };

  // Item 9: the look-ups.
  const lcfColumn: HydroColumn = ship.lcfSource === 'tabled' ? 'lcfTabledMid' : 'lcfMid';
  const checkColumn: HydroColumn = ship.lcfSource === 'tabled' ? 'lcfMid' : 'lcfTabledMid';
  const from = ranges.dispTpcMtcFrom;
  const looked = [
    atQm(hydro, from, 'displacement', qm),
    atQm(hydro, from, 'tpc', qm),
    atQm(hydro, ranges.lcfFrom, lcfColumn, qm),
    interpolate(hydro, from, 'mtc', qm, qm + 0.5, qm + 0.6),
    interpolate(hydro, from, 'mtc', qm, qm - 0.5, qm - 0.4),
  ];
  if (looked.includes('outOfRange')) return { error: OUT_OF_RANGE };
  if (looked.includes('noColumn')) return { error: NO_TABLED_LCF };
  const [qmDisplacement, tpc, lcf, mtcPlus, mtcMinus] = looked as number[];

  // Items 10–14.
  const dMdZ = mtcPlus - mtcMinus;
  const trimCorr1 = excelRound(trim * tpc * lcf * 100 / lbp, 3);
  const trimCorr2 = excelRound(trim * trim * dMdZ * 50 / lbp, 3);
  const displCorrected = qmDisplacement + trimCorr1 + trimCorr2;
  const gross = excelRound(displCorrected * density / 1.025, 3);
  const d = deductibleValues(survey.deductibles);
  const deductibles = d.ballast + d.freshWater + d.vlsfo + d.lsmgo + d.lubOil + d.other;
  const nett = gross - deductibles;

  const result: SheetResult = {
    means, perp, corrected, apparentTrim, foreAftMean, meanOfMeans, quarterMean: qm, trim, deflection, list,
    qmDisplacement, tpc, lcf, mtcPlus, mtcMinus, dMdZ, trimCorr1, trimCorr2, displCorrected, density, gross, deductibles, nett,
  };
  const checkLcf = atQm(hydro, ranges.lcfFrom, checkColumn, qm);
  if (typeof checkLcf === 'number') result.lcfCheck = { lcf: checkLcf, trimCorr1: excelRound(trim * tpc * checkLcf * 100 / lbp, 3) };
  return result;
}

/**
 * The constant, or the cargo and its difference from the compared quantity (spec §4.2 items 15–18, with the user's
 * decisions of §2). `survey` is the survey whose outcome this is: the initial survey or constant check (with `final`
 * undefined), or the final or interim survey worked on `final` against its `initial`.
 *
 * The workbook's own signs are FINAL Y34 = 1·(final nett − initial nett), Y38 = Y37 − Y34 and Y39 = 100·Y38/Y37. The app
 * shows the cargo in the survey's direction, so it is positive both when loading and when discharging (a negative cargo
 * means the drafts went the other way), and the difference as cargo − compared quantity.
 */
export function calcOutcome(initial: SheetResult, final: SheetResult | undefined, ship: DraftSurveyShip, survey: DraftSurvey): Outcome {
  if (final === undefined) {
    const constantLabel = survey.kind === 'initial' && survey.operation === 'discharging' ? 'Cargo + Constant' : 'Constant';
    return { constant: initial.nett - ship.lightShip, constantLabel };
  }
  const y34 = 1 * (final.nett - initial.nett);
  const loading = survey.operation === 'loading';
  const cargo = loading ? y34 : -y34;
  const outcome: Outcome = { cargo, cargoLabel: loading ? 'loaded' : 'discharged' };
  const compared = survey.comparedQty;
  if (finite(compared) && compared !== 0) {
    outcome.differenceT = cargo - compared;
    outcome.differencePct = 100 * outcome.differenceT / compared;
  }
  return outcome;
}

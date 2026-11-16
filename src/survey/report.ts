import type { DraftSurvey, DraftSurveyShip, HydroRow } from '../domain/types';
import { calcOutcome, calcSheet, deductibleValues, sheetFor } from './calc';
import type { Outcome, SheetResult } from './calc';
import { excelRound } from './excel';

/*
 * The "DS Report" sheet's figures (spec §4.2 item 19). The report takes the drafts, the look-ups and the difference
 * lines from the survey sheets, but works the quarter mean, the trim corrections, the gross and nett displacement and the
 * deductibles out with its own formulas, in its own order of operations. The printed report uses these; the survey
 * screen uses the sheet's. They can differ in the last digit, as in the workbook.
 *
 * Cell references are the DS Report's (initial column; the final column is the same 19 rows lower).
 */

export interface ReportColumn {
  /** The survey sheet the column reads its drafts, look-ups, TPC, LCF, trim and MTC from. */
  sheet: SheetResult;
  /** E18 = ROUND((F + 6M + A) ÷ 8, 4), corrected drafts. */
  quarterMean: number;
  /** E20 = ROUND(LCF × trim × TPC ÷ LBP × 100, 3). */
  trimCorr1: number;
  /** E21 = ROUND(50 × (MTC+0.5 − MTC−0.5) × trim × trim ÷ LBP, 3). */
  trimCorr2: number;
  /** E22 = the sheet's QM displacement + E20 + E21. */
  displCorrected: number;
  density: number;
  /** E24 = ROUND(E22 × density ÷ 1.025, 3). */
  gross: number;
  /** M20 = VLSFO + LSMGO, M21 fresh water, M22 ballast, M23 = lub oil + other, M24 = SUM(M20:M23). */
  deductibles: { fuel: number; freshWater: number; ballast: number; lubOther: number; total: number };
  /** E26 = gross − total deductibles. */
  nett: number;
}

export interface ReportFigures {
  /** M12 = INITIAL!I28: the LBP both columns' trim corrections use. */
  lbp: number;
  /** M11 = INITIAL!Y33. */
  lightShip: number;
  initial: ReportColumn;
  /** E27 = E26 − M11, called B27 = INITIAL!P34. */
  constant: number;
  constantLabel: NonNullable<Outcome['constantLabel']>;
  /** The final or interim survey's column. */
  other?: ReportColumn;
  /** E46 = E26 − E45, shown in the survey's direction (positive), as on screen. */
  cargo?: number;
  cargoLabel?: Outcome['cargoLabel'];
  /** E47 = FINAL!Y37, and E48, E49 = FINAL!Y38, Y39: the sheet's difference lines, with the app's sign. */
  comparedQty?: number;
  differenceT?: number;
  differencePct?: number;
}

function column(sheet: SheetResult, survey: DraftSurvey, lbp: number): ReportColumn {
  const { corrected: c, trim } = sheet;
  const quarterMean = excelRound((c.F + c.M * 6 + c.A) / 8, 4);
  const trimCorr1 = excelRound(sheet.lcf * trim * sheet.tpc / lbp * 100, 3);
  const trimCorr2 = excelRound(50 * (sheet.mtcPlus - sheet.mtcMinus) * trim * trim / lbp, 3);
  const displCorrected = sheet.qmDisplacement + trimCorr1 + trimCorr2;
  const gross = excelRound(displCorrected * sheet.density / 1.025, 3);
  const d = deductibleValues(survey.deductibles);
  const fuel = d.vlsfo + d.lsmgo;
  const lubOther = d.lubOil + d.other;
  const total = fuel + d.freshWater + d.ballast + lubOther;
  return {
    sheet, quarterMean, trimCorr1, trimCorr2, displCorrected, density: sheet.density, gross,
    deductibles: { fuel, freshWater: d.freshWater, ballast: d.ballast, lubOther, total }, nett: gross - total,
  };
}

/**
 * The DS Report's figures for an initial survey (or constant check) and, optionally, the final or interim survey
 * against it. Refused, with the sheet's message, when either survey has no result.
 */
export function reportFigures(ship: DraftSurveyShip, hydro: readonly HydroRow[], initial: DraftSurvey, other?: DraftSurvey): ReportFigures | { error: string } {
  const initialSheet = calcSheet(ship, hydro, initial, sheetFor(initial));
  if ('error' in initialSheet) return initialSheet;
  const lbp = ship.lbp;
  const first = column(initialSheet, initial, lbp);
  const { constantLabel } = calcOutcome(initialSheet, undefined, ship, initial);
  const figures: ReportFigures = {
    lbp, lightShip: ship.lightShip, initial: first, constant: first.nett - ship.lightShip, constantLabel: constantLabel ?? 'Constant',
  };
  if (other === undefined) return figures;

  const otherSheet = calcSheet(ship, hydro, other, sheetFor(other));
  if ('error' in otherSheet) return otherSheet;
  const second = column(otherSheet, other, lbp);
  const e46 = first.nett - second.nett;
  const outcome = calcOutcome(initialSheet, otherSheet, ship, other);
  return {
    ...figures, other: second, cargo: other.operation === 'loading' ? -e46 : e46, cargoLabel: outcome.cargoLabel,
    ...(other.comparedQty !== undefined && { comparedQty: other.comparedQty }),
    ...(outcome.differenceT !== undefined && { differenceT: outcome.differenceT, differencePct: outcome.differencePct }),
  };
}

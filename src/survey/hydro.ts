import type { HydroRow } from '../domain/types';
import { excelRound, vlookupApprox } from './excel';

/*
 * The survey sheets' table look-up, exactly as their formulas write it (spec §4.2 item 9):
 *
 *   ROUND(VL(y) + (VL(y2) − VL(y)) × (x − VLd(x)) × 10, 3)
 *
 * with VL an approximate VLOOKUP into the sheet's range and VLd that look-up's draft. For the displacement, TPC and LCF
 * y = x = QM and y2 = QM + 0.1, a second look-up (not "the next row": an inserted row makes them differ). For MTC at
 * QM ± 0.5, y = QM ± 0.5 and y2 = QM + 0.6 or QM − 0.4, while the fraction stays (QM − VLd(QM)).
 */

/** A column of the table a sheet looks up. `lcfTabledMid` is absent from tables without an "LCF Tabled" column. */
export type HydroColumn = 'displacement' | 'tpc' | 'mtc' | 'lcfMid' | 'lcfTabledMid';

/** Why a look-up gives no value: outside the sheet's range of the table, or a column the table does not have. */
export type LookupFailure = 'outOfRange' | 'noColumn';

/**
 * One interpolated value. `x` is the QM (the fraction's draft), `y` and `y2` the drafts of the two value look-ups, all
 * in the range that starts at the table row of `fromDraft`.
 */
export function interpolate(rows: readonly HydroRow[], fromDraft: number, column: HydroColumn, x: number, y: number, y2: number): number | LookupFailure {
  const low = vlookupApprox(rows, fromDraft, y);
  const high = vlookupApprox(rows, fromDraft, y2);
  const at = vlookupApprox(rows, fromDraft, x);
  if (low === 'outOfRange' || high === 'outOfRange' || at === 'outOfRange') return 'outOfRange';
  const a = low[column];
  const b = high[column];
  if (a === undefined || b === undefined) return 'noColumn';
  return excelRound(a + (b - a) * (x - at.draft) * 10, 3);
}

/** The value at the QM: `VL(QM) + (VL(QM + 0.1) − VL(QM)) × (QM − VLd(QM)) × 10`, rounded to 3 decimals. */
export function atQm(rows: readonly HydroRow[], fromDraft: number, column: HydroColumn, qm: number): number | LookupFailure {
  return interpolate(rows, fromDraft, column, qm, qm, qm + 0.1);
}

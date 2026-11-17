import type { CellKey, CellMap, SurveySheet } from './types';

/*
 * What the reader and the fill share about the cell map, with no spreadsheet library behind it: the fill is loaded on
 * its own when a workbook is made, and must not bring SheetJS (the reader's) with it.
 */

/**
 * The inputs a sheet must have a cell for before the workbook can be filled in: the six drafts, the density and the
 * deductibles on both, the operation on INITIAL (FINAL and the DS Report follow it), and on FINAL the compared quantity
 * and the sheet's own dA and LBP; and on INITIAL the ship's particulars the app reads (the LBP, the mark distances, the
 * beam and the light ship), which the export writes from the ship record. The trim LBP and the keel plate corrections
 * are written when their cells are found. The other fields (port, dates, names, weather, remarks …) are written when their cell
 * is found and left out otherwise; on FINAL most of them are formulas on INITIAL, so they have no cell there.
 */
export const REQUIRED_CELLS: Record<SurveySheet, readonly CellKey[]> = {
  INITIAL: ['operation', 'fP', 'fS', 'mP', 'mS', 'aP', 'aS', 'density', 'ballast', 'freshWater', 'vlsfo', 'lsmgo', 'lubOil', 'other',
    'shipLbp', 'shipDF', 'shipDM', 'shipDA', 'shipBeam', 'shipLightShip'],
  FINAL: ['fP', 'fS', 'mP', 'mS', 'aP', 'aS', 'density', 'ballast', 'freshWater', 'vlsfo', 'lsmgo', 'lubOil', 'other',
    'comparedQty', 'finalOwnDA', 'finalOwnLBP'],
};

/** How each input is called in messages: the workbook's own label where it has one. */
export const CELL_NAMES: Record<CellKey, string> = {
  operation: 'Loading of / Discharging of', cargoTitle: 'Cargo (title line)', port: 'Port', terminal: 'Terminal', cargo: 'Cargo',
  holds: 'Holds', date: 'Date', timeFrom: 'Time (from)', timeTill: 'Time (till)', windBft: 'Wind', swell: 'Swell',
  fP: 'Forward port draft', fS: 'Forward starboard draft', mP: 'Midships port draft', mS: 'Midships starboard draft',
  aP: 'Aft port draft', aS: 'Aft starboard draft', density: 'Density',
  ballast: 'Ballast', freshWater: 'Fresh Water', vlsfo: 'VLSFO', lsmgo: 'LSMGO', lubOil: 'Lub Oil', other: 'Other',
  comparedQty: 'Shore Scale / B/L figure', blQty: 'BL Q-ty', remarks: 'Remarks', surveyor: 'Surveyor', chiefOfficer: 'Ch. Off.',
  finalOwnDA: 'dA', finalOwnLBP: 'LBP', finalOwnKeelF: 'Keel Plate Corr. (forward)', finalOwnKeelM: 'Keel Plate Corr. (midships)',
  finalOwnKeelA: 'Keel Plate Corr. (aft)',
  shipLbp: 'LBP =', shipTrimLbp: 'LBP (trim corrections)', shipDF: 'dF =', shipDM: 'dM =', shipDA: 'dA =', shipBeam: 'Beam',
  shipLightShip: 'Light Ship Weight', shipKeelF: 'Keel Plate Corr. (forward)', shipKeelM: 'Keel Plate Corr. (midships)',
  shipKeelA: 'Keel Plate Corr. (aft)',
};

/**
 * The required inputs the cell map has no cell for, as "<sheet>: <name>", on `sheets` (both by default). Empty when
 * those sheets can be filled in.
 */
export function missingCells(cellMap: CellMap, sheets: readonly SurveySheet[] = ['INITIAL', 'FINAL']): string[] {
  return sheets.flatMap((sheet) =>
    REQUIRED_CELLS[sheet].filter((key) => cellMap[sheet]?.[key] === undefined).map((key) => `${sheet}: ${CELL_NAMES[key]}`));
}

/** A label as compared: lower case, whitespace (line breaks too) collapsed, no space around "=" or ":", no trailing colon. */
export function normalizeLabel(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase().replace(/\s*([=:])\s*/g, '$1').replace(/:+$/, '').trim();
}

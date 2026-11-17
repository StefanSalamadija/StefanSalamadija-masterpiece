/** The sheets of the company workbook that take a survey's inputs. An interim survey is written in the FINAL layout. */
export type SurveySheet = 'INITIAL' | 'FINAL';

/**
 * A survey input that has a cell in the company workbook: the text and number fields of `DraftSurvey`, its six drafts
 * (`fP` … `aS`) and its deductibles (`ballast` … `other`) by their own keys, and on FINAL the sheet's own dA and LBP
 * (`finalOwnDA`, `finalOwnLBP`) and keel plate corrections (`finalOwnKeelF/M/A`), which the fill writes there.
 *
 * Two more are in the INITIAL sheet's title line, which FINAL and the DS Report read: `operation`, the cell under
 * "DRAFT SURVEY CALCULATION" that holds "Loading of" or "Discharging of", and `cargoTitle`, the cargo written after it
 * (the DS Report's cargo; the "Cargo:" field is `cargo`).
 */
export type CellKey =
  | 'operation' | 'cargoTitle'
  | 'port' | 'terminal' | 'cargo' | 'holds' | 'date' | 'timeFrom' | 'timeTill' | 'windBft' | 'swell'
  | 'fP' | 'fS' | 'mP' | 'mS' | 'aP' | 'aS' | 'density'
  | 'ballast' | 'freshWater' | 'vlsfo' | 'lsmgo' | 'lubOil' | 'other'
  | 'comparedQty' | 'blQty' | 'remarks' | 'surveyor' | 'chiefOfficer'
  | 'finalOwnDA' | 'finalOwnLBP' | 'finalOwnKeelF' | 'finalOwnKeelM' | 'finalOwnKeelA'
  | ShipCellKey;

/**
 * The ship's particulars on INITIAL (ruling I1): the cells the app's ship record comes from at import, which the export
 * writes back from the record so that Excel works with the same particulars as the app. `shipTrimLbp` is the "LBP" the
 * trim corrections use (I28 in the company layout), and `shipKeelF/M/A` the keel plate correction under each mark.
 */
export type ShipCellKey =
  | 'shipLbp' | 'shipTrimLbp' | 'shipDF' | 'shipDM' | 'shipDA' | 'shipBeam' | 'shipLightShip' | 'shipKeelF' | 'shipKeelM' | 'shipKeelA';

/**
 * Where each input goes in the company workbook, per sheet: an A1 cell address such as `"C12"`, found from the labels
 * when the workbook is imported. An input the sheet has no cell for (the B/L quantity on a sheet without one, say) is
 * absent.
 */
export type CellMap = Record<SurveySheet, Partial<Record<CellKey, string>>>;

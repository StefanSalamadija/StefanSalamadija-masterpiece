/** The sheets of the company workbook that take a survey's inputs. An interim survey is written in the FINAL layout. */
export type SurveySheet = 'INITIAL' | 'FINAL';

/**
 * A survey input that has a cell in the company workbook: the text and number fields of `DraftSurvey`, its six drafts
 * (`fP` … `aS`) and its deductibles (`ballast` … `other`) by their own keys, and on FINAL the sheet's own dA and LBP
 * (`finalOwnDA`, `finalOwnLBP`), which the fill checks or writes there.
 */
export type CellKey =
  | 'port' | 'terminal' | 'cargo' | 'holds' | 'date' | 'timeFrom' | 'timeTill' | 'windBft' | 'swell'
  | 'fP' | 'fS' | 'mP' | 'mS' | 'aP' | 'aS' | 'density'
  | 'ballast' | 'freshWater' | 'vlsfo' | 'lsmgo' | 'lubOil' | 'other'
  | 'comparedQty' | 'blQty' | 'remarks' | 'surveyor' | 'chiefOfficer'
  | 'finalOwnDA' | 'finalOwnLBP';

/**
 * Where each input goes in the company workbook, per sheet: an A1 cell address such as `"C12"`, found from the labels
 * when the workbook is imported. An input the sheet has no cell for (the B/L quantity on a sheet without one, say) is
 * absent.
 */
export type CellMap = Record<SurveySheet, Partial<Record<CellKey, string>>>;

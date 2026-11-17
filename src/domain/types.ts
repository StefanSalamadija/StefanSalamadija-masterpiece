// Type-only: the forms engine stays out of the main bundle (it is loaded on demand by the Forms screens).
import type { DraftValues, FormKind, FormSchema, FormSetup } from '../forms/types';
// Type-only, as above: the budget's code is loaded on demand by the Budget screens.
import type { ScenarioChange } from '../budget/scenarioTypes';
// Type-only, as above: the draft survey's code is loaded on demand by its screens.
import type { CellMap } from '../survey/workbook/types';

export type Scope = 'ship' | 'personal';
export interface BaseRecord { id: string; createdAt: string; updatedAt: string; updatedBy: string; deleted: boolean; scope: Scope }
export interface Particulars { name: string; imo: string; callSign: string; mmsi: string; flag: string; portOfRegistry: string;
  gt?: number; nt?: number; dwt?: number; loa?: number; beam?: number; yearBuilt?: number;
  owners: string; managers: string; pandi: string; classSociety: string }
export type CrewField = 'surname' | 'givenNames' | 'fullName' | 'rank' | 'nationality' | 'dateOfBirth' | 'placeOfBirth'
  | 'passportNo' | 'passportExpiry' | 'seamansBookNo' | 'seamansBookExpiry' | 'signOnDate' | 'signOnPort' | 'signOffDate' | 'signOffPort';
export type DateFormat = 'day-first' | 'year-first';
/** How a crew list is read, saved with the ship; headers are normalised (see `normaliseHeader`). `ignored` lists the headers the
 *  user left out although they would be mapped by their name, so that they stay out on the next import. */
export interface CrewImportMapping { byHeader: Record<string, CrewField>; dateFormat: DateFormat; ignored?: string[] }
/** A column of the printed and exported crew list. */
export type CrewListColumn = 'no' | 'surname' | 'givenNames' | 'rank' | 'nationality' | 'dateOfBirth' | 'placeOfBirth' | 'passportNo'
  | 'passportExpiry' | 'seamansBookNo' | 'seamansBookExpiry' | 'signOnDate' | 'signOnPort' | 'cocNumber' | 'contractEnd';
export interface ShipProfile extends BaseRecord {
  particulars: Particulars; crewImportMapping?: CrewImportMapping;
  /** The most months a crew member may stay onboard (1 to 11); absent means the default of 11. */
  maxMonthsOnboard?: number;
  /** The columns the ship's crew list is printed and exported with; absent means the default columns. */
  crewListColumns?: CrewListColumn[];
}
export type RankKey = 'master' | 'chiefOfficer' | 'secondOfficer' | 'thirdOfficer' | 'deckCadet' | 'bosun' | 'ab' | 'os'
  | 'chiefEngineer' | 'secondEngineer' | 'thirdEngineer' | 'fourthEngineer' | 'eto' | 'engineCadet' | 'fitter' | 'oiler'
  | 'wiper' | 'chiefCook' | 'messman' | 'other';
export interface CrewMember extends BaseRecord { shipId: string; surname: string; givenNames: string; rank: RankKey; rankOther?: string;
  nationality: string; dateOfBirth: string; placeOfBirth: string; passportNo: string; passportExpiry: string;
  seamansBookNo: string; seamansBookExpiry: string; signOnDate: string; signOnPort: string; signOffDate?: string; signOffPort?: string;
  /** The agreed length of the contract in whole months (1 to 24), counted from the sign-on date. */
  contractMonths?: number;
  /** The relief planned for this contract: the day and the port. */
  reliefPlannedDate?: string; reliefPlannedPort?: string }
/** A crew member's certificate or other paper: a certificate of competency, a medical, a course certificate, a visa. */
export type CrewDocType = 'coc' | 'endorsement' | 'gmdss' | 'medical' | 'yellowFever' | 'bst' | 'aff' | 'pscrb' | 'frb' | 'mfa'
  | 'medicalCare' | 'securityAwareness' | 'dsd' | 'sso' | 'ecdis' | 'brm' | 'erm' | 'highVoltage' | 'usVisa' | 'schengenVisa' | 'other';
/** A paper of one contract (`crewId`); a re-join carries the papers that are still valid over to the new contract as copies. */
export interface CrewDocument extends BaseRecord { shipId: string; crewId: string; type: CrewDocType;
  /** The name of a paper of its own; only for `type: 'other'`. */
  typeOther?: string;
  /** The grade or capacity, such as "Master (unlimited)"; only for the types that have one (`graded` in the catalogue). */
  grade: string; number: string; issuedBy: string; issueDate: string; expiryDate?: string; remarks: string }
export interface Voyage extends BaseRecord { shipId: string; active: boolean; voyageNo: string; lastPort: string; nextPort: string;
  etaLocal: string; etaOffsetMinutes: number; cargo: string; charterers: string; agents: string }
export interface Certificate extends BaseRecord { shipId: string; key: string; name: string; number: string; issuedBy: string;
  issueDate: string; expiryDate?: string; nextSurveyDue?: string; remarks: string }
export interface ClockChange extends BaseRecord { shipId: string; effectiveAt: string; toOffsetMinutes: number; note?: string }
/**
 * A form in the library: the file as it was imported (`fileBase64`; a macro file without its macros, R21), what detection
 * found in it, and how it is set up. It
 * belongs to the person, not to a ship (`scope: 'personal'`, no `shipId`): it goes into a full backup, and into a handover
 * only when the library is included. `code`, `title` and `revision` are the form's identity (`schema.identity`), kept on
 * the record so that the library can be listed and matched by code without reading the schema.
 */
export interface FormTemplate extends BaseRecord { code: string; title: string; revision: string; kind: FormKind; fileName: string;
  /** The template file's bytes as standard base64. */
  fileBase64: string; schema: FormSchema; setup: FormSetup }
/**
 * A form being filled for a ship. There is one live draft per template and ship; it is closed (soft-deleted) when its file
 * is made, or discarded. `code` is the template's, so that a draft handed over to a device with its own copy of the form
 * can still be matched. `period` is the day, week or month it is for (see `draftPeriod`). `photoIds` are its photos'.
 */
export interface FormDraft extends BaseRecord {
  shipId: string; templateId: string; code: string; period: string; values: DraftValues; photoIds: string[];
  /**
   * The ids of the fields whose value is still the auto value worked out when the draft was made (R18): fixed then, never
   * worked out again, and marked `Auto` on the fill screen. Editing a field takes its id out. Missing on a draft whose
   * auto values were never fixed (an older record, or the next week's draft that a made file started): the fill screen
   * works them out and fixes them at that draft's first change.
   */
  autoIds?: string[];
  /**
   * The revision of the form the draft was made with (R25). Its values are kept by that revision's field ids, so a draft
   * is taken by code into another copy of the form only when that copy has the same revision. Missing on an older record.
   */
  revision?: string;
}
/**
 * The values of the last file made from a form on a ship, for "start from last". One live record per ship and key. `code`
 * is the key (see `lastValuesKey`): the form's code, or `template:<templateId>` for a form that has none. `revision` is
 * the revision of the form they were made with (R25): they are used only for a form of that revision. Missing on an
 * older record.
 */
export interface FormLastValues extends BaseRecord { shipId: string; code: string; values: DraftValues; revision?: string }
/** A photo taken for a draft, as JPEG in standard base64. A deleted photo keeps no image: its `jpegBase64` is `''`. */
export interface FormPhoto extends BaseRecord { shipId: string; draftId: string; jpegBase64: string; width: number; height: number }
export type LibraryKind = 'pdf' | 'docx' | 'xlsx' | 'image' | 'other';
/** How a library document's text was read: `no-text` is a file with nothing to read (a scan), `not-supported` a kind that is not read. */
export type TextStatus = 'indexed' | 'no-text' | 'failed' | 'not-supported';
/**
 * A document in the personal knowledge library. The record is small and syncs (`scope: 'personal'`); the file itself
 * (`LibraryFileRow`) and its searchable text (`LibraryTextRow`) stay on this device and are in no backup. A deleted
 * document is kept as a tombstone with `deletedAt`; its file and text go when the 30 days of "recently deleted" are over.
 */
export interface LibraryDoc extends BaseRecord { scope: 'personal'; title: string; folderId?: string; tags: string[]; fileName: string;
  mimeType: string; kind: LibraryKind; size: number; sha256: string; pageCount?: number; textStatus: TextStatus; textError?: string;
  addedAt: string; deletedAt?: string }
export interface LibraryFolder extends BaseRecord { scope: 'personal'; name: string }
/** One searchable part of a document (a page, a sheet), as text that is already normalised. Local only. */
export interface LibraryTextRow { id: string; docId: string; part: number; label: string; text: string }
/** When a document was last opened on this device. Local only: it is not synced, so opening a document never conflicts. */
export interface LibraryOpenedRow { docId: string; openedAt: string }
/** A document's file. Local only. */
export interface LibraryFileRow { docId: string; blob: Blob }
/*
 * The personal budget. Every amount is whole euro cents (`Cents`), every month `'YYYY-MM'` (`Ym`), every date
 * `'YYYY-MM-DD'`. All of it is personal (`scope: 'personal'`): in full backups and snapshots, never in a handover, and
 * tied to no ship. Balances, the forecast and the net worth are worked out, never stored, except the user's corrections.
 */
/** An amount in whole euro cents: always an integer. */
export type Cents = number;
/** A calendar month, `'YYYY-MM'`. */
export type Ym = string;
export type PotId = 'needs' | 'savings' | 'wants' | 'debts' | 'emergency';
/** A category of a pot; `group` is its heading (one level deep). A hidden category is kept for its history. */
export interface BudgetCategory extends BaseRecord { scope: 'personal'; pot: PotId; group?: string; name: string; order: number; hidden: boolean;
  /** Other words the quick entry knows the category by. */
  synonyms?: string[] }
export type IncomeSource = 'salary' | 'property' | 'sales' | 'jobs' | 'other';
/** Money in or out on a day. A planned entry is one still to confirm in its month. Undoing an entry deletes it (a tombstone). */
export interface BudgetEntry extends BaseRecord { scope: 'personal'; kind: 'expense' | 'income'; date: string; amount: Cents; categoryId?: string;
  incomeSource?: IncomeSource; note?: string; payee?: string; status: 'actual' | 'planned';
  /** The recurring template it was made from. */
  recurringId?: string;
  /** The sinking fund it was paid from. */
  fundId?: string;
  /** The asset an income entry sold, which lowers that asset's value. */
  soldAssetId?: string;
  /** The debt a payment in a Debts category pays (see `balancesByMonth` for one without it). */
  debtId?: string;
  /** Where an imported entry came from (its month and cell), so that importing the same file again replaces it. */
  importKey?: string;
  /** Marked as a one-off: left out of the averages. */
  oneOff?: boolean }
/** A pot's target: a % of planned income, or an amount in cents. */
export interface PotTarget { kind: 'pct' | 'amount'; value: number }
/**
 * What a month says about one value of its plan (planned income, a pot target, a category target):
 *  - `fromOn`: set "from this month on". Later months use it, up to the next month with a `fromOn` of its own;
 *  - `thisOnly`: set "for this month only". It overrides the value for this month alone and passes on to no other.
 * Either may be absent (nothing said), or `null`: no value, on purpose (a target removed), which applies the same way.
 */
export interface PlanEdit<V> { fromOn?: V | null; thisOnly?: V | null }
/**
 * A month's plan. It holds only what was edited in this month; anything else comes from the latest earlier
 * "from this month on" edit (see `effectiveMonth`).
 */
export interface BudgetMonth extends BaseRecord { scope: 'personal'; ym: Ym; plannedIncome?: PlanEdit<Cents>;
  potTargets: Partial<Record<PotId, PlanEdit<PotTarget>>>; categoryTargets: Record<string, PlanEdit<Cents>>; notes?: string }
/** A template that repeats every month on `day`, from `startYm` to `endYm` (or until the debt `untilDebtId` is paid off). */
export interface BudgetRecurring extends BaseRecord { scope: 'personal'; name: string; amount: Cents; categoryId?: string; incomeSource?: IncomeSource;
  day: number; startYm: Ym; endYm?: Ym; untilDebtId?: string }
/** A sinking fund for a bill of `amount` due in `dueYm` (and every `repeatMonths` after it, for a repeating one). */
export interface BudgetFund extends BaseRecord { scope: 'personal'; name: string; amount: Cents; dueYm: Ym; repeatMonths?: number; categoryId?: string;
  startBalance: Cents }
/** The fund record: money set aside into a fund in a month, or a bill paid from it (with the entry that paid it). */
export interface BudgetFundMove extends BaseRecord { scope: 'personal'; fundId: string; ym: Ym; amount: Cents; kind: 'setaside' | 'paid'; entryId?: string }
export interface BudgetDebt extends BaseRecord { scope: 'personal'; name: string; startBalance: Cents; yearlyRatePct: number; instalment: Cents; startYm: Ym;
  /**
   * The planned extra payment each month, on top of the instalment (or the template that pays the debt), until it is
   * paid off: in each month, the latest step at or before it (none before the first step; a step of 0 stops it).
   */
  extraSteps?: { fromYm: Ym; monthly: Cents }[];
  /**
   * What "Apply to plan" added to `extraSteps`: `monthly` from `fromYm` on, by the scenario change `source`
   * (`scenario:<scenarioId>:<changeIndex>`). Applying the scenario again replaces its part instead of adding to it.
   */
  extraApplied?: { source: string; fromYm: Ym; monthly: Cents }[] }
export interface BudgetGoal extends BaseRecord { scope: 'personal'; name: string; amount: Cents; targetYm: Ym; categoryId?: string }
export interface BudgetAsset extends BaseRecord { scope: 'personal'; name: string; includeInNetWorth: boolean }
export type BudgetAccount = 'bank' | 'investments' | 'emergency' | `debt:${string}` | `asset:${string}` | `fund:${string}`;
/** The user's own figure for an account's balance at the end of a month: a starting balance, or a correction. */
export interface BudgetCorrection extends BaseRecord { scope: 'personal'; account: BudgetAccount; ym: Ym; balance: Cents }
export interface BudgetScenario extends BaseRecord { scope: 'personal'; name: string; changes: ScenarioChange[] }
export interface RotationSettings {
  /** The monthly net salary onboard, each amount from its month on. */
  salaryFrom: { ym: Ym; amount: Cents }[];
  /** Past and planned contracts, as `YYYY-MM-DD` dates. `crewId` marks a period copied from that crew record ("Use my contract"). */
  periods: { signOn: string; signOff: string; crewId?: string }[];
  /** Months on and off of the pattern that repeats after the last period. */
  patternOn: number; patternOff: number;
  /** The salary lands in the month after it is earned. */
  paidNextMonth: boolean;
  paidAtHomePct: number;
}
export interface Assumptions { yearlyReturnPct?: number; withdrawalRatePct: number; inflationPct?: number; emergencyMonths: number; fundReminderDays: number;
  /** The user's own yearly spending for the freedom date; none: the average Needs + Wants of the last 12 tracked months. */
  yearlySpendingCents?: Cents }
export type ForecastMethod = 'targets' | 'average' | 'fixed';
/** The budget's settings: one record, `key: 'budget'`. No `bufferCents` means the default buffer, a month of Needs. */
export interface BudgetSettings extends BaseRecord { scope: 'personal'; key: 'budget'; rotation: RotationSettings; assumptions: Assumptions;
  /** The crew record that is the user, for "Use my contract". */
  meCrewId?: string;
  favourites: { name: string; amount: Cents; categoryId: string }[];
  bufferCents?: Cents; forecastMethod: Record<PotId, ForecastMethod>; fixedSpend?: Partial<Record<PotId, Cents>>; horizon: 12 | 24 | 36 | 60 }
/**
 * A row of a ship's hydrostatic table, as the company workbook's HYDRO sheet holds it: draft (m), displacement (t), TPC
 * (t/cm), MTC (t·m/cm), and LCB and LCF from midships (m, forward negative). `lcfTabledMid` is the LCF from the sheet's
 * "LCF Tabled" column, turned into a distance from midships, for the `'tabled'` LCF source.
 */
export interface HydroRow { draft: number; displacement: number; tpc: number; mtc: number; lcbMid: number; lcfMid: number; lcfTabledMid?: number }
/** Where a survey sheet's look-ups start in the hydrostatic table: the first draft (m) of each look-up range. */
export interface SheetRanges { dispTpcMtcFrom: number; lcfFrom: number }
/** Which LCF the trim correction uses: the workbook's "LCF from midship" column, or the one from "LCF Tabled". */
export type LcfSource = 'workbook' | 'tabled';
/**
 * A ship's fixed data for draft surveys, one record per ship (its id is `surveyShipId(shipId)`): lengths in metres, the
 * draft-mark distances from the perpendiculars signed as in the workbook, weights in tonnes.
 */
export interface DraftSurveyShip extends BaseRecord { shipId: string; lbp: number; dF: number; dM: number; dA: number; beam: number;
  keelPlateCorr: number; lightShip: number; summerDraught?: number; summerDwt?: number; depth?: number; gt?: number;
  lcfSource: LcfSource; ranges: { initial: SheetRanges; final: SheetRanges };
  /** The user has checked the LCF source against the stability booklet: the survey screen stops showing the other source's check line. */
  lcfConfirmed?: boolean;
  /** The workbook the data was imported from, and when. */
  sourceName?: string; importedAt?: string }
/** A ship's hydrostatic table, one record per ship (its id is `hydroTableId(shipId)`). Rows are in strictly increasing draft order. */
export interface HydroTable extends BaseRecord { shipId: string; rows: HydroRow[] }
export type SurveyKind = 'initial' | 'interim' | 'final' | 'constant';
export type SurveyOperation = 'loading' | 'discharging';
/** The six draft readings (m): forward, midships and aft, port and starboard. */
export interface SurveyDrafts { fP?: number; fS?: number; mP?: number; mS?: number; aP?: number; aS?: number }
/** The deductibles, in tonnes per item. */
export interface SurveyDeductibles { ballast?: number; freshWater?: number; vlsfo?: number; lsmgo?: number; lubOil?: number; other?: number }
/**
 * One draft survey of a ship. An interim or final survey links to its initial survey (`initialId`). `density` is the
 * dock water's (t/m³); `comparedQty` is what the result is compared with (shore figure), `blQty` the B/L quantity.
 */
export interface DraftSurvey extends BaseRecord { shipId: string; kind: SurveyKind; initialId?: string; operation: SurveyOperation;
  port?: string; terminal?: string; cargo?: string; holds?: string; date?: string; timeFrom?: string; timeTill?: string;
  windBft?: number; swell?: number; drafts: SurveyDrafts; density?: number; deductibles: SurveyDeductibles;
  comparedQty?: number; blQty?: number; remarks?: string; surveyor?: string; chiefOfficer?: string }
/**
 * The company's draft survey workbook as imported for a ship, one record per ship (its id is `surveyTemplateId(shipId)`):
 * the file's bytes as standard base64, as the forms library keeps its files (a deleted one keeps no file: `''`), and the
 * input cells found in it.
 */
export interface SurveyTemplate extends BaseRecord { shipId: string; fileName: string; fileBase64: string; cellMap: CellMap }
export type SyncRecord = ShipProfile | CrewMember | CrewDocument | Voyage | Certificate | ClockChange
  | FormTemplate | FormDraft | FormLastValues | FormPhoto | LibraryDoc | LibraryFolder
  | BudgetCategory | BudgetEntry | BudgetMonth | BudgetRecurring | BudgetFund | BudgetFundMove | BudgetDebt | BudgetGoal | BudgetAsset
  | BudgetCorrection | BudgetScenario | BudgetSettings
  | DraftSurveyShip | HydroTable | DraftSurvey | SurveyTemplate;
export type BudgetTableName = 'budgetCategories' | 'budgetEntries' | 'budgetMonths' | 'budgetRecurring' | 'budgetFunds' | 'budgetFundMoves'
  | 'budgetDebts' | 'budgetGoals' | 'budgetAssets' | 'budgetCorrections' | 'budgetScenarios' | 'budgetSettings';
export type TableName = 'ships' | 'crew' | 'voyages' | 'certificates' | 'clockChanges' | 'crewDocuments'
  | 'formTemplates' | 'formDrafts' | 'formLastValues' | 'formPhotos' | 'libraryDocs' | 'libraryFolders' | BudgetTableName
  | SurveyTableName;
/** The draft survey's tables (all ship-scope), in `TABLE_NAMES` order. */
export type SurveyTableName = 'draftSurveyShips' | 'hydroTables' | 'draftSurveys' | 'surveyTemplates';
export const SURVEY_TABLES: readonly SurveyTableName[] = ['draftSurveyShips', 'hydroTables', 'draftSurveys', 'surveyTemplates'];
/** The budget's tables, in `TABLE_NAMES` order. */
export const BUDGET_TABLES: readonly BudgetTableName[] = [
  'budgetCategories', 'budgetEntries', 'budgetMonths', 'budgetRecurring', 'budgetFunds', 'budgetFundMoves', 'budgetDebts', 'budgetGoals',
  'budgetAssets', 'budgetCorrections', 'budgetScenarios', 'budgetSettings',
];
/** Every syncable table. A table added later goes last: it is the order of the snapshot, and an old backup file may lack it. */
export const TABLE_NAMES: readonly TableName[] = [
  'ships', 'crew', 'voyages', 'certificates', 'clockChanges', 'crewDocuments', 'formTemplates', 'formDrafts', 'formLastValues', 'formPhotos',
  'libraryDocs', 'libraryFolders', ...BUDGET_TABLES, ...SURVEY_TABLES,
];
/** The syncable tables that belong to the person, not to a ship: the forms library, the knowledge library and the budget. */
export const PERSONAL_TABLES: readonly TableName[] = ['formTemplates', 'libraryDocs', 'libraryFolders', ...BUDGET_TABLES];
/** A table whose records belong to a ship by their `shipId`: every syncable table but the ships and the personal ones. */
export type ShipTableName = Exclude<TableName, 'ships' | 'formTemplates' | 'libraryDocs' | 'libraryFolders' | BudgetTableName>;
/** The tables of `ShipTableName`, in `TABLE_NAMES` order. Each is indexed by `shipId`. */
export const SHIP_TABLES: readonly ShipTableName[] = TABLE_NAMES.filter(
  (name): name is ShipTableName => name !== 'ships' && !PERSONAL_TABLES.includes(name),
);
export type Tables = Record<TableName, SyncRecord[]>;
export interface PinHash { salt: string; hash: string; iterations: number }
export interface LockoutState { failures: number; lockedUntil?: string }
/** A fingerprint (WebAuthn platform credential) registered on this device. Verified locally; there is no server. */
export interface FingerprintCredential { credentialId: string /* base64url */; publicKey: string /* SPKI, base64 */; alg: -7 | -257 }
export interface PinSettings { hash: PinHash; relockMinutes: number; lockout: LockoutState; fingerprint?: FingerprintCredential }
export type Theme = 'day' | 'night' | 'contrast';
export interface Settings { key: 'device'; deviceId: string; deviceName: string; activeShipId?: string; backupReminderDays: number;
  lastExportAt?: string; lastSync: Record<string, string>; theme: Theme; pin?: PinSettings; firstExportDone?: boolean;
  /** The "Protect Masterpiece" step was answered (lock turned on, or skipped), so it is not offered again. */
  lockPrompted?: boolean }
export type SnapshotReason = 'before-import' | 'before-update' | 'manual';
export interface Snapshot { id: string; createdAt: string; reason: SnapshotReason; note?: string; data: Tables }
export type Band = 'none' | 'ok' | 'amber' | 'red';
export interface FieldError { field: string; message: string; severity: 'error' | 'warning' }
export type CrewDraft = Omit<CrewMember, keyof BaseRecord | 'shipId'>;

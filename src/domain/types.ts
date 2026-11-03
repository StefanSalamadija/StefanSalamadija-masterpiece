// Type-only: the forms engine stays out of the main bundle (it is loaded on demand by the Forms screens).
import type { DraftValues, FormKind, FormSchema, FormSetup } from '../forms/types';

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
 * A form in the library: the file as it was imported (`fileBase64`), what detection found in it, and how it is set up. It
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
}
/**
 * The values of the last file made from a form on a ship, for "start from last". One live record per ship and key. `code`
 * is the key (see `lastValuesKey`): the form's code, or `template:<templateId>` for a form that has none.
 */
export interface FormLastValues extends BaseRecord { shipId: string; code: string; values: DraftValues }
/** A photo taken for a draft, as JPEG in standard base64. A deleted photo keeps no image: its `jpegBase64` is `''`. */
export interface FormPhoto extends BaseRecord { shipId: string; draftId: string; jpegBase64: string; width: number; height: number }
export type SyncRecord = ShipProfile | CrewMember | CrewDocument | Voyage | Certificate | ClockChange
  | FormTemplate | FormDraft | FormLastValues | FormPhoto;
export type TableName = 'ships' | 'crew' | 'voyages' | 'certificates' | 'clockChanges' | 'crewDocuments'
  | 'formTemplates' | 'formDrafts' | 'formLastValues' | 'formPhotos';
/** Every syncable table. A table added later goes last: it is the order of the snapshot, and an old backup file may lack it. */
export const TABLE_NAMES: readonly TableName[] = [
  'ships', 'crew', 'voyages', 'certificates', 'clockChanges', 'crewDocuments', 'formTemplates', 'formDrafts', 'formLastValues', 'formPhotos',
];
/** A table whose records belong to a ship by their `shipId`: every syncable table but the ships and the forms library. */
export type ShipTableName = Exclude<TableName, 'ships' | 'formTemplates'>;
/** The tables of `ShipTableName`, in `TABLE_NAMES` order. Each is indexed by `shipId`. */
export const SHIP_TABLES: readonly ShipTableName[] = TABLE_NAMES.filter(
  (name): name is ShipTableName => name !== 'ships' && name !== 'formTemplates',
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

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
export interface ShipProfile extends BaseRecord {
  particulars: Particulars; crewImportMapping?: CrewImportMapping;
  /** The most months a crew member may stay onboard (1 to 11); absent means the default of 11. */
  maxMonthsOnboard?: number;
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
export interface Voyage extends BaseRecord { shipId: string; active: boolean; voyageNo: string; lastPort: string; nextPort: string;
  etaLocal: string; etaOffsetMinutes: number; cargo: string; charterers: string; agents: string }
export interface Certificate extends BaseRecord { shipId: string; key: string; name: string; number: string; issuedBy: string;
  issueDate: string; expiryDate?: string; nextSurveyDue?: string; remarks: string }
export interface ClockChange extends BaseRecord { shipId: string; effectiveAt: string; toOffsetMinutes: number; note?: string }
export type SyncRecord = ShipProfile | CrewMember | Voyage | Certificate | ClockChange;
export type TableName = 'ships' | 'crew' | 'voyages' | 'certificates' | 'clockChanges';
export const TABLE_NAMES: readonly TableName[] = ['ships', 'crew', 'voyages', 'certificates', 'clockChanges'];
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

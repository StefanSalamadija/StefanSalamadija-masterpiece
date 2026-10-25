export type Scope = 'ship' | 'personal';
export interface BaseRecord { id: string; createdAt: string; updatedAt: string; updatedBy: string; deleted: boolean; scope: Scope }
export interface Particulars { name: string; imo: string; callSign: string; mmsi: string; flag: string; portOfRegistry: string;
  gt?: number; nt?: number; dwt?: number; loa?: number; beam?: number; yearBuilt?: number;
  owners: string; managers: string; pandi: string; classSociety: string }
export type CrewField = 'surname' | 'givenNames' | 'fullName' | 'rank' | 'nationality' | 'dateOfBirth' | 'placeOfBirth'
  | 'passportNo' | 'passportExpiry' | 'seamansBookNo' | 'seamansBookExpiry' | 'signOnDate' | 'signOnPort' | 'signOffDate' | 'signOffPort';
export type DateFormat = 'day-first' | 'year-first';
export interface CrewImportMapping { byHeader: Record<string, CrewField>; dateFormat: DateFormat }
export interface ShipProfile extends BaseRecord { particulars: Particulars; crewImportMapping?: CrewImportMapping }
export type RankKey = 'master' | 'chiefOfficer' | 'secondOfficer' | 'thirdOfficer' | 'deckCadet' | 'bosun' | 'ab' | 'os'
  | 'chiefEngineer' | 'secondEngineer' | 'thirdEngineer' | 'fourthEngineer' | 'eto' | 'engineCadet' | 'fitter' | 'oiler'
  | 'wiper' | 'chiefCook' | 'messman' | 'other';
export interface CrewMember extends BaseRecord { shipId: string; surname: string; givenNames: string; rank: RankKey; rankOther?: string;
  nationality: string; dateOfBirth: string; placeOfBirth: string; passportNo: string; passportExpiry: string;
  seamansBookNo: string; seamansBookExpiry: string; signOnDate: string; signOnPort: string; signOffDate?: string; signOffPort?: string }
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
export interface PinSettings { hash: PinHash; relockMinutes: number; lockout: LockoutState }
export type Theme = 'day' | 'night' | 'contrast';
export interface Settings { key: 'device'; deviceId: string; deviceName: string; activeShipId?: string; backupReminderDays: number;
  lastExportAt?: string; lastSync: Record<string, string>; theme: Theme; pin?: PinSettings; firstExportDone?: boolean }
export type SnapshotReason = 'before-import' | 'before-update' | 'manual';
export interface Snapshot { id: string; createdAt: string; reason: SnapshotReason; note?: string; data: Tables }
export type Band = 'none' | 'ok' | 'amber' | 'red';
export interface FieldError { field: string; message: string; severity: 'error' | 'warning' }
export type CrewDraft = Omit<CrewMember, keyof BaseRecord | 'shipId'>;

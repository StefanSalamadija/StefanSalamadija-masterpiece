import type { CrewField } from '../types';
import type { Cell } from './readSpreadsheet';

/** Lowercases, drops diacritics and removes everything except `a-z` and `0-9`, so "Seaman's Book No." becomes `seamansbookno`. */
export function normaliseHeader(s: Cell): string {
  if (typeof s !== 'string' && typeof s !== 'number') return '';
  return String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Header texts, already normalised, that each crew field is known by. */
export const HEADER_SYNONYMS: Record<CrewField, string[]> = {
  surname: ['surname', 'familyname', 'lastname'],
  givenNames: ['givennames', 'givenname', 'firstname', 'firstnames', 'forename', 'forenames', 'christianname'],
  fullName: ['name', 'names', 'fullname', 'nameofseafarer', 'familynamegivennames', 'surnameandgivennames', 'nameandsurname'],
  rank: ['rank', 'rankrating', 'rankorrating', 'position', 'capacity', 'function', 'designation'],
  nationality: ['nationality', 'citizenship'],
  dateOfBirth: ['dateofbirth', 'dob', 'birthdate', 'born'],
  placeOfBirth: ['placeofbirth', 'pob', 'birthplace'],
  passportNo: ['passportno', 'passportnumber', 'passport', 'ppno', 'passportnr'],
  passportExpiry: ['passportexpiry', 'passportexpirydate', 'passportvalidity', 'passportvaliduntil', 'ppexpiry'],
  seamansBookNo: ['seamansbookno', 'seamansbook', 'seamanbook', 'seamansbooknumber', 'sbno', 'cdc', 'cdcno', 'dischargebook'],
  seamansBookExpiry: ['seamansbookexpiry', 'sbexpiry', 'cdcexpiry', 'seamansbookvalidity'],
  signOnDate: ['signondate', 'signon', 'dateofembarkation', 'embarkationdate', 'joined', 'joiningdate', 'dateofjoining'],
  signOnPort: ['signonport', 'portofembarkation', 'embarkationport', 'placeofjoining', 'portofjoining', 'joiningport'],
  signOffDate: ['signoffdate', 'signoff', 'dateofdisembarkation', 'disembarkationdate'],
  signOffPort: ['signoffport', 'portofdisembarkation', 'disembarkationport'],
};

const MIN_PREFIX_LENGTH = 4;
const HEADER_SEARCH_ROWS = 15;
const MIN_HEADER_MATCHES = 3;

const SYNONYM_FIELD = new Map<string, CrewField>();
for (const field of Object.keys(HEADER_SYNONYMS) as CrewField[]) for (const synonym of HEADER_SYNONYMS[field]) SYNONYM_FIELD.set(synonym, field);
const PREFIX_SYNONYMS = [...SYNONYM_FIELD.keys()].filter(s => s.length >= MIN_PREFIX_LENGTH).sort((a, b) => b.length - a.length);

/**
 * The crew field a column header stands for. An exact synonym wins; otherwise the longest synonym of at least 4
 * characters that the header starts with, so "Date of birth (DD.MM.YYYY)" still counts as a date of birth.
 */
export function matchHeader(cell: Cell): CrewField | undefined {
  const header = normaliseHeader(cell);
  if (header === '') return undefined;
  const exact = SYNONYM_FIELD.get(header);
  if (exact) return exact;
  const prefix = PREFIX_SYNONYMS.find(synonym => header.startsWith(synonym));
  return prefix ? SYNONYM_FIELD.get(prefix) : undefined;
}

function isBlank(cell: Cell): boolean {
  return cell === null || (typeof cell === 'string' && cell.trim() === '');
}

/**
 * The index of the header row: the first of the first 15 rows in which at least 3 cells are recognised headers.
 * Without one, the first row that has any content (0 if the sheet is empty).
 */
export function detectHeaderRow(rows: Cell[][]): number {
  const limit = Math.min(rows.length, HEADER_SEARCH_ROWS);
  for (let i = 0; i < limit; i++) {
    if (rows[i].filter(cell => matchHeader(cell) !== undefined).length >= MIN_HEADER_MATCHES) return i;
  }
  const firstContent = rows.findIndex(row => row.some(cell => !isBlank(cell)));
  return firstContent === -1 ? 0 : firstContent;
}

import { slugify } from '../backup/fileName';
import { rankLabel } from './catalogues';
import { contractEndDate } from './contracts';
import { fullName, onboardAt, visibleCrew } from './crew';
import type { CrewView } from './crew';
import { latestDocument } from './crewDocs';
import { formatDisplayDate } from './dates';
import type { CrewDocument, CrewListColumn, CrewMember, ShipProfile } from './types';

/** What a column holds, which decides how a sheet may break its text: names and places wrap, dates and numbers stay on one line. */
export type CrewListColumnKind = 'text' | 'date' | 'number';

export interface CrewListColumnInfo {
  key: CrewListColumn;
  label: string;
  byDefault: boolean;
  kind: CrewListColumnKind;
}

/** Every column the crew list can have, in the order of the sheet. The columns marked `byDefault` are the ones a ship starts with. */
export const CREW_LIST_COLUMNS: readonly CrewListColumnInfo[] = [
  { key: 'no', label: 'No.', byDefault: true, kind: 'number' },
  { key: 'surname', label: 'Surname', byDefault: true, kind: 'text' },
  { key: 'givenNames', label: 'Given names', byDefault: true, kind: 'text' },
  { key: 'rank', label: 'Rank', byDefault: true, kind: 'text' },
  { key: 'nationality', label: 'Nationality', byDefault: true, kind: 'text' },
  { key: 'dateOfBirth', label: 'Date of birth', byDefault: true, kind: 'date' },
  { key: 'placeOfBirth', label: 'Place of birth', byDefault: true, kind: 'text' },
  { key: 'passportNo', label: 'Passport no.', byDefault: true, kind: 'number' },
  { key: 'passportExpiry', label: 'Passport expiry', byDefault: true, kind: 'date' },
  { key: 'seamansBookNo', label: "Seaman's book no.", byDefault: false, kind: 'number' },
  { key: 'seamansBookExpiry', label: "Seaman's book expiry", byDefault: false, kind: 'date' },
  { key: 'signOnDate', label: 'Sign-on date', byDefault: true, kind: 'date' },
  { key: 'signOnPort', label: 'Sign-on port', byDefault: true, kind: 'text' },
  { key: 'cocNumber', label: 'CoC no.', byDefault: false, kind: 'number' },
  { key: 'contractEnd', label: 'Contract end', byDefault: false, kind: 'date' },
];

/** The columns of a ship that has chosen none. */
export const DEFAULT_CREW_LIST_COLUMNS: readonly CrewListColumn[] = CREW_LIST_COLUMNS.filter((c) => c.byDefault).map((c) => c.key);

/**
 * The columns to print for a ship: the ones it chose, in the order of the sheet. A backup is only checked for its ids and
 * times, so the stored choice may be damaged: a key that is not a column is ignored, and a choice that is not a list or has
 * no column in it is the default columns. A new array each time.
 */
export function crewListColumnsOf(ship: Pick<ShipProfile, 'crewListColumns'>): CrewListColumn[] {
  const stored: unknown = ship.crewListColumns;
  const chosen = Array.isArray(stored) ? shownColumns(stored) : [];
  return chosen.length > 0 ? chosen.map((c) => c.key) : [...DEFAULT_CREW_LIST_COLUMNS];
}

export interface CrewListTable {
  headers: string[];
  rows: string[][];
}

/** The text of a value: an empty text for one that is missing, its digits for a number. A record from a damaged file may hold any value in any field. */
export function asText(value: unknown): string {
  return String(value ?? '');
}

/** The chosen columns with their labels and kinds, in the order of the sheet. */
export function shownColumns(columns: readonly CrewListColumn[]): CrewListColumnInfo[] {
  return CREW_LIST_COLUMNS.filter((c) => columns.includes(c.key));
}

/** The text of one cell of the crew list: the dates as `DD-MMM-YYYY`, a value the contract does not have as an empty text. */
function cellText(column: CrewListColumn, m: CrewMember, docs: CrewDocument[], position: number): string {
  switch (column) {
    case 'no': return String(position);
    case 'surname': return asText(m.surname);
    case 'givenNames': return asText(m.givenNames);
    case 'rank': return asText(rankLabel({ rank: m.rank, rankOther: typeof m.rankOther === 'string' ? m.rankOther : undefined }));
    case 'nationality': return asText(m.nationality);
    case 'dateOfBirth': return formatDisplayDate(asText(m.dateOfBirth));
    case 'placeOfBirth': return asText(m.placeOfBirth);
    case 'passportNo': return asText(m.passportNo);
    case 'passportExpiry': return formatDisplayDate(asText(m.passportExpiry));
    case 'seamansBookNo': return asText(m.seamansBookNo);
    case 'seamansBookExpiry': return formatDisplayDate(asText(m.seamansBookExpiry));
    case 'signOnDate': return formatDisplayDate(asText(m.signOnDate));
    case 'signOnPort': return asText(m.signOnPort);
    case 'cocNumber': return asText(latestDocument(docs, m.id, 'coc')?.number);
    case 'contractEnd': return formatDisplayDate(contractEndDate(m) ?? '');
  }
}

/**
 * The crew list as a table of text: the headers and one row per contract. The rows are those the crew list screen shows
 * (`visibleCrew`: onboard on `asAt`, or every contract), in its order. The columns come in the order of the sheet, whatever
 * order `columns` names them in. Every cell is text, so a leading zero or a name that looks like a formula is kept as it is.
 */
export function buildCrewList(input: {
  crew: CrewMember[];
  docs: CrewDocument[];
  columns: CrewListColumn[];
  asAt: string;
  filter: CrewView;
}): CrewListTable {
  const { crew, docs, columns, asAt, filter } = input;
  const shown = shownColumns(columns);
  return {
    headers: shown.map((c) => c.label),
    rows: visibleCrew(crew, filter, asAt).map((m, i) => shown.map((c) => cellText(c.key, m, docs, i + 1))),
  };
}

/**
 * The full name of the Master onboard on `date`, or an empty text when there is none. If two Masters are onboard (a relief
 * is joining), the one who comes first in the crew list: the one who signed on first.
 */
export function masterName(crew: CrewMember[], date: string): string {
  const master = onboardAt(crew, date).find((m) => m.rank === 'master');
  return master ? fullName({ givenNames: asText(master.givenNames), surname: asText(master.surname) }) : '';
}

/** `crew-list-m-v-ocean-star-2026-10-25.xlsx`: `date` is the date of the sheet, `YYYY-MM-DD`. */
export function crewListFileName(shipName: string, date: string): string {
  return `crew-list-${slugify(shipName) || 'ship'}-${date}.xlsx`;
}

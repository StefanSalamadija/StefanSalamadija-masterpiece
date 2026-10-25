import { latestContractByPassport, normalisePassport } from '../crew';
import type { CrewDraft, CrewField, CrewMember, DateFormat, FieldError } from '../types';
import { validateCrewMember } from '../validation';
import type { ColumnMapping } from './mapping';
import type { Cell } from './readSpreadsheet';
import { cellText, parseDateCell, parseRank, splitFullName } from './values';

export interface PreviewChange { field: keyof CrewDraft; from: string; to: string }

export interface PreviewRow {
  /** 1-based row of the sheet. */
  rowNumber: number;
  status: 'new' | 'update' | 'error';
  draft: CrewDraft;
  existingId?: string;
  /** What the draft changes in the existing record; empty for a new row, and for an update that changes nothing. */
  changes: PreviewChange[];
  errors: FieldError[];
  skip: boolean;
}

export interface PreviewInput {
  rows: Cell[][];
  /** Index of the header row in `rows`; the rows below it are the crew. */
  headerRow: number;
  mapping: ColumnMapping;
  dateFormat: DateFormat;
  existing: CrewMember[];
  currentYear: number;
  today: string;
  defaultSignOnDate: string;
}

/** Every field of a draft, in the order changes are listed. */
const FIELDS = [
  'surname', 'givenNames', 'rank', 'rankOther', 'nationality', 'dateOfBirth', 'placeOfBirth', 'passportNo', 'passportExpiry',
  'seamansBookNo', 'seamansBookExpiry', 'signOnDate', 'signOnPort', 'signOffDate', 'signOffPort',
] as const satisfies readonly (keyof CrewDraft)[];
type TextField = Exclude<(typeof FIELDS)[number], 'rank' | 'rankOther'>;
const TEXT_FIELDS = FIELDS.filter((f): f is TextField => f !== 'rank' && f !== 'rankOther');

const NAME_FIELDS: readonly CrewField[] = ['surname', 'givenNames', 'fullName'];
const MIN_FILLED_COLUMNS = 2;

const isBlank = (s: string | undefined): boolean => s === undefined || s.trim() === '';

function cellFor(row: Cell[], mapping: ColumnMapping, field: CrewField): Cell {
  const column = mapping[field];
  return column === undefined ? null : (row[column] ?? null);
}

/**
 * A row with a passport number is a person. Without one it needs a name and one more value (just the name, when only
 * one column is mapped), so that a lone label in a name column, like "Total crew: 3" or a department heading, is not
 * taken for a person. Blank rows are neither.
 */
function isCrewRow(row: Cell[], mapping: ColumnMapping, columns: number[]): boolean {
  const has = (field: CrewField): boolean => cellText(cellFor(row, mapping, field)) !== '';
  if (has('passportNo')) return true;
  const filled = columns.filter(column => cellText(row[column] ?? null) !== '').length;
  return NAME_FIELDS.some(has) && filled >= Math.min(MIN_FILLED_COLUMNS, columns.length);
}

/** A date as `YYYY-MM-DD`; a date that cannot be read stays as typed, so that it shows up (and fails validation) for the user to fix. */
function dateText(cell: Cell, dateFormat: DateFormat, currentYear: number): string {
  const date = parseDateCell(cell, dateFormat, currentYear);
  if (date === null) return '';
  return date === 'invalid' ? cellText(cell) : date;
}

/** What the file says, with `''` for every empty cell. Empty cells are filled in, or defaulted, by `evaluate`. */
function draftFromRow(row: Cell[], mapping: ColumnMapping, dateFormat: DateFormat, currentYear: number): CrewDraft {
  const text = (field: CrewField): string => cellText(cellFor(row, mapping, field));
  const date = (field: CrewField): string => dateText(cellFor(row, mapping, field), dateFormat, currentYear);
  // The full name column is only read when neither the surname nor the given names have a column of their own.
  const splitName = mapping.surname === undefined && mapping.givenNames === undefined && mapping.fullName !== undefined;
  const { surname, givenNames } = splitName ? splitFullName(text('fullName')) : { surname: text('surname'), givenNames: text('givenNames') };
  const { rank, rankOther } = parseRank(text('rank'));
  const signOffDate = date('signOffDate');
  const signOffPort = text('signOffPort');
  return {
    surname,
    givenNames,
    rank,
    ...(rankOther !== undefined && { rankOther }),
    nationality: text('nationality'),
    dateOfBirth: date('dateOfBirth'),
    placeOfBirth: text('placeOfBirth'),
    passportNo: text('passportNo'),
    passportExpiry: date('passportExpiry'),
    seamansBookNo: text('seamansBookNo'),
    seamansBookExpiry: date('seamansBookExpiry'),
    signOnDate: date('signOnDate'),
    signOnPort: text('signOnPort'),
    ...(signOffDate !== '' && { signOffDate }),
    ...(signOffPort !== '' && { signOffPort }),
  };
}

/**
 * The draft as it would be saved over `match`: an empty value never overwrites what the record already has, and a
 * passport or book number that only differs in spaces or case keeps the record's formatting.
 */
function mergeWithExisting(draft: CrewDraft, match: CrewMember): CrewDraft {
  const merged: CrewDraft = { ...draft };
  for (const field of TEXT_FIELDS) {
    const current = match[field];
    if (isBlank(draft[field]) && current !== undefined) merged[field] = current;
  }
  if (draft.rank === 'other' && isBlank(draft.rankOther)) {
    merged.rank = match.rank;
    if (match.rankOther !== undefined) merged.rankOther = match.rankOther;
  }
  if (merged.rank !== 'other') delete merged.rankOther;
  if (normalisePassport(merged.passportNo) === normalisePassport(match.passportNo)) merged.passportNo = match.passportNo;
  if (normalisePassport(merged.seamansBookNo) === normalisePassport(match.seamansBookNo)) merged.seamansBookNo = match.seamansBookNo;
  return merged;
}

function changesFrom(match: CrewMember, draft: CrewDraft): PreviewChange[] {
  const changes: PreviewChange[] = [];
  for (const field of FIELDS) {
    if (field === 'rankOther' && draft.rank !== 'other') continue; // only the rank itself changed
    const from = match[field] ?? '';
    const to = draft[field] ?? '';
    if (from !== to) changes.push({ field, from, to });
  }
  return changes;
}

type Evaluation = Pick<PreviewRow, 'status' | 'draft' | 'existingId' | 'changes' | 'errors'>;

/**
 * The shared rules of a preview row: a draft whose passport number is that of an existing crew member updates their
 * latest contract; any other is a new contract. `defaultSignOnDate` fills in a new contract's missing sign-on date.
 */
function evaluate(draft: CrewDraft, existing: CrewMember[], today: string, defaultSignOnDate?: string): Evaluation {
  const match = latestContractByPassport(existing, draft.passportNo);
  const resolved = match ? mergeWithExisting(draft, match)
    : defaultSignOnDate !== undefined && isBlank(draft.signOnDate) ? { ...draft, signOnDate: defaultSignOnDate }
    : draft;
  const errors = validateCrewMember(resolved, today);
  const status = errors.some(e => e.severity === 'error') ? 'error' : match ? 'update' : 'new';
  return {
    status,
    draft: resolved,
    ...(match && { existingId: match.id }),
    changes: match ? changesFrom(match, resolved) : [],
    errors,
  };
}

/** One row per person in the sheet below the header, ready to be shown, edited and confirmed. */
export function buildPreview(input: PreviewInput): PreviewRow[] {
  const { rows, headerRow, mapping, dateFormat, existing, currentYear, today, defaultSignOnDate } = input;
  const columns = [...new Set(Object.values(mapping).filter((column): column is number => column !== undefined))];
  const preview: PreviewRow[] = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    if (!isCrewRow(rows[i], mapping, columns)) continue;
    const draft = draftFromRow(rows[i], mapping, dateFormat, currentYear);
    preview.push({ rowNumber: i + 1, skip: false, ...evaluate(draft, existing, today, defaultSignOnDate) });
  }
  return preview;
}

/** The row again after its draft was edited: status, errors and changes follow the same rules as `buildPreview`. */
export function revalidateRow(row: PreviewRow, existing: CrewMember[], today: string): PreviewRow {
  return { rowNumber: row.rowNumber, skip: row.skip, ...evaluate(row.draft, existing, today) };
}

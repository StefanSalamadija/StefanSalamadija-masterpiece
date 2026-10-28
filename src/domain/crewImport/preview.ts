import { latestContractByPassport, normalisePassport } from '../crew';
import type { CrewDraft, CrewField, CrewMember, DateFormat, FieldError } from '../types';
import { validateCrewMember } from '../validation';
import { matchHeader } from './header';
import type { ColumnMapping } from './mapping';
import type { Cell } from './readSpreadsheet';
import { cellText, parseDateCell, parseRank, splitFullName } from './values';

export interface PreviewChange { field: keyof CrewDraft; from: string; to: string }

export interface PreviewRow {
  /** 1-based row of the sheet. */
  rowNumber: number;
  /** What the sheet says, as it was read: nothing of the saved crew in it, and no default. */
  fileDraft: CrewDraft;
  /** The fields the user fixed, each over what the file says; only the ones they changed. */
  overrides: Partial<CrewDraft>;
  status: 'new' | 'update' | 'error';
  /** The contract the row stands for: the file's values and the overrides, filled in from the saved contract it matches (or the default sign-on date). */
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

/**
 * Every field of a draft, in the order changes are listed. Typed as a record so that a field added to `CrewDraft` does not
 * compile until it is listed here, and so is not left out of the merge and the changes.
 */
const DRAFT_FIELDS: Record<keyof CrewDraft, true> = {
  surname: true, givenNames: true, rank: true, rankOther: true, nationality: true, dateOfBirth: true, placeOfBirth: true,
  passportNo: true, passportExpiry: true, seamansBookNo: true, seamansBookExpiry: true, signOnDate: true, signOnPort: true,
  signOffDate: true, signOffPort: true, contractMonths: true, reliefPlannedDate: true, reliefPlannedPort: true,
};
/**
 * The fields of a contract that are set on the crew form. The sheet has no column for them, so an import neither reads
 * nor changes them: a contract it updates keeps them (see `keepContract`).
 */
const KEPT_FIELDS = ['contractMonths', 'reliefPlannedDate', 'reliefPlannedPort'] as const;
type KeptField = (typeof KEPT_FIELDS)[number];
/** The fields the sheet can carry: all but the kept ones. */
type FileField = Exclude<keyof CrewDraft, KeptField>;
const FIELDS = (Object.keys(DRAFT_FIELDS) as (keyof CrewDraft)[]).filter((f): f is FileField => !KEPT_FIELDS.includes(f as KeptField));
type TextField = Exclude<FileField, 'rank' | 'rankOther'>;
const TEXT_FIELDS = FIELDS.filter((f): f is TextField => f !== 'rank' && f !== 'rankOther');
/** Numbers that are the same once spaces and case are ignored (R3). */
const NUMBER_FIELDS: readonly (keyof CrewDraft)[] = ['passportNo', 'seamansBookNo'];

const NAME_FIELDS: readonly CrewField[] = ['surname', 'givenNames', 'fullName'];
const MIN_FILLED_COLUMNS = 2;
/** As many recognised headers as `detectHeaderRow` asks for. */
const MIN_REPEATED_HEADER_CELLS = 3;

const isBlank = (s: string | undefined): boolean => s === undefined || s.trim() === '';

function cellFor(row: Cell[], mapping: ColumnMapping, field: CrewField): Cell {
  const column = mapping[field];
  return column === undefined ? null : (row[column] ?? null);
}

/**
 * A row with a passport number is a person. Without one it needs a name and one more value (just the name, when only
 * one column is mapped), so that a lone label in a name column, like "Total crew: 3" or a department heading, is not
 * taken for a person. Blank rows are neither, and neither is a header row repeated after a page break.
 */
function isCrewRow(row: Cell[], mapping: ColumnMapping, columns: number[]): boolean {
  if (row.filter(cell => matchHeader(cell) !== undefined).length >= MIN_REPEATED_HEADER_CELLS) return false;
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
 * A row as it would be saved over `match`: an empty cell never overwrites what the record already has, and a passport
 * or book number that only differs in spaces or case keeps the record's formatting. What the user fixed (`fixed`) is
 * theirs and is taken as it is, empty or not.
 */
function mergeWithExisting(draft: CrewDraft, match: CrewMember, fixed: ReadonlySet<string>): CrewDraft {
  const merged: CrewDraft = { ...draft };
  for (const field of TEXT_FIELDS) {
    const current = match[field];
    if (!fixed.has(field) && isBlank(draft[field]) && current !== undefined) merged[field] = current;
  }
  if (draft.rank === 'other' && isBlank(draft.rankOther) && !fixed.has('rank') && !fixed.has('rankOther')) {
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
    const same = NUMBER_FIELDS.includes(field) ? normalisePassport(from) === normalisePassport(to) : from === to;
    if (!same) changes.push({ field, from, to });
  }
  return changes;
}

/** The draft as it is saved over `match`: with the kept fields (the contract length and the planned relief) of the record, if it has them. */
function keepContract(draft: CrewDraft, match: CrewMember): CrewDraft {
  const kept = KEPT_FIELDS.filter(field => match[field] !== undefined).map(field => [field, match[field]]);
  return { ...draft, ...Object.fromEntries(kept) };
}

type Evaluation = Pick<PreviewRow, 'status' | 'draft' | 'existingId' | 'changes' | 'errors'>;

/**
 * Status, errors and changes of a draft, taken as it is, against the existing record it updates (if any). The draft is
 * checked as the sheet and the fixes make it: what the sheet cannot carry is not part of the checks, and is not a change.
 */
function evaluate(draft: CrewDraft, match: CrewMember | undefined, today: string): Evaluation {
  const errors = validateCrewMember(draft, today);
  const status = errors.some(e => e.severity === 'error') ? 'error' : match ? 'update' : 'new';
  return {
    status,
    draft: match ? keepContract(draft, match) : draft,
    ...(match && { existingId: match.id }),
    changes: match ? changesFrom(match, draft) : [],
    errors,
  };
}

export const DUPLICATE_PASSPORT: FieldError = { field: 'passportNo', message: 'Duplicate passport number in this file.', severity: 'error' };

/** What a row is worked out against. */
export interface ResolveContext {
  existing: CrewMember[];
  today: string;
  /** The sign-on date of a new row that has none (in the file, or fixed by the user). */
  defaultSignOnDate: string;
}

/** The file's values with the user's fixes over them. A rank text that the rank does not use is dropped. */
function withOverrides(fileDraft: CrewDraft, overrides: Partial<CrewDraft>): CrewDraft {
  const draft: CrewDraft = { ...fileDraft };
  for (const field of FIELDS) {
    const value = overrides[field];
    if (value !== undefined) (draft as unknown as Record<string, string>)[field] = value;
  }
  if (draft.rank !== 'other') delete draft.rankOther;
  return draft;
}

/**
 * A row worked out from what the sheet says and what the user fixed, which are kept apart so that a fix only ever
 * carries what the user typed:
 * 1. the file's values, with the fixes over them;
 * 2. the saved contract that the passport number matches (the latest with that number), if any, which the row updates;
 * 3. an empty value is filled in from that contract, except what the user fixed; with no contract, an empty sign-on
 *    date the user did not fix becomes `defaultSignOnDate`;
 * 4. changes against the contract, and validation.
 * Fixing the passport number of a row therefore moves it to the contract that number belongs to, and the update writes
 * the row's own values onto that one, never another contract's. The row number and the skip flag are kept.
 * Nothing is known of the other rows here, so a duplicate passport number or an overlapping contract is not noticed
 * (see `recheckRows`).
 */
export function resolveRow(
  row: Pick<PreviewRow, 'rowNumber' | 'fileDraft' | 'overrides' | 'skip'>, { existing, today, defaultSignOnDate }: ResolveContext,
): PreviewRow {
  const { rowNumber, fileDraft, overrides, skip } = row;
  const wanted = withOverrides(fileDraft, overrides);
  const match = latestContractByPassport(existing, wanted.passportNo);
  const fixed = new Set(Object.keys(overrides));
  const draft = match ? mergeWithExisting(wanted, match, fixed)
    : isBlank(wanted.signOnDate) && !fixed.has('signOnDate') ? { ...wanted, signOnDate: defaultSignOnDate }
    : wanted;
  return { rowNumber, fileDraft, overrides, skip, ...evaluate(draft, match, today) };
}

/**
 * One row per person in the sheet below the header, ready to be shown, edited and confirmed (see `resolveRow`).
 * A row whose passport number is that of an existing crew member updates their latest contract (empty cells keep
 * what the record has); any other is a new contract, with `defaultSignOnDate` if it has no sign-on date.
 * A passport number that an earlier row of the file already has makes the later row an error.
 */
export function buildPreview(input: PreviewInput): PreviewRow[] {
  const { rows, headerRow, mapping, dateFormat, existing, currentYear, today, defaultSignOnDate } = input;
  const columns = [...new Set(Object.values(mapping).filter((column): column is number => column !== undefined))];
  const seenPassports = new Set<string>();
  const preview: PreviewRow[] = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    if (!isCrewRow(rows[i], mapping, columns)) continue;
    const fileDraft = draftFromRow(rows[i], mapping, dateFormat, currentYear);
    const row = resolveRow({ rowNumber: i + 1, fileDraft, overrides: {}, skip: false }, { existing, today, defaultSignOnDate });

    const passport = normalisePassport(row.draft.passportNo);
    if (passport !== '') {
      if (seenPassports.has(passport)) {
        row.status = 'error';
        row.errors = [...row.errors, DUPLICATE_PASSPORT];
      }
      seenPassports.add(passport);
    }
    preview.push(row);
  }
  return preview;
}

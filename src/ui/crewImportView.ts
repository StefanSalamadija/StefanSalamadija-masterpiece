import { RANKS } from '../domain/catalogues';
import { detectHeaderRow } from '../domain/crewImport/header';
import { applySavedMapping } from '../domain/crewImport/mapping';
import type { ColumnMapping } from '../domain/crewImport/mapping';
import { isImportable } from '../domain/crewImport/plan';
import type { PreviewChange, PreviewRow } from '../domain/crewImport/preview';
import type { Cell, SheetGrid } from '../domain/crewImport/readSpreadsheet';
import { cellText } from '../domain/crewImport/values';
import { parseDecimal } from '../domain/numbers';
import type { CrewDraft, CrewField, CrewImportMapping, FieldError } from '../domain/types';
import { crewFieldsOf } from './crewForm';
import type { CrewForm } from './crewForm';

/** The crew fields a column can be mapped to, in the order the select lists them, with the words the wizard uses. */
export const MAPPING_FIELDS: readonly { field: CrewField; label: string }[] = [
  { field: 'surname', label: 'Surname' },
  { field: 'givenNames', label: 'Given names' },
  { field: 'fullName', label: 'Full name' },
  { field: 'rank', label: 'Rank' },
  { field: 'nationality', label: 'Nationality' },
  { field: 'dateOfBirth', label: 'Date of birth' },
  { field: 'placeOfBirth', label: 'Place of birth' },
  { field: 'passportNo', label: 'Passport no.' },
  { field: 'passportExpiry', label: 'Passport expiry' },
  { field: 'seamansBookNo', label: "Seaman's book no." },
  { field: 'seamansBookExpiry', label: "Seaman's book expiry" },
  { field: 'signOnDate', label: 'Sign-on date' },
  { field: 'signOnPort', label: 'Sign-on port' },
  { field: 'signOffDate', label: 'Sign-off date' },
  { field: 'signOffPort', label: 'Sign-off port' },
];

/** The fields of a draft by the words of the crew form (the rank text is the form's "Rank (other)"). */
const DRAFT_LABELS: Readonly<Record<string, string>> = {
  ...Object.fromEntries(MAPPING_FIELDS.map(({ field, label }) => [field, label])),
  rankOther: 'Rank (other)',
};

/** The number typed as the header row: a whole number from 1 to the number of rows of the sheet, else `undefined`. */
export function parseHeaderRow(text: string, rowCount: number): number | undefined {
  const value = parseDecimal(text);
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= rowCount ? value : undefined;
}

/**
 * What a sheet starts with: the row found to be the header (its index, and as the user types it, 1-based) and the
 * columns mapped by that row and the saved mapping.
 */
export function sheetSettings(rows: Cell[][], saved: CrewImportMapping | undefined): { headerRow: number; headerText: string; mapping: ColumnMapping } {
  const headerRow = detectHeaderRow(rows);
  return { headerRow, headerText: String(headerRow + 1), mapping: applySavedMapping(rows[headerRow], saved) };
}

export function headerRowMessage(rowCount: number): string {
  return `Enter a row number between 1 and ${rowCount}.`;
}

/** `mapping` with `field` (or none, to ignore the column) on `column`: a column has one field and a field one column. */
export function withColumnField(mapping: ColumnMapping, column: number, field: CrewField | undefined): ColumnMapping {
  const next: ColumnMapping = {};
  for (const [key, mapped] of Object.entries(mapping) as [CrewField, number][]) {
    if (mapped !== column && key !== field) next[key] = mapped;
  }
  if (field !== undefined) next[field] = column;
  return next;
}

/** The full name column is only read when neither the surname nor the given names have a column of their own. */
export function fullNameIgnored(mapping: ColumnMapping): boolean {
  return mapping.fullName !== undefined && (mapping.surname !== undefined || mapping.givenNames !== undefined);
}

function columnLetters(column: number): string {
  let letters = '';
  for (let n = column + 1; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return letters;
}

/** What a column is called: its header text, or its letter in the sheet when the header is empty. */
export function columnLabel(header: Cell[] | undefined, column: number): string {
  return cellText(header?.[column] ?? null) || `Column ${columnLetters(column)}`;
}

/** The columns worth a choice: those with a header, and those with anything below it. */
export function shownColumns(rows: Cell[][], headerRow: number): number[] {
  const below = rows.slice(headerRow + 1);
  const width = rows.slice(headerRow).reduce((widest, row) => Math.max(widest, row.length), 0);
  const columns: number[] = [];
  for (let column = 0; column < width; column++) {
    const named = cellText(rows[headerRow]?.[column] ?? null) !== '';
    if (named || below.some(row => cellText(row[column] ?? null) !== '')) columns.push(column);
  }
  return columns;
}

/** The sheet to open first: the first one with anything in it, since a workbook may start with an empty or a cover sheet. */
export function firstSheetWithData(sheets: SheetGrid[]): number {
  const index = sheets.findIndex(sheet => sheet.rows.some(row => row.some(cell => cellText(cell) !== '')));
  return Math.max(index, 0);
}

export function statusText(row: PreviewRow): 'New' | 'Update' | 'No changes' | 'Error' {
  if (row.status === 'new') return 'New';
  if (row.status === 'error') return 'Error';
  return row.changes.length > 0 ? 'Update' : 'No changes';
}

function rankLabelOf(key: string): string {
  return RANKS.find(rank => rank.key === key)?.label ?? key;
}

/** "Passport expiry: 2027-01-01 → 2028-01-01"; a dash stands for an empty value. */
export function changeText({ field, from, to }: PreviewChange): string {
  const show = (value: string): string => (value === '' ? '—' : field === 'rank' ? rankLabelOf(value) : value);
  return `${DRAFT_LABELS[field]}: ${show(from)} → ${show(to)}`;
}

const INVALID_DATE = 'Enter a valid date.';

/**
 * An error of a row as the field it is about and what is wrong with it. A date that could not be read is named with the
 * text that was read, to find it in the sheet. A message that starts with the name of the field has no need of it.
 */
export function errorParts(error: FieldError, draft: CrewDraft): { label?: string; message: string } {
  const name = DRAFT_LABELS[error.field] ?? error.field;
  if (error.message.startsWith(name)) return { message: error.message };
  const text = (draft as unknown as Record<string, unknown>)[error.field];
  const read = error.message === INVALID_DATE && typeof text === 'string' && text !== '' ? ` “${text}”` : '';
  return { label: `${name}${read}`, message: error.message };
}

/** "2 new, 1 to update, 3 without changes, 1 error, 1 skipped": what will happen to the rows, counting a skipped row as skipped only. */
export function previewSummary(rows: PreviewRow[]): string {
  const live = rows.filter(row => !row.skip);
  const counts: [number, string][] = [
    [live.filter(row => row.status === 'new').length, 'new'],
    [live.filter(row => row.status === 'update' && row.changes.length > 0).length, 'to update'],
    [live.filter(row => row.status === 'update' && row.changes.length === 0).length, 'without changes'],
    [live.filter(row => row.status === 'error').length, 'error'],
    [rows.length - live.length, 'skipped'],
  ];
  return counts
    .filter(([count]) => count > 0)
    .map(([count, what]) => `${count} ${what === 'error' && count > 1 ? 'errors' : what}`)
    .join(', ');
}

/** What the user did to the preview: skipped rows, and rows with a draft of their own, by row number of the sheet. */
export interface RowEdit { skip?: boolean; draft?: CrewDraft }
export type RowEdits = Readonly<Record<number, RowEdit>>;

/** True when the user has fixed or skipped any row. */
export function hasEdits(edits: RowEdits): boolean {
  return Object.values(edits).some(edit => edit.skip === true || edit.draft !== undefined);
}

export function applyEdits(rows: PreviewRow[], edits: RowEdits): PreviewRow[] {
  return rows.map(row => {
    const edit = edits[row.rowNumber];
    return edit ? { ...row, skip: edit.skip ?? row.skip, draft: edit.draft ?? row.draft } : row;
  });
}

/** How many crew the Import button imports. */
export function importCount(rows: PreviewRow[]): number {
  return rows.filter(isImportable).length;
}

/**
 * The draft with what the crew form says. The form leaves out the sign-off, which stays as the draft has it, and a rank
 * text that the chosen rank does not use is dropped. Undefined while no rank is chosen.
 */
export function draftWithForm(draft: CrewDraft, form: CrewForm): CrewDraft | undefined {
  const fields = crewFieldsOf(form);
  if (!fields) return undefined;
  const next: CrewDraft = { ...draft, ...fields };
  if (fields.rankOther === undefined) delete next.rankOther;
  return next;
}

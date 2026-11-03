import { rankLabel } from '../domain/catalogues';
import { formatDisplayDate, isValidIsoDate, isoWeek } from '../domain/dates';
import { todayRowIndex } from '../domain/dayGrid';
import { parseDecimal } from '../domain/numbers';
import type { CrewMember } from '../domain/types';
import { fullName } from '../domain/crew';
import { suggestLinks } from './autofill';
import { normaliseLabel } from './labels';
import { DEFAULT_OK_WORD } from './types';
import type { DraftValues, FieldDef, FormSchema, FormSetup, FormValue, HelperKey, RowGroupDef } from './types';

/*
 * Helpers (spec section 7): the pure rules behind the seven helpers that make filling a form fast. They say which
 * helper applies where (`suggestHelpers`) and what each one does to the values. The screens (Tasks 15 and 16) wire
 * them to buttons.
 *
 * Ids and values. Helpers name groups and fields by id, as the schema does. A row is a record from column id to
 * value, and every value is in the canonical form of `FormValue` (ISO dates, `HH:mm`, the text of a chosen option).
 * Nothing here touches the input it is given.
 *
 * The seven helpers, and where each applies (`suggestHelpers`):
 * - `pickCrew`: a group with a Name column (`Name`, `Full name`, `Name / Rank`, `Name and Function`), unless that
 *   column is left empty on purpose;
 * - `allOk`: a top-level choice field that has a positive option (a tick row), and every `checklist` group;
 * - `todayRow`: a `dayGrid` group;
 * - `startFromLast`: a `rows` group that has `rowLabels` (an inventory, or an Excel list with an empty corner, R16),
 *   and the id of each matrix block (`FieldDef.block`, R14);
 * - `jobLog`: a growable group that has a Date column and a Status column (see `isJobLogGroup`);
 * - `thresholds`: a group that has a fixed row labelled Alarm with numbers in it (R8);
 * - `now`: every `time` field and every column of kind `time`, and every text field or column labelled `Time`,
 *   `Time IN` or `Time OUT`.
 */

const NAME_COLUMN = /^(?:full )?name(?: ?(?:\/|and|&) ?(?:rank|function))?$/;
const NAME_ONLY = /^(?:full )?name$/;
const RANK_COLUMN = /^(?:rank|function)$/;
const NAME_AND_RANK_COLUMN = /^(?:full )?name ?(?:\/|and|&) ?(?:rank|function)$/;
const TIME_LABEL = /^time(?: in| out)?$/;
const ALARM_ROW = /alarm/i;
/** `O2`, `O₂`, `O2 [Vol.%]`, but not `CO2`: no letter may come before the O. */
const OXYGEN = /(?:^|[^\p{L}])o(?:2|₂)/iu;

/** A label for matching, with one space either side of a slash or an ampersand (`Name/Rank` and `Name / Rank` are one label). */
const norm = (f: { label: string }): string => normaliseLabel(f.label).replace(/\s*\/\s*/g, ' / ').replace(/\s*&\s*/g, ' & ');

function isNameColumn(c: FieldDef): boolean {
  return !c.leftEmpty && NAME_COLUMN.test(norm(c));
}

/** Words that read as the positive answer (`Yes`, `OK`, `Good`), unless the option negates them (`Not OK`). */
function isPositive(option: string): boolean {
  const o = option.toLowerCase();
  return /\b(?:yes|ok|good)\b/.test(o) && !/\b(?:not|no|nok|bad)\b/.test(o);
}

/** The option `allOk` writes into a choice field, in the option's own spelling; `undefined` when none is valid. */
function okOption(options: string[], okWord: string): string | undefined {
  const positive = options.find(isPositive);
  if (positive !== undefined) return positive;
  const want = okWord.trim().toLowerCase();
  return want === '' ? undefined : options.find((o) => o.trim().toLowerCase() === want);
}

function isTickField(f: FieldDef): boolean {
  return f.kind === 'choice' && !f.leftEmpty && (f.options ?? []).some(isPositive);
}

/** The group's column that gets the ok word in a checklist: the one titled `Condition`, else `Status`. */
function checklistColumn(g: RowGroupDef): FieldDef | undefined {
  const has = (word: string) => g.columns.find((c) => !c.leftEmpty && c.kind !== 'picture' && norm(c).split(' ').includes(word));
  return has('condition') ?? has('status');
}

/** The date, status, picture and photo columns of a job log group, or `undefined` when the group is not one. */
export function jobLogColumns(g: RowGroupDef): { date: FieldDef; status: FieldDef; cleared: FieldDef[] } | undefined {
  if (!g.growable) return undefined;
  const date = g.columns.find((c) => c.kind === 'date' || norm(c) === 'date');
  const status = g.columns.find((c) => c.kind !== 'picture' && norm(c).split(' ').includes('status'));
  if (date === undefined || status === undefined) return undefined;
  const cleared = g.columns.filter((c) => c.kind === 'picture' || (c.kind === 'choice' && norm(c).split(' ').includes('photo')));
  return { date, status, cleared };
}

/**
 * Whether a group is the job log. The rule: it is growable, has a Date column (kind `date`, or titled `Date`) and a
 * Status column (a title with the word `status`). The weekly-jobs form's pictures group is a separate group with
 * neither, so it is never a job log and `rolloverJobs` never carries it; that is how the photos are cleared.
 */
export function isJobLogGroup(group: RowGroupDef): boolean {
  return jobLogColumns(group) !== undefined;
}

/** Columns that never hold a gas reading: times, dates, units, names, remarks. */
const NOT_READING = /^(?:time(?: in| out)?|date|units?|remarks?|name|rank)$/;

/** Whether a column can hold a reading: a number column, or a text column whose title is not one of `NOT_READING`. */
function canHoldReading(c: FieldDef): boolean {
  return c.kind === 'number' || (c.kind === 'text' && !NOT_READING.test(norm(c)));
}

/** The alarm rows of a group that carry numbers, as cells lined up with the group's columns. */
function alarmRows(g: RowGroupDef): { cells: (number | undefined)[] }[] {
  const rows: { cells: (number | undefined)[] }[] = [];
  for (const row of g.fixedRows ?? []) {
    if (!ALARM_ROW.test(row.label)) continue;
    // Word repeats the label as the first cell (the label column is the group's first column); Excel's cells do not.
    // So cell 0 is the label when it equals the row label or is not a number, whatever the row's length.
    const first = row.cells[0];
    const labelFirst = first !== undefined
      && (normaliseLabel(first) === normaliseLabel(row.label) || typeof parseDecimal(first) !== 'number');
    const cells = g.columns.map((c, i) => {
      if ((labelFirst && i === 0) || !canHoldReading(c)) return undefined;
      const parsed = parseDecimal(row.cells[i] ?? '');
      return typeof parsed === 'number' ? parsed : undefined;
    });
    if (cells.some((c) => c !== undefined)) rows.push({ cells });
  }
  return rows;
}

/** The ids of the matrix blocks in a schema, in document order. */
function matrixBlocks(schema: FormSchema): string[] {
  const seen: string[] = [];
  for (const f of schema.fields) if (f.block !== undefined && !seen.includes(f.block)) seen.push(f.block);
  return seen;
}

/** Whether `startFromLast` copies this group: a plain list with row names (matrices are fields with a block, R14). */
function copiesFromLast(g: RowGroupDef): boolean {
  return g.shape === 'rows' && (g.rowLabels?.length ?? 0) > 0;
}

/** For each helper, the ids of the groups or fields it applies to. See the table at the top of this file. */
export function suggestHelpers(schema: FormSchema): Record<HelperKey, string[]> {
  const groups = schema.rowGroups;
  const isNow = (f: FieldDef) => !f.leftEmpty && (f.kind === 'time' || (f.kind === 'text' && TIME_LABEL.test(norm(f))));
  return {
    pickCrew: groups.filter((g) => g.columns.some(isNameColumn)).map((g) => g.id),
    allOk: [
      ...schema.fields.filter(isTickField).map((f) => f.id),
      ...groups.filter((g) => g.shape === 'checklist').map((g) => g.id),
    ],
    todayRow: groups.filter((g) => g.shape === 'dayGrid').map((g) => g.id),
    startFromLast: [...groups.filter(copiesFromLast).map((g) => g.id), ...matrixBlocks(schema)],
    jobLog: groups.filter(isJobLogGroup).map((g) => g.id),
    thresholds: groups.filter((g) => alarmRows(g).length > 0).map((g) => g.id),
    now: [
      ...schema.fields.filter(isNow).map((f) => f.id),
      ...groups.flatMap((g) => g.columns.filter(isNow).map((c) => c.id)),
    ],
  };
}

/**
 * One row for each person, in the order given (the screen has already chosen who, from `onboardAt`). A Name column gets
 * the full name, a Rank or Function column the rank label (`rankLabel`: the free text for `other`), and a combined
 * `Name / Rank` column `<full name> / <rank>`. A column that is left empty (a signature) is never written, and
 * neither is any other column.
 */
export function crewRows(group: RowGroupDef, people: CrewMember[]): Record<string, FormValue>[] {
  return people.map((p) => {
    const row: Record<string, FormValue> = {};
    for (const c of group.columns) {
      if (c.leftEmpty) continue;
      const label = norm(c);
      if (NAME_AND_RANK_COLUMN.test(label)) row[c.id] = `${fullName(p)} / ${rankLabel(p)}`;
      else if (NAME_ONLY.test(label)) row[c.id] = fullName(p);
      else if (RANK_COLUMN.test(label)) row[c.id] = rankLabel(p);
    }
    return row;
  });
}

/**
 * The values that set "everything OK", by field or column id.
 *
 * The rule for a choice: the first option that reads yes, ok or good (a whole word, case ignored, and not negated:
 * `Not OK` is skipped). With none, the setup's `okWord` if it is one of the options (written as the option spells it).
 * With neither, nothing is written for that field: an option that does not exist is never made up. Fields of any other
 * kind are ignored.
 *
 * For a group the result is one row to apply to every row:
 * - a `checklist` group (an Excel condition list) gets `okWord` as it is in its Condition column (else its Status
 *   column); a choice column is treated as a choice;
 * - any other group gets the positive option of each of its choice columns.
 */
export function allOkValues(fieldsOrGroup: FieldDef[] | RowGroupDef, okWord: string): Record<string, FormValue> {
  const out: Record<string, FormValue> = {};
  const fields = Array.isArray(fieldsOrGroup) ? fieldsOrGroup : fieldsOrGroup.columns;
  for (const f of fields) {
    if (f.kind !== 'choice' || f.leftEmpty) continue;
    const option = okOption(f.options ?? [], okWord);
    if (option !== undefined) out[f.id] = option;
  }
  if (!Array.isArray(fieldsOrGroup) && fieldsOrGroup.shape === 'checklist') {
    const column = checklistColumn(fieldsOrGroup);
    if (column !== undefined && column.kind !== 'choice' && okWord.trim() !== '') out[column.id] = okWord;
  }
  return out;
}

/**
 * `allOkValues` applied to every row of a group: `rowLabels.length` rows, else `capacity`. `existing` rows keep their
 * other values (a remark), and the ok values overwrite the ones they set. The screen then changes the exceptions.
 */
export function allOkRows(group: RowGroupDef, okWord: string, existing: Record<string, FormValue>[] = []): Record<string, FormValue>[] {
  const ok = allOkValues(group, okWord);
  const count = Math.max(group.rowLabels?.length ?? group.capacity, existing.length);
  return Array.from({ length: count }, (_, i) => ({ ...existing[i], ...ok }));
}

/**
 * The values a new draft starts with from the last one: the rows of every `startFromLast` group and the fields of
 * every listed matrix block (R14), and nothing else, so a header field (the date, the vessel) is not carried. A
 * column that is left empty on purpose, a picture and an empty value are not copied.
 */
export function startFromLast(schema: FormSchema, last: DraftValues | undefined): DraftValues {
  const out: DraftValues = { fields: {}, rows: {} };
  if (last === undefined) return out;
  for (const g of schema.rowGroups) {
    if (!copiesFromLast(g)) continue;
    const rows = last.rows[g.id];
    if (rows === undefined) continue;
    const copy = new Set(g.columns.filter((c) => !c.leftEmpty && c.kind !== 'picture').map((c) => c.id));
    out.rows[g.id] = rows.map((row) => {
      const kept: Record<string, FormValue> = {};
      for (const [id, v] of Object.entries(row)) if (copy.has(id) && v !== null) kept[id] = v;
      return kept;
    });
  }
  const blocks = new Set(matrixBlocks(schema));
  for (const f of schema.fields) {
    const v = last.fields[f.id];
    if (f.block !== undefined && blocks.has(f.block) && !f.leftEmpty && f.kind !== 'picture' && v !== undefined && v !== null) out.fields[f.id] = v;
  }
  return out;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** The ISO week of a date as a period: `2026-W44` (the week number is padded, and the year is the ISO week's year). */
export function isoWeekPeriod(shipToday: string): string {
  const { year, week } = isoWeek(shipToday);
  return `${year}-W${pad(week)}`;
}

/**
 * The period a draft belongs to: the month (`2026-10`) when the form has Today's row, else the ISO week
 * (`2026-W44`) when it has a job log, else the day (`2026-10-28`).
 */
export function draftPeriod(setup: FormSetup, shipToday: string): string {
  if (setup.helpers.todayRow.length > 0) return shipToday.slice(0, 7);
  if (setup.helpers.jobLog.length > 0) return isoWeekPeriod(shipToday);
  return shipToday;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** `2026-10` is `October 2026`, `2026-W05` is `Week 5, 2026`, `2026-10-28` is `28-OCT-2026`. Anything else is returned as it is. */
export function periodLabel(period: string): string {
  const month = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (month) return `${MONTHS[Number(month[2]) - 1]} ${month[1]}`;
  const week = /^(\d{4})-W(\d{2})$/.exec(period);
  if (week) return `Week ${Number(week[2])}, ${week[1]}`;
  return isValidIsoDate(period) ? formatDisplayDate(period) : period;
}

/** The first option that reads Pending, Open or In progress (case, spaces and a hyphen ignored), as written; `''` when none does. */
export function defaultNotFinished(options: string[]): string {
  return options.find((o) => /^(?:pending|open|in progress)$/.test(o.trim().toLowerCase().replace(/[-\s]+/g, ' '))) ?? '';
}

/**
 * The setup a template starts with: the suggested links, the fields and columns marked as left empty, the suggested
 * helpers, `DEFAULT_OK_WORD`, and, as the not-finished status, `defaultNotFinished` of the first job log's Status options.
 */
export function defaultSetup(schema: FormSchema): FormSetup {
  const helpers = suggestHelpers(schema);
  const jobs = schema.rowGroups.find((g) => g.id === helpers.jobLog[0]);
  const status = jobs === undefined ? undefined : jobLogColumns(jobs)?.status;
  return {
    links: suggestLinks(schema),
    leftEmpty: [
      ...schema.fields.filter((f) => f.leftEmpty).map((f) => f.id),
      ...schema.rowGroups.flatMap((g) => g.columns.filter((c) => c.leftEmpty).map((c) => c.id)),
    ],
    helpers,
    okWord: DEFAULT_OK_WORD,
    notFinished: defaultNotFinished(status?.options ?? []),
  };
}

/**
 * The rows of the job log that start the next week's draft: those whose Status equals `notFinished` exactly (so
 * nothing rolls over when `notFinished` is `''`). A row keeps every value except its picture columns and its `Photo`
 * choice columns, which are left out: Date, Responsible, Description, Status and Remarks stay. The date is kept
 * as it was. A group that is not a job log (the pictures group of the weekly form) carries nothing: only the jobs group is rolled over.
 */
export function rolloverJobs(group: RowGroupDef, rows: Record<string, FormValue>[], notFinished: string): Record<string, FormValue>[] {
  const cols = jobLogColumns(group);
  if (cols === undefined || notFinished === '') return [];
  const cleared = new Set(cols.cleared.map((c) => c.id));
  return rows
    .filter((row) => row[cols.status.id] === notFinished)
    .map((row) => Object.fromEntries(Object.entries(row).filter(([id]) => !cleared.has(id))));
}

/** What a reading is checked against. A missing bound is not checked. */
export interface Threshold { column: string; low?: number; high?: number }

/**
 * The limits for each column of a group from its Alarm rows (R8: `fixedRows` whose label matches `/alarm/i`). A cell
 * that is not a number is skipped, and so is a column with no number in any alarm row. The first cell is the label
 * column when it repeats the label (Word does that), and then it has no limit. For a column titled O2 with two limits,
 * the lower is `low` and the higher `high`; every other column takes the first alarm row's number as `high`.
 * `values` is not used.
 */
export function thresholdsOf(group: RowGroupDef, _values?: DraftValues): Threshold[] {
  const rows = alarmRows(group);
  const out: Threshold[] = [];
  group.columns.forEach((c, i) => {
    const numbers = rows.map((r) => r.cells[i]).filter((n): n is number => n !== undefined);
    if (numbers.length === 0) return;
    if (OXYGEN.test(c.label) && numbers.length >= 2) out.push({ column: c.id, low: Math.min(...numbers), high: Math.max(...numbers) });
    else out.push({ column: c.id, high: numbers[0] });
  });
  return out;
}

/**
 * Checks a typed reading (a comma is a decimal mark): `low` below the lower limit, `high` above the upper one, so
 * a reading on a limit is `ok`. Text that is not a number is `invalid`; an empty reading is `ok`, as there is nothing to warn about.
 */
export function checkReading(value: string, t: { low?: number; high?: number }): 'ok' | 'low' | 'high' | 'invalid' {
  const n = parseDecimal(value);
  if (n === undefined) return 'ok';
  if (n === 'invalid') return 'invalid';
  if (t.low !== undefined && n < t.low) return 'low';
  if (t.high !== undefined && n > t.high) return 'high';
  return 'ok';
}

/** The time on the ship's clock, `HH:mm`: UTC now moved by the ship's offset in minutes. */
export function nowValue(nowUtc: Date, offsetMinutes: number): string {
  const ship = new Date(nowUtc.getTime() + offsetMinutes * 60_000);
  return `${pad(ship.getUTCHours())}:${pad(ship.getUTCMinutes())}`;
}

// Lives in `src/domain/dayGrid.ts` so that Home can use it without loading the engine; kept here for the engine's callers.
export { todayRowIndex };

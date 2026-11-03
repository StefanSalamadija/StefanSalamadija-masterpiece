import { addDays } from '../domain/dates';
import type { FieldContext } from '../domain/fieldDictionary';
import { parseDecimal } from '../domain/numbers';
import { shipOffsetAt, toShipLocal } from '../domain/shipTime';
import type { ClockChange, FormDraft } from '../domain/types';
// Types only: the forms engine is loaded on demand (see `src/forms/load.ts`). What the engine computes (auto values, the
// period, the jobs that roll over) is passed in.
import type { WriteErrorCode } from '../forms/errors';
import type { DraftValues, FieldDef, FieldLink, FormKind, FormSchema, FormSetup, FormValue, RowGroupDef } from '../forms/types';

/*
 * What the fill screen (`FormFill.tsx`) shows and writes, worked out from a form's schema and a draft's values. Pure; the
 * screen and its components only draw it. Text read from a form (labels, sections, options) is untrusted and is only put
 * into strings that are rendered as text.
 *
 * When a draft starts, and its auto values (rulings R18):
 * - Opening the fill screen stores nothing. Until the first change the screen shows auto values worked out for now
 *   (`autoAt`), kept fresh as the clock moves.
 * - The first change (an edit, a row added or removed, a photo, a helper) fixes them: the auto values of that moment
 *   become the draft's values (`fixedState`), and `autoIds` lists the fields that hold one. Only then is the draft
 *   stored, for the period of that moment.
 * - From then on the draft's values are what they are. Reopening it on another day, after a reload or a relaunch, never
 *   works the auto values out again: a permit started at 08:00 keeps 08:00, a W44 job log keeps W44.
 * - An edit takes the field out of `autoIds`; only the ids in `autoIds` are marked `Auto`. So an edit always wins.
 * - A stored draft with no `autoIds` (an older record, or the next week's draft a made file started) has never had its
 *   auto values fixed: it is shown and fixed the same way, at its first change, over the values it already holds.
 */

/** What `autoValues` gives: values by field id, and why a person field has none (`No Master onboard`). */
export interface AutoFill {
  values: Record<string, string>;
  missing: Record<string, string>;
}

export const NUMBER_INVALID = 'Enter a number, such as 12.5 or 12,5.';
export const SHARE_CANCELLED = 'File not shared — your draft is still here.';
export const fileMadeText = (fileName: string): string => `File made: ${fileName}`;
export const DRAFT_DISCARDED = 'Draft discarded.';

/** `<code> <title>`, or the title alone for a form without a code. */
export function fillHeading(t: { code: string; title: string }): string {
  return t.code === '' ? t.title : `${t.code} ${t.title}`;
}

/* ---- What is asked for, and in which order ---- */

/** A field or column the person fills here: not a signature (left empty), not a picture (Task 16 adds photos). */
export function isAsked(field: FieldDef): boolean {
  return !field.leftEmpty && field.kind !== 'picture';
}

/** The columns of a table that are asked for, in the table's order. */
export function visibleColumns(group: RowGroupDef): FieldDef[] {
  return group.columns.filter(isAsked);
}

export type FillItem = { kind: 'field'; field: FieldDef } | { kind: 'group'; group: RowGroupDef };

/** One block of the fill screen: a section of the form (`''` for what is under no heading) and what it asks for. */
export interface FillSection {
  title: string;
  items: FillItem[];
}

/**
 * Where an address is in the file, as numbers that sort in document order: the part (in the order the schema first
 * names it), then the element path in Word (`word/document.xml#0/5/3`; a tick row's first cell) or the row and column in
 * Excel (`xl/worksheets/sheet1.xml!C9`). `undefined` for an address it cannot read; such items keep their schema order.
 *
 * This is the one place outside the engine that reads a `loc`. It only puts the tables among the fields: the schema
 * lists fields and tables apart, each in document order.
 */
function orderKey(loc: string, partRank: (part: string) => number): number[] | undefined {
  const word = /^([^#]+)#(\d+(?:\/\d+)*)/.exec(loc);
  if (word) return [partRank(word[1]), ...word[2].split('/').map(Number)];
  const excel = /^(.+)!([A-Z]+)(\d+)$/.exec(loc);
  if (excel) {
    const col = [...excel[2]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
    return [partRank(excel[1]), Number(excel[3]), col];
  }
  return undefined;
}

function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

const partOf = (loc: string): string => loc.split(/[#!]/)[0];

/**
 * The form's fields and tables grouped by section, in document order. A section comes where its first item is, and
 * keeps every item of that name. Signatures and pictures are left out, and so is a table with no column left to fill.
 */
export function fillSections(schema: FormSchema): FillSection[] {
  const parts: string[] = [];
  for (const x of [...schema.fields, ...schema.rowGroups]) if (!parts.includes(partOf(x.loc))) parts.push(partOf(x.loc));
  const rank = (part: string): number => parts.indexOf(part);
  const items: { item: FillItem; key?: number[]; at: number }[] = [
    ...schema.fields.filter(isAsked).map((field) => ({ item: { kind: 'field', field } as FillItem, loc: field.loc })),
    ...schema.rowGroups.filter((g) => visibleColumns(g).length > 0).map((group) => ({ item: { kind: 'group', group } as FillItem, loc: group.loc })),
  ].map(({ item, loc }, at) => ({ item, key: orderKey(loc, rank), at }));
  items.sort((a, b) => (a.key && b.key ? compareKeys(a.key, b.key) || a.at - b.at : a.at - b.at));
  const sections: FillSection[] = [];
  for (const { item } of items) {
    const title = item.kind === 'field' ? item.field.section : item.group.section;
    const found = sections.find((s) => s.title === title);
    if (found) found.items.push(item);
    else sections.push({ title, items: [item] });
  }
  return sections;
}

/* ---- Controls ---- */

/** A text field that takes several lines: one whose label says Remarks, Description or Comments. */
export function isLongText(field: FieldDef): boolean {
  return field.kind === 'text' && /remarks|description|comments/i.test(field.label);
}

/** Up to four options are a row of buttons; more are a list. */
export function choiceControl(field: FieldDef): 'buttons' | 'select' {
  return (field.options?.length ?? 0) <= 4 ? 'buttons' : 'select';
}

/** Why a typed number cannot be read (a comma or a point is the decimal mark, and a minus is allowed), or none. */
export function numberProblem(text: string): string | undefined {
  return parseDecimal(text, { signed: true }) === 'invalid' ? NUMBER_INVALID : undefined;
}

/** The key of a table cell in `fillProblems`: `<group id>#<row index>#<column id>`. */
export const cellKey = (groupId: string, row: number, columnId: string): string => `${groupId}#${row}#${columnId}`;

/** Every number field and cell whose text is not a number, by field id or `cellKey`. */
export function fillProblems(schema: FormSchema, values: DraftValues): Record<string, string> {
  const out: Record<string, string> = {};
  const check = (key: string, field: FieldDef, value: FormValue | undefined): void => {
    if (field.kind !== 'number' || !isAsked(field) || typeof value !== 'string') return;
    const problem = numberProblem(value);
    if (problem) out[key] = problem;
  };
  for (const field of schema.fields) check(field.id, field, values.fields[field.id]);
  for (const group of schema.rowGroups) {
    (values.rows[group.id] ?? []).forEach((row, i) => {
      for (const column of group.columns) check(cellKey(group.id, i, column.id), column, row?.[column.id]);
    });
  }
  return out;
}

/* ---- Values ---- */

const has = (record: object, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);

/** A draft's values with both parts there, whatever an old record or another device left. */
export function draftValuesOf(values: Partial<DraftValues> | undefined): DraftValues {
  return { fields: { ...values?.fields }, rows: { ...values?.rows } };
}

/** What the fill screen holds of a draft: its values, and the ids of the fields that still hold an untouched auto value. */
export interface FillState {
  values: DraftValues;
  autoIds: string[];
}

/** The auto values for `instant`, and the ship's date then (the ship's clock changes decide the offset). */
export function autoAt(
  autoValues: (schema: FormSchema, links: Record<string, FieldLink>, ctx: FieldContext, date: string) => AutoFill,
  schema: FormSchema, setup: FormSetup, ctx: FieldContext, instant: Date,
): { auto: AutoFill; shipDate: string } {
  const shipDate = shipDateAt(ctx.clockChanges, instant);
  return { auto: autoValues(schema, setup.links, { ...ctx, nowUtc: instant }, shipDate), shipDate };
}

/** The ship's date (`YYYY-MM-DD`) at `instant`. */
export function shipDateAt(clockChanges: ClockChange[], instant: Date): string {
  return toShipLocal(instant, shipOffsetAt(clockChanges, instant)).date;
}

/**
 * The auto values fixed into a draft's values: each auto value goes into a field that has no value of its own yet (a
 * value already there, such as a carried-over job's, is kept), and `autoIds` lists those fields.
 */
export function withAutoValues(auto: AutoFill, existing?: Partial<DraftValues>): FillState {
  const values = draftValuesOf(existing);
  const autoIds: string[] = [];
  for (const [id, value] of Object.entries(auto.values)) {
    if (has(values.fields, id)) continue;
    values.fields[id] = value;
    autoIds.push(id);
  }
  return { values, autoIds };
}

/** Whether a stored draft's auto values are fixed: then it is shown as it is, and its auto values are never worked out again. */
export function isFixed(draft: Pick<FormDraft, 'autoIds'> | undefined): boolean {
  return draft?.autoIds !== undefined;
}

/**
 * What the screen shows for a draft: a fixed draft as it is stored; a draft not stored yet, or not fixed yet, with the
 * auto values `fresh` gives (worked out for now). This is also what the first change starts from.
 */
export function fixedState(draft: Pick<FormDraft, 'values' | 'autoIds'> | undefined, fresh: AutoFill): FillState {
  if (draft !== undefined && draft.autoIds !== undefined) return { values: draftValuesOf(draft.values), autoIds: [...draft.autoIds] };
  return withAutoValues(fresh, draft?.values);
}

/** What a field shows (`null` when it has nothing). */
export function shownValue(values: DraftValues, fieldId: string): FormValue {
  return values.fields[fieldId] ?? null;
}

/** Whether a field shows an untouched auto value, marked `Auto`. */
export function isAuto(state: FillState, fieldId: string): boolean {
  return state.autoIds.includes(fieldId);
}

export function setField(values: DraftValues, fieldId: string, value: FormValue): DraftValues {
  return { ...values, fields: { ...values.fields, [fieldId]: value } };
}

/** An edit of a field: its value, and it no longer holds an auto value. */
export function editField(state: FillState, fieldId: string, value: FormValue): FillState {
  return { values: setField(state.values, fieldId, value), autoIds: state.autoIds.filter((id) => id !== fieldId) };
}

/** Whether a table names its rows (an inventory, a day grid, a checklist): then it has all its rows, always. */
export function isFixedRows(group: RowGroupDef): boolean {
  return (group.rowLabels?.length ?? 0) > 0 || group.shape === 'dayGrid';
}

/** The rows a table shows: every row of a table that names its rows, else the rows entered. */
export function rowCount(group: RowGroupDef, rows: readonly unknown[]): number {
  if (!isFixedRows(group)) return rows.length;
  return Math.max(group.rowLabels?.length || group.capacity, rows.length);
}

/** A row's name: the text the form has in its first column (`Item 120`, `5`), else `Row <n>`. */
export function rowTitle(group: RowGroupDef, index: number): string {
  const label = group.rowLabels?.[index]?.trim();
  if (label) return label;
  return group.shape === 'dayGrid' ? `Day ${index + 1}` : `Row ${index + 1}`;
}

/**
 * Whether `Add row` is offered: never for a table that names its rows; else while the table has room, or always when
 * it can grow. An Excel table never grows.
 */
export function canAddRow(group: RowGroupDef, kind: FormKind, count: number): boolean {
  if (isFixedRows(group)) return false;
  return count < group.capacity || (group.growable && kind !== 'xlsx');
}

export function addRow(values: DraftValues, groupId: string): DraftValues {
  return { ...values, rows: { ...values.rows, [groupId]: [...(values.rows[groupId] ?? []), {}] } };
}

export function removeRow(values: DraftValues, groupId: string, index: number): DraftValues {
  return { ...values, rows: { ...values.rows, [groupId]: (values.rows[groupId] ?? []).filter((_, i) => i !== index) } };
}

/** Sets one cell. The rows above it are made, empty, when a table that names its rows is filled further down. */
export function setCell(values: DraftValues, group: RowGroupDef, index: number, columnId: string, value: FormValue): DraftValues {
  const rows = [...(values.rows[group.id] ?? [])];
  while (rows.length <= index) rows.push({});
  rows[index] = { ...rows[index], [columnId]: value };
  return { ...values, rows: { ...values.rows, [group.id]: rows } };
}

const isBlank = (v: FormValue | undefined): boolean => v === undefined || v === null || v === '';

/**
 * The values the file is made from (and that become the last values): the form's own fields, but none that is left
 * empty or not in the form. A table keeps its rows up to the last one with a value, and only the columns that are not
 * left empty, so that an empty row added and left never makes the table grow.
 */
export function fileValues(schema: FormSchema, values: DraftValues): DraftValues {
  const fields: Record<string, FormValue> = {};
  for (const field of schema.fields) {
    if (field.leftEmpty) continue; // a picture is kept: its value is a photo id (Task 16)
    if (has(values.fields, field.id)) fields[field.id] = values.fields[field.id] ?? null;
  }
  const rows: Record<string, Record<string, FormValue>[]> = {};
  for (const group of schema.rowGroups) {
    const kept = new Set(group.columns.filter((c) => !c.leftEmpty).map((c) => c.id));
    const records = (values.rows[group.id] ?? []).map((row) => Object.fromEntries(Object.entries(row ?? {}).filter(([id]) => kept.has(id))));
    let end = records.length;
    while (end > 0 && Object.values(records[end - 1]).every(isBlank)) end -= 1;
    if (end > 0) rows[group.id] = records.slice(0, end);
  }
  return { fields, rows };
}

/* ---- Making the file ---- */

/** The engine functions `rolloverFor` needs (from `loadFormsEngine`). */
export interface RolloverEngine {
  draftPeriod: (setup: FormSetup, shipToday: string) => string;
  isJobLogGroup: (group: RowGroupDef) => boolean;
  rolloverJobs: (group: RowGroupDef, rows: Record<string, FormValue>[], notFinished: string) => Record<string, FormValue>[];
}

/**
 * The period after `period`: the ship's current period when the draft is from an earlier one (a week's file made on
 * the Monday after), else the next one. Found by walking forward from the ship's today, so that it works for a week, a
 * month or a day alike.
 */
export function nextPeriod(setup: FormSetup, period: string, shipToday: string, draftPeriod: RolloverEngine['draftPeriod']): string {
  const current = draftPeriod(setup, shipToday);
  if (current !== period) return current;
  for (let n = 1; n <= 62; n += 1) {
    const next = draftPeriod(setup, addDays(shipToday, n));
    if (next !== period) return next;
  }
  return current;
}

/**
 * The next draft that a made file starts, when the job log is on: the jobs that are not finished (`rolloverJobs`), for
 * the next period. None when the job log is off or every job is finished.
 */
export function rolloverFor(
  schema: FormSchema, setup: FormSetup, values: DraftValues, period: string, shipToday: string, engine: RolloverEngine,
): { period: string; values: DraftValues } | undefined {
  const rows: Record<string, Record<string, FormValue>[]> = {};
  for (const group of schema.rowGroups) {
    if (!setup.helpers.jobLog.includes(group.id) || !engine.isJobLogGroup(group)) continue;
    const carried = engine.rolloverJobs(group, values.rows[group.id] ?? [], setup.notFinished);
    if (carried.length > 0) rows[group.id] = carried;
  }
  if (Object.keys(rows).length === 0) return undefined;
  return { period: nextPeriod(setup, period, shipToday, engine.draftPeriod), values: { fields: {}, rows } };
}

/** The label of the field, column or table with this id. */
function labelOf(schema: FormSchema, id: string | undefined): string | undefined {
  if (id === undefined) return undefined;
  return [...schema.fields, ...schema.rowGroups, ...schema.rowGroups.flatMap((g) => g.columns)].find((x) => x.id === id)?.label;
}

const WRITE_REASONS: Record<Exclude<WriteErrorCode, 'tooManyRows'>, string> = {
  notAnOption: "the value isn't one of the form's options",
  formula: 'that cell holds a formula',
  photo: 'its photo is missing or damaged',
  wrongKind: "the value isn't the kind this field takes",
  notInFile: "the file no longer matches this form's setup. Import the form again",
};

/**
 * A writer's `FormWriteError` in plain words, from its code and field id (never from its message), naming the field
 * by its label and never by its id: `"<label>" can't be written into this form: <reason>.`
 */
export function writeErrorText(err: { code: WriteErrorCode; fieldId?: string }, schema: FormSchema): string {
  const label = labelOf(schema, err.fieldId);
  const who = label === undefined ? 'A value' : `"${label}"`;
  const group = schema.rowGroups.find((g) => g.id === err.fieldId);
  const reason = err.code === 'tooManyRows'
    ? (group ? `the table has room for ${group.capacity} rows only` : 'the table has no room for more rows')
    : WRITE_REASONS[err.code] ?? WRITE_REASONS.notInFile;
  return `${who} can't be written into this form: ${reason}.`;
}

/**
 * How `Make file` ended: the file was handed over and the draft closed; it was handed over but the draft could not be
 * closed (`error`: the person has the file, and must not make it twice); the share was cancelled; or it could not be made.
 */
export type MakeOutcome =
  | { kind: 'made'; fileName: string }
  | { kind: 'madeNotClosed'; fileName: string; error: unknown }
  | { kind: 'cancelled' }
  | { kind: 'problem'; message: string };

/** The steps of `Make file`, from the engine, the share sheet and the data layer. */
export interface MakeSteps {
  /** `makeFile` for the draft: writes, checks and names the file. */
  make: (values: DraftValues) => { fileName: string; bytes: Uint8Array; mime: string };
  isIntegrityError: (err: unknown) => err is Error & { reason: string };
  isWriteError: (err: unknown) => err is Error & { code: WriteErrorCode; fieldId?: string };
  /** Keeps a failed check's reason for diagnostics; it is never shown to the person. */
  logIntegrity: (reason: string) => void;
  share: (fileName: string, data: Blob) => Promise<'shared' | 'downloaded' | 'cancelled'>;
  /** Closes the draft once the file is handed over (`closeDraft`, with the rollover when the job log applies). */
  close: (values: DraftValues) => Promise<void>;
}

/**
 * `Make file` (spec §4 step 4): makes the file from `values` (the file's values, `fileValues`), hands it to the share sheet
 * or downloads it, and only then closes the draft. A file that fails its check (`IntegrityError`, whose message is the
 * one to show; its reason goes to `logIntegrity`) or that a value has no place in (`FormWriteError`, said in plain
 * words) is never handed over, and a cancelled share leaves the draft as it is: in both cases nothing is closed. A
 * draft that cannot be closed after the file was handed over is `madeNotClosed`. Anything else is thrown.
 */
export async function makeAndHandOver(schema: FormSchema, values: DraftValues, steps: MakeSteps): Promise<MakeOutcome> {
  let made: ReturnType<MakeSteps['make']>;
  try {
    made = steps.make(values);
  } catch (err) {
    if (steps.isIntegrityError(err)) {
      steps.logIntegrity(err.reason);
      return { kind: 'problem', message: err.message };
    }
    if (steps.isWriteError(err)) return { kind: 'problem', message: writeErrorText(err, schema) };
    throw err;
  }
  const result = await steps.share(made.fileName, new Blob([made.bytes as Uint8Array<ArrayBuffer>], { type: made.mime }));
  if (result === 'cancelled') return { kind: 'cancelled' };
  try {
    await steps.close(values);
  } catch (error) {
    return { kind: 'madeNotClosed', fileName: made.fileName, error };
  }
  return { kind: 'made', fileName: made.fileName };
}

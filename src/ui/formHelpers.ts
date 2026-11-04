import { addDays, isoWeek } from '../domain/dates';
import { shipOffsetAt } from '../domain/shipTime';
import type { ClockChange } from '../domain/types';
// Types only: the forms engine is loaded on demand (see `src/forms/load.ts`). The engine's rules are passed in.
import { isOpenCell } from '../forms/cells';
import type { DraftValues, FieldDef, FormKind, FormSchema, FormSetup, FormValue, RowGroupDef } from '../forms/types';

/*
 * The rules behind the helpers of the fill screen (spec §7, Task 16), as pure functions. The engine's own rules (`crewRows`,
 * `allOkValues`, `checkReading` and the like, in `src/forms/helpers.ts`) are passed in, because the screen loads the engine
 * on demand; what is here is what the screen adds to them: where a draft's auto date comes from, what All OK does to the
 * values, which rows the crew and the photos go into, and the texts of the warnings. Text read from a form is untrusted
 * and only goes into strings that are rendered as text.
 */

const has = (record: object, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);
const isBlank = (v: FormValue | undefined): boolean => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const sameAnswer = (a: FormValue | undefined, b: FormValue | undefined): boolean =>
  typeof a === 'string' && typeof b === 'string' ? a.trim().toLowerCase() === b.trim().toLowerCase() : a === b;
const rowIsBlank = (row: Record<string, FormValue> | undefined): boolean => Object.values(row ?? {}).every(isBlank);

/* ---- The auto date of a draft (R19) ---- */

/**
 * The first day of a period: the day itself (`2026-10-28`), the Monday of an ISO week (`2026-W44`), the first of a month
 * (`2026-10`). `undefined` for anything else.
 */
export function periodStart(period: string): string | undefined {
  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) return period;
  const month = /^(\d{4})-(\d{2})$/.exec(period);
  if (month) return `${month[1]}-${month[2]}-01`;
  const week = /^(\d{4})-W(\d{2})$/.exec(period);
  if (week) return addDays(isoWeek(`${week[1]}-01-04`).monday, (Number(week[2]) - 1) * 7);
  return undefined;
}

/**
 * The date a draft's auto values are worked out for, when they are fixed at its first change: the ship's today if it lies
 * inside the draft's `period` (that is, `todayPeriod`, the period of today, is the same), else the first day of the period.
 */
export function autoDateFor(period: string, shipToday: string, todayPeriod: string): string {
  if (period === todayPeriod) return shipToday;
  return periodStart(period) ?? shipToday;
}

/* ---- Start from last ---- */

/**
 * `start` (what `startFromLast` gives for the last values) put under what the draft holds: only the groups and matrix
 * blocks the setup lists, a group only when the draft has no row with a value in it, a field only when it has none.
 * Nothing the draft holds is overwritten.
 */
export function withLastValues(
  existing: Partial<DraftValues> | undefined, schema: FormSchema, setup: FormSetup, start: DraftValues,
): DraftValues {
  const out: DraftValues = { fields: { ...existing?.fields }, rows: { ...existing?.rows } };
  const listed = new Set(setup.helpers.startFromLast);
  for (const [id, rows] of Object.entries(start.rows)) {
    if (listed.has(id) && (out.rows[id] ?? []).every(rowIsBlank)) out.rows[id] = rows;
  }
  for (const field of schema.fields) {
    if (field.block !== undefined && listed.has(field.block) && has(start.fields, field.id) && !has(out.fields, field.id)) {
      out.fields[field.id] = start.fields[field.id];
    }
  }
  return out;
}

/** What a value of the last file reads as: its text, `Yes` or `No` for a box; none for an empty value. */
export function lastText(value: FormValue | undefined): string | undefined {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** `Last: <value>` under an input whose value is not the last file's; none when it is the same or there was none. */
export function lastShown(current: FormValue | undefined, last: string | undefined): string | undefined {
  if (last === undefined) return undefined;
  return (lastText(current) ?? '') === last ? undefined : `Last: ${last}`;
}

/* ---- All OK ---- */

/** One All OK button: the fields and tables of one section that it sets, and its text. */
export interface AllOkButton {
  key: string;
  section: string;
  label: string;
  fieldIds: string[];
  groupIds: string[];
}

type AllOkValues = (fieldsOrGroup: FieldDef[] | RowGroupDef, okWord: string) => Record<string, FormValue>;

/**
 * The All OK buttons: one for each section that has fields or tables the helper is on for (the setup's `allOk`) and that
 * have an OK answer to set. A button is worded `All <answer>`: the answer it sets (`Yes`), or the setup's OK word when the
 * answers differ.
 */
export function allOkButtons(schema: FormSchema, setup: FormSetup, allOkValues: AllOkValues): AllOkButton[] {
  const buttons: (AllOkButton & { words: Set<string> })[] = [];
  for (const id of setup.helpers.allOk) {
    const field = schema.fields.find((f) => f.id === id);
    const group = field ? undefined : schema.rowGroups.find((g) => g.id === id);
    const target = field ?? group;
    if (!target) continue;
    const values = allOkValues(field ? [field] : group!, setup.okWord);
    const words = Object.values(values).filter((v): v is string => typeof v === 'string');
    if (words.length === 0) continue;
    let button = buttons.find((b) => b.section === target.section);
    if (!button) {
      button = { key: target.section, section: target.section, label: '', fieldIds: [], groupIds: [], words: new Set() };
      buttons.push(button);
    }
    (field ? button.fieldIds : button.groupIds).push(id);
    for (const w of words) button.words.add(w);
  }
  return buttons.map(({ words, ...b }) => ({ ...b, label: `All ${words.size === 1 ? [...words][0] : setup.okWord}` }));
}

/** What `applyAllOk` did: the new values, how many answers already given differ from OK, and the fields it set. */
export interface AllOkResult {
  values: DraftValues;
  differing: number;
  set: string[];
}

/**
 * Sets the OK answer in the fields and tables of a button: in every empty one, and, with `replace`, in those that hold
 * another answer too. `differing` counts those other answers whether or not they were replaced. The input is not changed.
 */
export function applyAllOk(
  values: DraftValues, schema: FormSchema, button: AllOkButton, okWord: string, allOkValues: AllOkValues, replace: boolean,
): AllOkResult {
  const out: DraftValues = { fields: { ...values.fields }, rows: { ...values.rows } };
  let differing = 0;
  const set: string[] = [];
  const place = (current: FormValue | undefined, ok: FormValue): boolean => {
    if (isBlank(current)) return true;
    if (sameAnswer(current, ok)) return false;
    differing += 1;
    return replace;
  };
  for (const id of button.fieldIds) {
    const field = schema.fields.find((f) => f.id === id);
    if (!field) continue;
    const ok = allOkValues([field], okWord)[id];
    if (ok !== undefined && place(out.fields[id], ok)) {
      out.fields[id] = ok;
      set.push(id);
    }
  }
  for (const id of button.groupIds) {
    const group = schema.rowGroups.find((g) => g.id === id);
    if (!group) continue;
    const ok = allOkValues(group, okWord);
    const existing = out.rows[id] ?? [];
    const count = group.rowLabels?.length || existing.length;
    out.rows[id] = Array.from({ length: Math.max(count, existing.length) }, (_, i) => {
      const row = { ...existing[i] };
      for (const [column, answer] of Object.entries(ok)) {
        // A closed cell (R22) is not on the form: nothing is set there.
        if (isOpenCell(group, i, column) && place(row[column], answer)) row[column] = answer;
      }
      return row;
    });
  }
  return { values: out, differing, set };
}

/* ---- Remarks under a row that is not OK ---- */

/** The columns of a checklist row that go together: its answer, the answer that is OK, and its remarks. */
export interface RemarksRule {
  status: string;
  remarks: string;
  ok: string;
}

/** The rule for a table whose rows are answered OK or not (`okValues` is what All OK sets in a row) and that has a Remarks column. */
export function remarksRule(group: RowGroupDef, okValues: Record<string, FormValue>): RemarksRule | undefined {
  const status = group.columns.find((c) => has(okValues, c.id) && typeof okValues[c.id] === 'string');
  const remarks = group.columns.find((c) => c.kind === 'text' && !c.leftEmpty && /remark/i.test(c.label) && c.id !== status?.id);
  if (!status || !remarks) return undefined;
  return { status: status.id, remarks: remarks.id, ok: okValues[status.id] as string };
}

/** Whether the Remarks of a row are shown: its answer is neither empty nor OK, or it has a remark already. */
export function remarksShown(rule: RemarksRule, row: Record<string, FormValue> | undefined): boolean {
  if (!isBlank(row?.[rule.remarks])) return true;
  const answer = row?.[rule.status];
  return !isBlank(answer) && !sameAnswer(answer, rule.ok);
}

/* ---- Rows from the crew, jobs and photos ---- */

/** How many rows a table can hold: any number when it can grow (a Word table; an Excel one never does), else its capacity. */
export function rowLimit(group: RowGroupDef, kind: FormKind): number {
  return group.growable && kind !== 'xlsx' ? Infinity : group.capacity;
}

/**
 * Puts `rows` into the free (empty) rows of a table in order, then after its last row, up to `limit` rows in all. Gives
 * the new values and how many rows were placed. The input is not changed.
 *
 * A row takes a record only when every cell the record fills is open there (R22: not a cell that continues a vertical
 * merge, such as a Name cell merged down from the row above); other free rows are passed over and stay empty. So no
 * value is put where the file would not show it.
 */
export function placeRows(
  values: DraftValues, group: RowGroupDef, rows: Record<string, FormValue>[], limit: number,
): { values: DraftValues; placed: number } {
  const next = [...(values.rows[group.id] ?? [])];
  let placed = 0;
  const fits = (at: number, row: Record<string, FormValue>): boolean => Object.entries(row).every(([id, v]) => isBlank(v) || isOpenCell(group, at, id));
  for (const row of rows) {
    let at = -1;
    for (let k = 0; k < limit; k += 1) {
      const free = k >= next.length || rowIsBlank(next[k]);
      if (free && fits(k, row)) {
        at = k;
        break;
      }
      // Past the rows there are, every new row has the cells of the template's last row: if it does not fit, none will.
      if (k >= next.length && k >= group.capacity - 1) break;
    }
    if (at < 0) break;
    while (next.length < at) next.push({});
    next[at] = { ...row };
    placed += 1;
  }
  return { values: { ...values, rows: { ...values.rows, [group.id]: next } }, placed };
}

/** A new job: the date (the ship's today) and, if the form has one, the status of a job that is not finished. */
export function newJobRow(
  columns: { date: FieldDef; status: FieldDef }, shipToday: string, notFinished: string,
): Record<string, FormValue> {
  return { [columns.date.id]: shipToday, ...(notFinished === '' ? {} : { [columns.status.id]: notFinished }) };
}

/** A place for a photo in a table: its picture column and the choice (Before / After) after it, if there is one. */
export interface PhotoSlot {
  picture: FieldDef;
  choice?: FieldDef;
}

/** The places for photos in a table, in column order. None when the table has no picture column. */
export function photoSlots(group: RowGroupDef): PhotoSlot[] {
  return group.columns.flatMap((picture, i) => {
    if (picture.kind !== 'picture' || picture.leftEmpty) return [];
    const next = group.columns[i + 1];
    return [{ picture, choice: next?.kind === 'choice' && !next.leftEmpty ? next : undefined }];
  });
}

/**
 * The first place without a photo, row by row, or a new row's first place; none when the table has no room for one.
 * A picture cell that continues a vertical merge (R22) is no place for a photo.
 */
export function nextFreeSlot(
  group: RowGroupDef, rows: Record<string, FormValue>[], limit: number,
): { row: number; slot: PhotoSlot } | undefined {
  const slots = photoSlots(group);
  if (slots.length === 0) return undefined;
  const free = (row: number): PhotoSlot | undefined => slots.find((s) => isOpenCell(group, row, s.picture.id) && isBlank(rows[row]?.[s.picture.id]));
  for (let row = 0; row < rows.length; row += 1) {
    const slot = free(row);
    if (slot) return { row, slot };
  }
  const slot = rows.length < limit ? free(rows.length) : undefined;
  return slot && { row: rows.length, slot };
}

/* ---- Readings, the clock, the rows shown, blocks ---- */

/** `O2 18.5 — below 19.5` or `CO 31 — above 25` for a reading past its limit; none otherwise (or when it is no number). */
export function readingWarning(
  label: string, value: FormValue | undefined, limits: { low?: number; high?: number },
  check: (value: string, t: { low?: number; high?: number }) => 'ok' | 'low' | 'high' | 'invalid',
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const short = label.replace(/\s*[[(].*$/, '').trim() || label;
  const result = check(value, limits);
  if (result === 'low') return `${short} ${value.trim()} — below ${limits.low}`;
  if (result === 'high') return `${short} ${value.trim()} — above ${limits.high}`;
  return undefined;
}

/** The offset `Now` uses for a field: none for a time written in UTC (`(24:00 UTC)`), else the ship's at that moment. */
export function nowOffset(field: { formatHint?: string }, changes: ClockChange[], nowUtc: Date): number {
  return /24:00\s*utc/i.test(field.formatHint ?? '') ? 0 : shipOffsetAt(changes, nowUtc);
}

/** The indexes of the rows shown: just `only` when there is such a row, else all of `count`. */
export function shownRows(count: number, only: number | undefined): number[] {
  if (only !== undefined && only >= 0 && only < count) return [only];
  return Array.from({ length: count }, (_, i) => i);
}

/** The heading of a matrix block (`<sheet>!m<n>`): `Table <n>`, with the sheet's name when the form has blocks on several. */
export function blockTitle(block: string, withSheet: boolean): string {
  const m = /^(.*)!m(\d+)$/.exec(block);
  if (!m) return block;
  return withSheet ? `${m[1]}: Table ${m[2]}` : `Table ${m[2]}`;
}

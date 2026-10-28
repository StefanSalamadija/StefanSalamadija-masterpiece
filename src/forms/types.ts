import type { FormKind } from './package';

export type { FormKind } from './package';

/**
 * What a field takes:
 * - `text`: any text;
 * - `date`: a calendar date;
 * - `time`: a time of day;
 * - `number`: a number, kept as the text that was typed;
 * - `checkbox`: a box that is ticked or not;
 * - `choice`: one of `options` (a dropdown, or a row of tick boxes such as Yes / No / N/A);
 * - `picture`: a photo.
 */
export type FieldKind = 'text' | 'date' | 'time' | 'number' | 'checkbox' | 'choice' | 'picture';

/**
 * One fillable place in a form. Detection (Tasks 4 and 7) makes these once, at import, and they are stored with the
 * template: writing and reading go to `loc` and never detect again.
 */
export interface FieldDef {
  /**
   * Identifies the field, and is the same every time the same file is detected. In Word the ids run in document order:
   * `f1`, `f2` and so on, and `g1.c1` and so on for the columns of a row group. In Excel a field's id is
   * `<sheet>!<A1>` (the sheet's name and the cell), and a row group's is `<sheet>!g<n>`.
   */
  id: string;
  kind: FieldKind;
  /**
   * The visible text that names the field, trimmed, with a trailing `:` removed (`Vessel:` becomes `Vessel`). It keeps
   * its case: `normaliseLabel` is for matching labels only, and is never stored as the label. A field that has no label
   * nearby is called `Field <n>` and has `confidence: 'low'`.
   */
  label: string;
  /** The nearest heading above the field, or `''` when the form has none. */
  section: string;
  /**
   * Where the field is in the template file: an opaque address that detection sets and that is the same every time
   * for the same file. Only the code that made it reads it.
   * - Word: the part's path and then the index of each child element from the root element down to the field's node
   *   (the encoding is documented in the Word detection code).
   * - Excel: `<sheet path>!<A1>`, the sheet's part in the zip and the cell, e.g. `xl/worksheets/sheet1.xml!B7`.
   *
   * For a column of a row group (`RowGroupDef.columns`) it is relative to a row instead. In Word it is the path from
   * the row element down to the cell or field. In Excel it is the column's letters, e.g. `C`; the row comes from the
   * group's `firstRow`.
   */
  loc: string;
  /** The options of a `choice` field, in the order the form shows them. */
  options?: string[];
  /**
   * The date or time format the form asks for, as it was written near the field (`dd/MMM/yyyy`, or `(24:00 UTC)` for a
   * time in UTC), or the format of the field's own control. `formatDate` formats a `date` field by it.
   */
  formatHint?: string;
  /** A signature or stamp. It is never written, so the person signs the printed form. */
  leftEmpty?: boolean;
  /** `low` for a field whose label or kind was a guess, which the person is asked to check. */
  confidence: 'high' | 'low';
}

/**
 * A table area made of rows that repeat (participants, a log, a jobs list, an inventory). The columns are fields, and
 * the same set of them is filled in each row.
 */
export interface RowGroupDef {
  /** `g1`, `g2` and so on in Word, in document order; `<sheet>!g<n>` in Excel. */
  id: string;
  label: string;
  section: string;
  /**
   * Where the group's first row or item is in the template: the same kind of address as `FieldDef.loc`. Row `i` of the
   * group sits `i` rows or items after it.
   */
  loc: string;
  /** Excel only: the sheet row of the group's row 0. Row `i` of the group is sheet row `firstRow + i`. */
  firstRow?: number;
  /** The fields of one row. Their `loc` is relative to the row, as `FieldDef.loc` says. */
  columns: FieldDef[];
  /** The number of rows or items the template holds. */
  capacity: number;
  /** Whether more rows can be added (a Word repeating section, or a table row that can be cloned). */
  growable: boolean;
  /** The text already in the first column of each row (item names, day numbers). */
  rowLabels?: string[];
  /**
   * Rows that are already filled in the template, between the table's header row and the group's first row: reference
   * rows such as alarm limits (`Alarm 1 | 19.5 | 25 | 5`). They are not rows of the group and are never written.
   * `label` is the row's first-cell text; `cells` are the texts under the group's columns, in column order.
   */
  fixedRows?: { label: string; cells: string[] }[];
  /**
   * What the rows are:
   * - `rows`: a plain list, such as participants or an inventory;
   * - `dayGrid`: one row for each day of the month;
   * - `matrix`: a grid of cells, each with a column title and a row name;
   * - `checklist`: a list of conditions, each with a status.
   */
  shape: 'rows' | 'dayGrid' | 'matrix' | 'checklist';
}

/** What names a form in the library. `code` is `''` for a form that has none. */
export interface FormIdentity {
  code: string;
  title: string;
  revision: string;
}

/** What detection finds in a template. */
export interface FormSchema {
  kind: FormKind;
  identity: FormIdentity;
  fields: FieldDef[];
  rowGroups: RowGroupDef[];
  /** What the form has that cannot be filled in here, each as a sentence the person can read. */
  unsupported: string[];
}

/**
 * The value of a field in a draft, in a form that does not depend on how the template shows it. Writers turn it into
 * what the file holds, and readers turn what the file holds back into it:
 * - `date` fields hold an ISO date, `YYYY-MM-DD`;
 * - `time` fields hold `HH:mm`;
 * - `checkbox` fields hold a boolean;
 * - `choice` fields hold the text of the chosen option;
 * - `picture` fields hold the id of the photo;
 * - `text` and `number` fields hold the text as typed.
 *
 * `null` is a value nobody has given. This is not the field dictionary's `FieldValue`.
 */
export type FormValue = string | boolean | null;

/**
 * The values entered for one form. `fields` is by field id. `rows` is by row group id, with one record for each row, by
 * the column's field id. Every value is in the canonical form `FormValue` describes.
 */
export interface DraftValues {
  fields: Record<string, FormValue>;
  rows: Record<string, Record<string, FormValue>[]>;
}

/**
 * Where a field is filled in from by itself: the ship, its crew, the voyage or the time. `source` is a name from the field dictionary
 * (`vessel.name`, `vessel.imo`, `voyage.nextPort`, `voyage.agents` and the like), `crew.byRank.<RankKey>` (a person
 * by rank), or one of the time sources `time.date`, `time.time`, `time.timeUtc`, `time.month`, `time.yearWeek` and
 * `time.weekRange`. For a person, `part` says which part to give: `name` the full name, `rank` the rank, `nameRank`
 * both as `<full name> / <rank>`. `{ source: 'none' }` is a field the person chose not to link.
 */
export type FieldLink = { source: string; part?: 'name' | 'rank' | 'nameRank' } | { source: 'none' };

/**
 * What a helper does, for the groups or fields it is switched on for:
 * - `pickCrew`: adds rows from the crew list;
 * - `allOk`: sets a whole section or group to the OK answer;
 * - `todayRow`: opens today's row in a day grid;
 * - `startFromLast`: starts from the values of the last file made;
 * - `jobLog`: a job list that carries unfinished jobs over;
 * - `thresholds`: checks readings against the alarm rows;
 * - `now`: puts the current time in a time field.
 */
export type HelperKey = 'pickCrew' | 'allOk' | 'todayRow' | 'startFromLast' | 'jobLog' | 'thresholds' | 'now';

/** What the person has chosen for a template. */
export interface FormSetup {
  /** By field id. A field with no entry has no link. */
  links: Record<string, FieldLink>;
  /** The ids of the fields (and columns) that are left empty on purpose, such as a signature. */
  leftEmpty: string[];
  /** For each helper, the ids of the groups or fields it is switched on for. */
  helpers: Record<HelperKey, string[]>;
  /** The word `allOk` writes in a field that has no option for it. */
  okWord: string;
  /** The status of a job that is not finished, which `jobLog` carries over to the next file. */
  notFinished: string;
}

export const DEFAULT_OK_WORD = 'Satisfactory';

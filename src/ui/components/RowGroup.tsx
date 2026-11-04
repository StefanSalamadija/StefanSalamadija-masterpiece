import { Component } from 'preact';
import { useId, useLayoutEffect, useRef } from 'preact/hooks';
import { isOpenCell } from '../../forms/cells';
import type { FieldDef, FormKind, FormValue, RowGroupDef } from '../../forms/types';
import { canAddRow, isFixedRows, rowColumns, rowCount, rowTitle, visibleColumns } from '../formFill';
import { remarksShown, shownRows } from '../formHelpers';
import type { RemarksRule } from '../formHelpers';
import { FormField } from './FormField';
import { PhotoField } from './JobLog';

/*
 * A table of a form on the fill screen: its rows, one fieldset each, named by the row's label in the form (`Item 120`)
 * or `Row <n>`, with the table's columns as fields. A plain table lists the rows entered, with `Add row` while it has
 * room or can grow and `Remove` on each row. A table that names its rows (an inventory, a day grid, a checklist) shows
 * all of them, always, and has neither.
 *
 * A form can have long tables (an inventory of 120 rows), so a row is drawn again only when its own values, its errors
 * or its place change, not on every key typed elsewhere. What the helpers add to a row (`RowExtras`) is therefore worked
 * out from the row's own values only.
 */

/** What the helpers add to a table (spec §7). All of it is optional. */
export interface RowExtras {
  /** The columns that have a `Now` button, and what it does. */
  nowColumns?: ReadonlySet<string>;
  onNow?: (index: number, column: FieldDef) => void;
  /** An alarm warning for a cell, from its value (shown once the cell was left). */
  warningFor?: (index: number, column: FieldDef, value: FormValue) => string | undefined;
  /** Photos in the row's picture columns (a job log with pictures): a thumbnail, `Add photo` and `Remove photo` for each. */
  photos?: {
    busy: boolean;
    errorFor: (index: number, column: FieldDef) => string | undefined;
    onFile: (index: number, column: FieldDef, file: File) => void;
    onRemove: (index: number, column: FieldDef) => void;
  };
  /** `Last: <value>` for a cell, from its value. */
  lastFor?: (index: number, column: FieldDef, value: FormValue) => string | undefined;
  /** A column offered as a choice among these (the people onboard). */
  choicesFor?: (column: FieldDef) => string[] | undefined;
  /** A checklist's Remarks column is shown under a row that is not OK only. */
  remarks?: RemarksRule;
  /** A day grid opens on today's row (`row`); `all` shows every day. */
  today?: { row: number; all: boolean; onToggle: () => void };
  /** The text of the button that adds a row, `Add row` unless it is a job log (`Add job`). */
  addLabel?: string;
  /** `Add from crew`. */
  onAddCrew?: () => void;
}

export interface RowGroupProps {
  group: RowGroupDef;
  /** The form's kind: an Excel table never grows. */
  kind: FormKind;
  /** The rows entered, by column id (shorter than the table when its last rows are untouched). */
  rows: Record<string, FormValue>[];
  /** Whether to show the table's name above its rows (not when it is the section's heading already). */
  showLabel: boolean;
  onCell: (index: number, columnId: string, value: FormValue) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  /** The error shown for a cell, if any. */
  errorFor: (index: number, columnId: string) => string | undefined;
  /** A cell was left, so that its error is shown from then on. */
  onLeave: (index: number, columnId: string) => void;
  /** The `data-key` of a cell's input. */
  keyFor: (index: number, columnId: string) => string;
  extras?: RowExtras;
}

interface RowProps {
  group: RowGroupDef;
  index: number;
  title: string;
  row: Record<string, FormValue> | undefined;
  errors: Record<string, string> | undefined;
  /** Alarm warnings and photo problems of the row, by column id. */
  notices: Record<string, string> | undefined;
  /** A photo is being added: the row's photo buttons are off. */
  photoBusy: boolean;
  removable: boolean;
  parent: RowGroupProps;
}

const sameErrors = (a: Record<string, string> | undefined, b: Record<string, string> | undefined): boolean => {
  const ka = Object.keys(a ?? {});
  return ka.length === Object.keys(b ?? {}).length && ka.every((k) => a![k] === b?.[k]);
};

/** One row. A class, for `shouldComponentUpdate`: the callbacks are read from the props at the time of the event. */
class Row extends Component<RowProps> {
  shouldComponentUpdate(next: RowProps): boolean {
    const p = this.props;
    return next.row !== p.row || next.index !== p.index || next.title !== p.title || next.removable !== p.removable || next.photoBusy !== p.photoBusy
      || next.group !== p.group || !sameErrors(next.errors, p.errors) || !sameErrors(next.notices, p.notices);
  }

  render() {
    const { group, index, title, row, errors, notices, photoBusy, removable } = this.props;
    const extras = this.props.parent.extras;
    const rule = extras?.remarks;
    return (
      <fieldset class="fill-row" data-row={index}>
        <legend>{title}</legend>
        {rowColumns(group, index).filter((c) => !(rule && c.id === rule.remarks && !remarksShown(rule, row))).map((column) => {
          const value = row?.[column.id] ?? null;
          return (
            <FormField
              key={column.id} field={column} value={value} error={errors?.[column.id]}
              dataKey={this.props.parent.keyFor(index, column.id)}
              onChange={(next) => this.props.parent.onCell(index, column.id, next)}
              onLeave={() => this.props.parent.onLeave(index, column.id)}
              onNow={extras?.nowColumns?.has(column.id) ? () => extras.onNow?.(index, column) : undefined}
              warning={notices?.[`warn:${column.id}`]} last={extras?.lastFor?.(index, column, value)}
              choices={extras?.choicesFor?.(column)}
            />
          );
        })}
        {extras?.photos && group.columns.filter((c) => c.kind === 'picture' && !c.leftEmpty && isOpenCell(group, index, c.id)).map((column) => (
          <PhotoField
            key={column.id} field={column} value={row?.[column.id] ?? null} busy={photoBusy} error={notices?.[`photo:${column.id}`]}
            onFile={(file) => extras.photos?.onFile(index, column, file)} onRemove={() => extras.photos?.onRemove(index, column)}
          />
        ))}
        {removable && (
          <div class="fill-row-actions">
            <button type="button" class="btn btn-outline btn-small" onClick={() => this.props.parent.onRemove(index)}>Remove</button>
          </div>
        )}
      </fieldset>
    );
  }
}

export function RowGroup(props: RowGroupProps) {
  const { group, kind, rows, showLabel, errorFor, extras } = props;
  const headingId = useId();
  const box = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  /** Where the focus goes once the rows are drawn: into a row just added, or to `Add row` after a row was removed. */
  const focusNext = useRef<{ row: number } | 'add' | undefined>(undefined);
  const fixed = isFixedRows(group);
  const count = rowCount(group, rows);
  const canAdd = canAddRow(group, kind, count);
  const columns = visibleColumns(group);
  /** The data-key of a cell to focus once the rows are drawn: the Remarks of a row just answered with something that is not OK. */
  const focusCell = useRef<string | undefined>(undefined);
  const rule = extras?.remarks;
  const parent: RowGroupProps = {
    ...props,
    onRemove: (index) => {
      focusNext.current = 'add';
      props.onRemove(index);
    },
    onCell: (index, columnId, value) => {
      // Choosing an answer that is not OK opens the row's Remarks and moves to it (typing one does not: the focus stays in the answer).
      const column = columns.find((c) => c.id === columnId);
      if (rule && columnId === rule.status && column?.kind === 'choice' && !remarksShown(rule, rows[index]) && remarksShown(rule, { ...rows[index], [columnId]: value })) {
        focusCell.current = props.keyFor(index, rule.remarks);
      }
      props.onCell(index, columnId, value);
    },
  };

  useLayoutEffect(() => {
    const next = focusNext.current;
    focusNext.current = undefined;
    if (next === undefined) return;
    if (next === 'add') (addButton.current ?? box.current)?.focus();
    else box.current?.querySelector<HTMLElement>(`[data-row="${next.row}"] :is(input, select, textarea, button)`)?.focus();
  }, [count]);

  useLayoutEffect(() => {
    const key = focusCell.current;
    focusCell.current = undefined;
    if (key !== undefined) box.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus();
  }, [rows]);

  const today = extras?.today;
  const only = today && !today.all ? today.row : undefined;

  return (
    <div ref={box} class="fill-group" tabIndex={-1} aria-labelledby={showLabel ? headingId : undefined} role={showLabel ? 'group' : undefined}>
      {showLabel && <h4 id={headingId}>{group.label}</h4>}
      {today && (
        <div class="fill-row-actions">
          <button type="button" class="btn btn-outline btn-small" onClick={today.onToggle}>
            {today.all ? 'Show today only' : 'Show all days'}
          </button>
        </div>
      )}
      {count === 0 && <p class="empty">No rows yet.</p>}
      {shownRows(count, only).map((i) => {
        const errors: Record<string, string> = {};
        const notices: Record<string, string> = {};
        for (const c of columns) {
          const e = errorFor(i, c.id);
          if (e) errors[c.id] = e;
          const w = extras?.warningFor?.(i, c, rows[i]?.[c.id] ?? null);
          if (w) notices[`warn:${c.id}`] = w;
        }
        for (const c of group.columns) {
          const e = c.kind === 'picture' ? extras?.photos?.errorFor(i, c) : undefined;
          if (e) notices[`photo:${c.id}`] = e;
        }
        return (
          <Row
            key={i} group={group} index={i} title={rowTitle(group, i)} row={rows[i]}
            errors={Object.keys(errors).length > 0 ? errors : undefined}
            notices={Object.keys(notices).length > 0 ? notices : undefined} photoBusy={extras?.photos?.busy ?? false} removable={!fixed} parent={parent}
          />
        );
      })}
      {(canAdd || extras?.onAddCrew) && (
        <div class="fill-row-actions">
          {canAdd && (
            <button
              ref={addButton} type="button" class="btn btn-outline btn-small"
              onClick={() => {
                focusNext.current = { row: count };
                props.onAdd();
              }}
            >
              {extras?.addLabel ?? 'Add row'}
            </button>
          )}
          {extras?.onAddCrew && <button type="button" class="btn btn-outline btn-small" onClick={extras.onAddCrew}>Add from crew</button>}
        </div>
      )}
    </div>
  );
}

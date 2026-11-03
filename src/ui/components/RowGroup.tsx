import { Component } from 'preact';
import { useId, useLayoutEffect, useRef } from 'preact/hooks';
import type { FormKind, FormValue, RowGroupDef } from '../../forms/types';
import { canAddRow, isFixedRows, rowCount, rowTitle, visibleColumns } from '../formFill';
import { FormField } from './FormField';

/*
 * A table of a form on the fill screen: its rows, one fieldset each, named by the row's label in the form (`Item 120`)
 * or `Row <n>`, with the table's columns as fields. A plain table lists the rows entered, with `Add row` while it has
 * room or can grow and `Remove` on each row. A table that names its rows (an inventory, a day grid, a checklist) shows
 * all of them, always, and has neither.
 *
 * A form can have long tables (an inventory of 120 rows), so a row is drawn again only when its own values, its errors
 * or its place change, not on every key typed elsewhere.
 */

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
}

interface RowProps {
  group: RowGroupDef;
  index: number;
  title: string;
  row: Record<string, FormValue> | undefined;
  errors: Record<string, string> | undefined;
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
    return next.row !== p.row || next.index !== p.index || next.title !== p.title || next.removable !== p.removable
      || next.group !== p.group || !sameErrors(next.errors, p.errors);
  }

  render() {
    const { group, index, title, row, errors, removable } = this.props;
    return (
      <fieldset class="fill-row" data-row={index}>
        <legend>{title}</legend>
        {visibleColumns(group).map((column) => (
          <FormField
            key={column.id} field={column} value={row?.[column.id] ?? null} error={errors?.[column.id]}
            dataKey={this.props.parent.keyFor(index, column.id)}
            onChange={(value) => this.props.parent.onCell(index, column.id, value)}
            onLeave={() => this.props.parent.onLeave(index, column.id)}
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
  const { group, kind, rows, showLabel, errorFor } = props;
  const headingId = useId();
  const box = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  /** Where the focus goes once the rows are drawn: into a row just added, or to `Add row` after a row was removed. */
  const focusNext = useRef<{ row: number } | 'add' | undefined>(undefined);
  const fixed = isFixedRows(group);
  const count = rowCount(group, rows);
  const canAdd = canAddRow(group, kind, count);
  const columns = visibleColumns(group);
  const parent: RowGroupProps = {
    ...props,
    onRemove: (index) => {
      focusNext.current = 'add';
      props.onRemove(index);
    },
  };

  useLayoutEffect(() => {
    const next = focusNext.current;
    focusNext.current = undefined;
    if (next === undefined) return;
    if (next === 'add') (addButton.current ?? box.current)?.focus();
    else box.current?.querySelector<HTMLElement>(`[data-row="${next.row}"] :is(input, select, textarea, button)`)?.focus();
  }, [count]);

  return (
    <div ref={box} class="fill-group" tabIndex={-1} aria-labelledby={showLabel ? headingId : undefined} role={showLabel ? 'group' : undefined}>
      {showLabel && <h4 id={headingId}>{group.label}</h4>}
      {count === 0 && <p class="empty">No rows yet.</p>}
      {Array.from({ length: count }, (_, i) => {
        const errors: Record<string, string> = {};
        for (const c of columns) {
          const e = errorFor(i, c.id);
          if (e) errors[c.id] = e;
        }
        return (
          <Row
            key={i} group={group} index={i} title={rowTitle(group, i)} row={rows[i]}
            errors={Object.keys(errors).length > 0 ? errors : undefined} removable={!fixed} parent={parent}
          />
        );
      })}
      {canAdd && (
        <div class="fill-row-actions">
          <button
            ref={addButton} type="button" class="btn btn-outline btn-small"
            onClick={() => {
              focusNext.current = { row: count };
              props.onAdd();
            }}
          >
            Add row
          </button>
        </div>
      )}
    </div>
  );
}

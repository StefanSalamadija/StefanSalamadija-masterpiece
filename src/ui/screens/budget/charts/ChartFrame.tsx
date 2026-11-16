import type { ComponentChildren } from 'preact';
import { useId, useState } from 'preact/hooks';

export interface TableData { columns: string[]; rows: string[][] }

/** A chart's data as a table: its caption is the chart's name, and each row's first cell heads the row. */
export function ChartTable({ name, table }: { name: string; table: TableData }) {
  return (
    <div class="table-scroll">
      <table class="chart-table">
        <caption>{name}</caption>
        <thead><tr>{table.columns.map((c, i) => <th key={i} scope="col">{c}</th>)}</tr></thead>
        <tbody>
          {table.rows.map((row, r) => (
            <tr key={r}>{row.map((cell, i) => (i === 0 ? <th key={i} scope="row">{cell}</th> : <td key={i}>{cell}</td>))}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A chart: a figure named by its caption, the picture (named the same, for a screen reader) with its legend, and a
 * "Show as table" toggle that puts the same figures in a table in its place.
 */
export function ChartFrame({ name, table, legend, children }: { name: string; table: TableData; legend?: ComponentChildren; children: ComponentChildren }) {
  const [asTable, setAsTable] = useState(false);
  const id = useId();
  return (
    <figure class="chart" aria-labelledby={id}>
      <figcaption id={id} class="chart-name">{name}</figcaption>
      {asTable ? <ChartTable name={name} table={table} /> : <>{children}{legend}</>}
      <button type="button" class="btn btn-outline btn-small chart-toggle no-print" onClick={() => setAsTable(!asTable)}>
        {asTable ? 'Show as chart' : 'Show as table'}
      </button>
    </figure>
  );
}

/** A legend: each series' line or swatch and its name. */
export function Legend({ items }: { items: { label: string; kind: 'line' | 'bar' | 'shade'; index: number }[] }) {
  return (
    <ul class="chart-legend" aria-hidden="true">
      {items.map((it) => (
        <li key={it.label}>
          <svg viewBox="0 0 24 10" width="24" height="10">
            {it.kind === 'line' && <line x1="0" y1="5" x2="24" y2="5" class={`chart-line series-${it.index}`} />}
            {it.kind === 'bar' && <rect x="4" y="0" width="16" height="10" class={`chart-bar bar-${it.index}`} />}
            {it.kind === 'shade' && <rect x="0" y="0" width="24" height="10" class="chart-shade" />}
          </svg>
          {it.label}
        </li>
      ))}
    </ul>
  );
}

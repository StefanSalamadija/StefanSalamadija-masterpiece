import { useId, useState } from 'preact/hooks';
import { shareOrDownload } from '../../../backup/share';
import { monthLabel, monthsBetween } from '../../../budget/months';
import type { Ym } from '../../../domain/types';
import { BudgetFrame, useCurrentYm } from './Frame';
import { TextField, useBusy, usePlanData } from './planKit';
import type { PlanData } from './planKit';

const EXCEL_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const YEAR = /^\d{4}$/;
/** The most month sheets one file holds: five years. */
const MAX_MONTHS = 60;

type Span = 'month' | 'range' | 'year';

/** The first month with an entry or a plan, for the range's default start. */
function firstYm(data: PlanData, fallback: Ym): Ym {
  const yms = [...data.entries.map((e) => e.date.slice(0, 7)), ...data.months.map((m) => m.ym)].filter((ym) => ym <= fallback);
  return yms.reduce((min, ym) => (ym < min ? ym : min), fallback);
}

function ExportForm({ data }: { data: PlanData }) {
  const currentYm = useCurrentYm();
  const name = useId();
  const [span, setSpan] = useState<Span>('month');
  const [month, setMonth] = useState(currentYm);
  const [from, setFrom] = useState(() => firstYm(data, currentYm));
  const [to, setTo] = useState(currentYm);
  const [year, setYear] = useState(currentYm.slice(0, 4));
  const [status, setStatus] = useState('');
  const [busy, run] = useBusy();

  const [start, end]: [string, string] = span === 'month' ? [month, month] : span === 'range' ? [from, to] : [`${year}-01`, `${year}-12`];
  const valid = span === 'year' ? YEAR.test(year) : YM.test(start) && YM.test(end);
  const count = valid ? monthsBetween(start, end) + 1 : 0;
  const error = !valid ? undefined : count < 1 ? 'The last month comes before the first.' : count > MAX_MONTHS ? `At most ${MAX_MONTHS} months in one file.` : undefined;
  const ok = valid && error === undefined;

  return (
    <form class="budget-edit" aria-label="Export to Excel" onSubmit={(e) => {
      e.preventDefault();
      if (!ok) return;
      setStatus('');
      run(async () => {
        // SheetJS is loaded now, not with the app (see the import).
        const writer = await import('../../../budget/excel/export').catch((cause: unknown) => {
          throw new Error("The Excel writer couldn't be loaded. Reload the app and try again.", { cause });
        });
        const bytes = writer.budgetWorkbookOf({
          categories: data.categories, entries: data.entries, months: data.months, funds: data.funds, fundMoves: data.fundMoves,
          corrections: data.corrections, debts: data.debts, assets: data.assets, recurring: data.recurring,
        }, start, end);
        const outcome = await shareOrDownload(writer.exportFileName(start, end), new Blob([bytes], { type: EXCEL_TYPE }));
        setStatus(outcome === 'cancelled' ? 'Export cancelled.' : 'Exported.');
      });
    }}>
      <fieldset class="plan-scope">
        <legend>Export</legend>
        {(['month', 'range', 'year'] as Span[]).map((s) => (
          <label key={s} class="check">
            <input type="radio" name={name} checked={span === s} onChange={() => { setSpan(s); setStatus(''); }} />
            {s === 'month' ? 'A month' : s === 'range' ? 'A range of months' : 'A year'}
          </label>
        ))}
      </fieldset>
      {span === 'month' && <TextField label="Month" type="month" value={month} onInput={setMonth} />}
      {span === 'range' && (
        <>
          <TextField label="From" type="month" value={from} onInput={setFrom} />
          <TextField label="To" type="month" value={to} onInput={setTo} error={error} />
        </>
      )}
      {span === 'year' && <TextField label="Year" inputMode="numeric" value={year} onInput={setYear} maxLength={4} error={valid ? undefined : 'Enter a year, such as 2026.'} />}
      {ok && (
        <p class="helper-text">
          {count === 1 ? monthLabel(start) : `${count} months, ${monthLabel(start)} to ${monthLabel(end)}`}: a sheet per month in the layout of your workbook, and a summary sheet.
        </p>
      )}
      <div class="row-actions"><button type="submit" class="btn btn-primary" disabled={busy || !ok}>Export to Excel</button></div>
      <p class="live" role="status">{status}</p>
    </form>
  );
}

function ExportBody() {
  const data = usePlanData();
  return data ? <ExportForm data={data} /> : <p class="live" role="status">Loading…</p>;
}

/** `/budget/export` (base §3.9): a month, a range or a year as an .xlsx workbook, shared or downloaded like other exports. */
export function ExportBudget() {
  return <BudgetFrame title="Export to Excel"><ExportBody /></BudgetFrame>;
}

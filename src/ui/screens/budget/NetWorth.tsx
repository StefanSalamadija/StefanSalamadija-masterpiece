import { useMemo } from 'preact/hooks';
import { useAppState } from '../../../app/AppState';
import { balancesByMonth } from '../../../budget/ledger';
import { formatMoney } from '../../../budget/money';
import { summariseMonth } from '../../../budget/month';
import { addMonths, monthLabel, monthsBetween, ymOf } from '../../../budget/months';
import { netWorthSeries, savingsRate, savingsRateOver } from '../../../budget/netWorth';
import { effectiveMonth } from '../../../budget/targets';
import type { Ym } from '../../../domain/types';
import { LineChart } from './charts/LineChart';
import { BudgetFrame } from './Frame';
import { DISCLAIMER, freedomText, outlookOf } from './outlook';
import { usePlanData } from './planKit';
import type { PlanData } from './planKit';

/** The most months of history shown. */
const HISTORY_MONTHS = 120;

const rateText = (r: number | null) => (r === null ? '—' : `${Math.round(r * 100)}%`);

/** The first month the budget knows anything about (a correction or an entry), up to the current one. */
function firstMonth(data: PlanData, ym: Ym): Ym | undefined {
  let first: Ym | undefined;
  for (const c of data.corrections) if (first === undefined || c.ym < first) first = c.ym;
  for (const e of data.entries) {
    const at = ymOf(e.date);
    if (e.status === 'actual' && (first === undefined || at < first)) first = at;
  }
  if (first === undefined || first > ym) return first === undefined ? undefined : ym;
  return monthsBetween(first, ym) >= HISTORY_MONTHS ? addMonths(ym, -(HISTORY_MONTHS - 1)) : first;
}

/** Net worth at each month end and each month's savings rate, from the first month known to the current one. */
export function history(data: PlanData, ym: Ym) {
  const from = firstMonth(data, ym);
  if (from === undefined) return undefined;
  const { balances } = balancesByMonth({
    entries: data.entries, corrections: data.corrections, debts: data.debts, assets: data.assets, categories: data.categories,
    fundMoves: data.fundMoves, funds: data.funds, recurring: data.recurring, fromYm: from, toYm: ym,
  });
  const series = netWorthSeries(balances, data.assets);
  const summaries = series.map((m) => summariseMonth({
    month: effectiveMonth(data.months, m.ym), entries: data.entries, categories: data.categories, fundMoves: data.fundMoves, funds: data.funds,
    corrections: data.corrections,
  }));
  return { balances, series, rates: savingsRate(summaries), rate12: savingsRateOver(summaries.slice(-12)) };
}

function NetWorthBody({ data }: { data: PlanData }) {
  const { shipToday } = useAppState();
  const ym = ymOf(shipToday);
  const h = useMemo(() => history(data, ym), [data, ym]);
  const o = useMemo(() => outlookOf(data, shipToday), [data, shipToday]);
  const f = freedomText(o);
  const a = data.settings.assumptions;
  const free = o.freedom.status === 'ok' ? o.freedom : undefined;
  return (
    <>
      <p class="helper-text">{DISCLAIMER}</p>
      {h === undefined ? <p class="empty">Enter your <a href="#/budget/plan/start">starting balances</a> to see the net worth.</p> : (
        <>
          <p class="budget-surplus">Net worth {formatMoney(h.series[h.series.length - 1].netWorth)}</p>
          <p class="budget-note">
            Savings rate (12 months): {h.rate12 === null ? 'no income recorded yet' : rateText(h.rate12)}
          </p>
          <LineChart name="Net worth by month" months={h.series.map((m) => m.ym)} series={[{ label: 'Net worth', values: h.series.map((m) => m.netWorth) }]} />
          <div class="table-scroll">
            <table class="budget-table">
              <caption>Net worth history</caption>
              <thead><tr><th scope="col">Month</th><th scope="col">Net worth</th><th scope="col">Savings rate</th></tr></thead>
              <tbody>
                {[...h.series].reverse().map((m) => (
                  <tr key={m.ym}>
                    <th scope="row">{monthLabel(m.ym)}</th><td>{formatMoney(m.netWorth)}</td><td>{rateText(h.rates.find((r) => r.ym === m.ym)?.rate ?? null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <section class="budget-section" aria-label="Freedom date">
        <h3>Freedom date</h3>
        <p class="budget-surplus">{f.text}</p>
        {free && (
          <p class="budget-note">
            Freedom number: {formatMoney(free.number)} in today's euros
            {free.ym !== undefined && free.numberAt !== undefined ? ` (${formatMoney(free.numberAt)} in ${monthLabel(free.ym)})` : ''}
          </p>
        )}
        <ul class="budget-lines">
          <li>
            Yearly spending: {formatMoney(o.yearly.amount)}
            {o.yearly.source === 'fixed' ? ' (your own amount)' : ` (average Needs + Wants of the last ${o.yearly.months} tracked month${o.yearly.months === 1 ? '' : 's'}, × 12)`}
          </li>
          <li>Withdrawal rate: {a.withdrawalRatePct}% — <span>an assumption, not advice</span></li>
          <li>Expected return: {a.yearlyReturnPct === undefined ? 'not entered' : `${a.yearlyReturnPct}% a year`} (investments only, monthly)</li>
          <li>
            Inflation: {a.inflationPct === undefined ? 'not entered' : `${a.inflationPct}% a year`} — yearly spending grows smoothly through the year
            (compounded monthly), so the freedom number grows with it
          </li>
        </ul>
        <p class="no-print"><a class="btn btn-outline btn-small" href="#/budget/plan/assumptions">Edit assumptions</a></p>
        <p class="helper-text">{DISCLAIMER}</p>
      </section>
    </>
  );
}

function NetWorthData() {
  const data = usePlanData();
  return data ? <NetWorthBody data={data} /> : <p class="live" role="status">Loading…</p>;
}

/** `/budget/net-worth` (v2 §3.4): the net worth history, the savings rate, and the freedom number and date. */
export function NetWorth() {
  return <BudgetFrame title="Net worth"><NetWorthData /></BudgetFrame>;
}

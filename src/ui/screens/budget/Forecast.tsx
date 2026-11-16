import { useMemo } from 'preact/hooks';
import { useAppState } from '../../../app/AppState';
import { reportError } from '../../../app/errors';
import { POTS } from '../../../budget/catalog';
import { forecast } from '../../../budget/forecast';
import { formatMoney } from '../../../budget/money';
import { monthLabel, ymOf } from '../../../budget/months';
import { updateBudgetSettings } from '../../../db/budget';
import type { BudgetSettings, ForecastMethod } from '../../../domain/types';
import { LineChart } from './charts/LineChart';
import { BudgetFrame } from './Frame';
import { DISCLAIMER, statusText, warningLines } from './outlook';
import { budgetDataOf, SelectField, usePlanData } from './planKit';
import type { PlanData } from './planKit';

const HORIZONS: BudgetSettings['horizon'][] = [12, 24, 36, 60];

/** "Enter your bank balance to see the forecast", with the way to the starting balances. */
export function NeedsBankStart() {
  return (
    <div class="budget-note">
      <p>Enter your bank balance to see the forecast</p>
      <p><a class="btn btn-primary btn-small" href="#/budget/plan/start">Starting balances</a></p>
    </div>
  );
}

function methodText(settings: BudgetSettings, pot: (typeof POTS)[number]['id']): string {
  const m: ForecastMethod = settings.forecastMethod[pot] ?? 'targets';
  if (m === 'targets') return 'its targets';
  if (m === 'average') return 'the average of the last 6 months';
  return `a fixed ${formatMoney(settings.fixedSpend?.[pot] ?? 0)} a month`;
}

/** Every assumption the forecast rests on, with the way to change it (v2 §3.3). */
function AssumptionsPanel({ settings, ym, buffer }: { settings: BudgetSettings; ym: string; buffer: number }) {
  const { rotation, assumptions } = settings;
  const salaries = [...rotation.salaryFrom].sort((a, b) => (a.ym < b.ym ? -1 : 1));
  const now = [...salaries].reverse().find((s) => s.ym <= ym);
  const later = salaries.filter((s) => s.ym > ym);
  const salary = now ? `${formatMoney(now.amount)} a month` : 'not entered';
  const changes = later.map((s) => `${formatMoney(s.amount)} from ${monthLabel(s.ym)}`).join(', ');
  return (
    <section class="budget-section" aria-label="Assumptions">
      <h3>Assumptions</h3>
      <ul class="budget-lines">
        <li>Salary onboard: {salary}{changes ? `; then ${changes}` : ''}</li>
        <li>
          Pay rule: paid in {rotation.paidNextMonth ? 'the next month' : 'the same month'}, {rotation.paidAtHomePct}% at home;
          {' '}{rotation.periods.length} contract period{rotation.periods.length === 1 ? '' : 's'} entered
        </li>
        <li>Pattern after the last contract: {rotation.patternOn} months on, {rotation.patternOff} off</li>
        <li>Horizon: {settings.horizon} months</li>
        <li>Spending: {POTS.map((p) => `${p.label}: ${methodText(settings, p.id)}`).join('; ')}</li>
        <li>Buffer: {formatMoney(buffer)}{settings.bufferCents === undefined ? ' (a month of Needs)' : ''}</li>
        <li>Expected return: {assumptions.yearlyReturnPct === undefined ? 'not entered' : `${assumptions.yearlyReturnPct}% a year`}</li>
      </ul>
      <p class="row-actions no-print">
        <a class="btn btn-outline btn-small" href="#/budget/plan/rotation">Edit rotation and pay</a>
        <a class="btn btn-outline btn-small" href="#/budget/plan/assumptions">Edit assumptions</a>
      </p>
    </section>
  );
}

function ForecastBody({ data }: { data: PlanData }) {
  const { db, shipToday } = useAppState();
  const ym = ymOf(shipToday);
  const r = useMemo(() => forecast({ today: shipToday, data: budgetDataOf(data), settings: data.settings }), [data, shipToday]);
  const picker = (
    <SelectField label="Horizon" value={String(data.settings.horizon)}
      onChange={(v) => updateBudgetSettings(db, { horizon: Number(v) as BudgetSettings['horizon'] }).catch(reportError)}>
      {HORIZONS.map((h) => <option key={h} value={String(h)}>{h} months</option>)}
    </SelectField>
  );
  if (r.needsBankStart) return <>{picker}<NeedsBankStart /><AssumptionsPanel settings={data.settings} ym={ym} buffer={r.buffer} /></>;
  const warnings = warningLines(r);
  const months = r.months.map((m) => m.ym);
  return (
    <>
      <p class="helper-text">{DISCLAIMER}</p>
      {picker}
      {r.lowest && (
        <p class="budget-surplus">Lowest: {formatMoney(r.lowest.freeToSpend)} in {monthLabel(r.lowest.ym)} ({statusText(r.lowest.status).toLowerCase()})</p>
      )}
      {warnings.length > 0 && (
        <ul class="budget-lines field-warning" aria-label="Warnings">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
      )}
      <LineChart name="Bank and free to spend by month" months={months}
        series={[{ label: 'Bank', values: r.months.map((m) => m.bank) }, { label: 'Free to spend', values: r.months.map((m) => m.freeToSpend) }]}
        shade={r.months.map((m) => m.status === 'home')} />
      <div class="table-scroll">
        <table class="budget-table">
          <caption>Forecast by month</caption>
          <thead><tr><th scope="col">Month</th><th scope="col">Onboard or home</th><th scope="col">Income</th><th scope="col">Spending</th><th scope="col">Bank</th><th scope="col">Free to spend</th></tr></thead>
          <tbody>
            {r.months.map((m) => (
              <tr key={m.ym} data-home={m.status === 'home' ? '' : undefined}>
                <th scope="row">{monthLabel(m.ym)}</th><td>{statusText(m.status)}</td><td>{formatMoney(m.income)}</td><td>{formatMoney(m.spending)}</td>
                <td class={m.bank < 0 ? 'budget-over' : undefined}>{formatMoney(m.bank)}</td><td>{formatMoney(m.freeToSpend)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AssumptionsPanel settings={data.settings} ym={ym} buffer={r.buffer} />
    </>
  );
}

/** `/budget/forecast` (v2 §3.3): the bank month by month to the horizon, its lowest point and warnings, and every assumption. */
export function Forecast() {
  return (
    <BudgetFrame title="Forecast">
      <ForecastData />
    </BudgetFrame>
  );
}

function ForecastData() {
  const data = usePlanData();
  return data ? <ForecastBody data={data} /> : <p class="live" role="status">Loading…</p>;
}

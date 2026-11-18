import { useMemo } from 'preact/hooks';
import { useAppState } from '../../../app/AppState';
import { budgetAlerts, fundsDue, itemsToConfirm } from '../../../budget/alerts';
import { POTS } from '../../../budget/catalog';
import { forecast } from '../../../budget/forecast';
import { formatMoney } from '../../../budget/money';
import { summariseMonth } from '../../../budget/month';
import { monthLabel, ymOf } from '../../../budget/months';
import { netWorthSeries } from '../../../budget/netWorth';
import { effectiveMonth } from '../../../budget/targets';
import { RingChart } from './charts/RingChart';
import { BudgetFrame } from './Frame';
import { DISCLAIMER, freedomText, outlookOf, statusText, warningLines } from './outlook';
import { balancesAt, budgetDataOf, usePlanData } from './planKit';
import type { PlanData } from './planKit';

/** How far ahead the dashboard lists the funds due. */
const FUNDS_DAYS = 60;

function StartCard() {
  return (
    <ul class="row-list" role="list" aria-label="Get started">
      <li>
        <a class="list-row" href="#/budget/plan/start">
          <span class="list-row-text">
            <span class="list-row-title">Starting balances</span>
            <span class="list-row-meta">Enter your bank balance, investments, emergency fund and debts to start</span>
          </span>
        </a>
      </li>
    </ul>
  );
}

function DashboardBody({ data }: { data: PlanData }) {
  const { shipToday } = useAppState();
  const ym = ymOf(shipToday);
  const view = useMemo(() => {
    const budget = budgetDataOf(data);
    const balances = balancesAt(data, ym);
    const funds = Object.entries(balances).reduce((sum, [account, v]) => (account.startsWith('fund:') ? sum + v : sum), 0);
    const summary = summariseMonth({ month: effectiveMonth(data.months, ym), entries: data.entries, categories: data.categories, fundMoves: data.fundMoves, funds: data.funds, corrections: data.corrections });
    const near = forecast({ today: shipToday, data: budget, settings: data.settings });
    const alerts = budgetAlerts({ data: budget, settings: data.settings, today: shipToday }).filter((a) => a.key !== 'confirm' && !a.key.startsWith('fund:'));
    return {
      hasBank: data.corrections.some((c) => c.account === 'bank'), bank: balances.bank, free: balances.bank - funds,
      netWorth: netWorthSeries(new Map([[ym, balances]]), data.assets)[0].netWorth, summary, near, outlook: outlookOf(data, shipToday),
      confirm: itemsToConfirm(budget, ym), due: fundsDue(budget, shipToday, FUNDS_DAYS), alerts,
    };
  }, [data, ym, shipToday]);
  const f = freedomText(view.outlook);
  const warnings = [...warningLines(view.near), ...view.alerts.map((a) => a.text)];
  const earlier = view.confirm.earlier;

  return (
    <>
      {!view.hasBank ? <StartCard /> : <p class="budget-surplus">Bank & cash {formatMoney(view.bank)} · Free to spend {formatMoney(view.free)}</p>}
      {earlier > 0 && (
        <p class="field-warning budget-warning">
          <a href={`#/budget/month/${view.confirm.firstYm}`}>{earlier} {earlier === 1 ? 'item' : 'items'} to confirm in earlier months</a>
        </p>
      )}
      <RingChart name="This month by pot" items={view.summary.pots.map((p) => ({ label: POTS.find((x) => x.id === p.pot)!.label, spent: p.spent, target: p.target }))} />

      {warnings.length > 0 && (
        <section class="budget-section">
          <h3>Warnings</h3>
          <ul class="budget-lines field-warning" aria-label="Warnings">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </section>
      )}

      <section class="budget-section" aria-label="Next months">
        <h3>Next months</h3>
        {view.near.needsBankStart ? <p class="empty">The forecast starts once there is a bank balance.</p> : (
          <div class="table-scroll">
            <table class="budget-table">
              <caption>The next 3 months</caption>
              <thead><tr><th scope="col">Month</th><th scope="col">Onboard or home</th><th scope="col">Bank</th><th scope="col">Free to spend</th></tr></thead>
              <tbody>
                {view.near.months.slice(0, 3).map((m) => (
                  <tr key={m.ym} data-home={m.status === 'home' ? '' : undefined}>
                    <th scope="row">{monthLabel(m.ym)}</th><td>{statusText(m.status)}</td><td>{formatMoney(m.bank)}</td><td>{formatMoney(m.freeToSpend)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p class="no-print"><a href="#/budget/forecast">The whole forecast</a></p>
      </section>

      <section class="budget-section" aria-label="Funds due soon">
        <h3>Funds due soon</h3>
        {view.due.length === 0 ? <p class="empty">No fund is due in the next {FUNDS_DAYS} days.</p> : (
          <ul class="budget-list" aria-label="Funds due soon">
            {view.due.map((d) => (
              <li key={d.fundId} class="card budget-row">
                <div class="budget-row-head"><span class="budget-row-name">{d.name}</span><span class="budget-amount">{formatMoney(d.amount)}</span></div>
                <span class="budget-row-detail">{d.daysLeft <= 0 ? 'Due now:' : 'Due'} {monthLabel(d.dueYm)} · {formatMoney(d.balance)} set aside</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section class="budget-section" aria-label="Net worth and freedom">
        <a class="budget-line" href="#/budget/net-worth">
          Net worth {formatMoney(view.netWorth)} · Freedom date: {f.ym !== undefined ? monthLabel(f.ym) : f.missing ? 'see Net worth' : 'not within 60 years'}
        </a>
        <p class="helper-text">{DISCLAIMER}</p>
      </section>

      <ul class="row-list budget-section no-print" role="list" aria-label="Budget">
        <li>
          <a class="list-row" href={`#/budget/month/${ym}`}>
            <span class="list-row-text">
              <span class="list-row-title">{monthLabel(ym)}</span>
              <span class="list-row-meta">Pots, entries, items to confirm and the surplus</span>
            </span>
          </a>
        </li>
        <li>
          <a class="list-row" href="#/budget/catch-up">
            <span class="list-row-text">
              <span class="list-row-title">Catch up</span>
              <span class="list-row-meta">Several entries in a row, after days without entering</span>
            </span>
          </a>
        </li>
        <li>
          <a class="list-row" href="#/budget/trends">
            <span class="list-row-text">
              <span class="list-row-title">Trends</span>
              <span class="list-row-meta">Pots and categories across months, income, balances over time</span>
            </span>
          </a>
        </li>
        <li>
          <a class="list-row" href="#/budget/import">
            <span class="list-row-text">
              <span class="list-row-title">Import from Excel</span>
              <span class="list-row-meta">Your budget workbook, a sheet per month</span>
            </span>
          </a>
        </li>
        <li>
          <a class="list-row" href="#/budget/export">
            <span class="list-row-text">
              <span class="list-row-title">Export to Excel</span>
              <span class="list-row-meta">A month, a range or a year, a sheet per month</span>
            </span>
          </a>
        </li>
      </ul>
    </>
  );
}

function DashboardData() {
  const data = usePlanData();
  return data ? <DashboardBody data={data} /> : <p class="live" role="status">Loading…</p>;
}

/** `/budget` (v2 §3.7): this month's pots, the bank and free to spend, the next months, funds due, warnings, net worth and freedom. */
export function Dashboard() {
  return <BudgetFrame title="Budget"><DashboardData /></BudgetFrame>;
}

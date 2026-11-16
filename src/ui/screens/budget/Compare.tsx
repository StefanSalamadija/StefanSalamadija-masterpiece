import { useMemo, useState } from 'preact/hooks';
import { useAppState } from '../../../app/AppState';
import { compareScenarios } from '../../../budget/scenarios';
import type { BudgetScenario } from '../../../domain/types';
import { LineChart } from './charts/LineChart';
import { NeedsBankStart } from './Forecast';
import { DISCLAIMER, freedomText, outlookOf } from './outlook';
import { budgetDataOf, SelectField } from './planKit';
import type { PlanData } from './planKit';
import { compareTable } from './scenarioView';

/** The base plan and `scenarios` side by side (v2 §3.5): the figures in a table, and a line chart of net worth or bank. */
export function Compare({ data, scenarios }: { data: PlanData; scenarios: BudgetScenario[] }) {
  const { shipToday } = useAppState();
  const [metric, setMetric] = useState<'netWorth' | 'bank'>('netWorth');
  const view = useMemo(() => {
    const outlook = outlookOf(data, shipToday);
    if (outlook.long.needsBankStart) return undefined;
    const rows = compareScenarios({ today: shipToday, data: budgetDataOf(data), settings: data.settings, yearlySpending: outlook.yearly.amount }, scenarios);
    return { rows, table: compareTable(rows, { hasDebts: data.debts.length > 0, freedomKnown: freedomText(outlook).missing !== true }) };
  }, [data, scenarios, shipToday]);
  if (!view) return <NeedsBankStart />;
  const { rows, table } = view;
  const label = metric === 'netWorth' ? 'Net worth' : 'Bank';
  return (
    <section class="budget-section" aria-label="Compare scenarios">
      <h3>Compare</h3>
      <p class="helper-text">{DISCLAIMER}</p>
      <div class="table-scroll">
        <table class="budget-table compare-table">
          <caption>Compare</caption>
          <thead><tr><th scope="col"></th>{rows.map((r, i) => <th key={i} scope="col">{r.name}</th>)}</tr></thead>
          <tbody>
            {table.map((t) => <tr key={t.label}><th scope="row">{t.label}</th>{t.cells.map((c, i) => <td key={i}>{c}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
      <SelectField label="Chart" value={metric} onChange={(v) => setMetric(v as 'netWorth' | 'bank')}>
        <option value="netWorth">Net worth</option>
        <option value="bank">Bank</option>
      </SelectField>
      <LineChart name={`${label} by month, base plan and scenarios`} months={rows[0].series.map((m) => m.ym)}
        series={rows.map((r) => ({ label: r.name, values: r.series.map((m) => m[metric]) }))} />
    </section>
  );
}

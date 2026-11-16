import { useMemo, useState } from 'preact/hooks';
import { useAppState } from '../../../app/AppState';
import { POTS } from '../../../budget/catalog';
import { balancesByMonth } from '../../../budget/ledger';
import { summariseMonth } from '../../../budget/month';
import { addMonths, monthLabel, ymOf } from '../../../budget/months';
import { effectiveMonth } from '../../../budget/targets';
import type { Ym } from '../../../domain/types';
import { BarChart } from './charts/BarChart';
import { LineChart } from './charts/LineChart';
import { shortMonth } from './charts/scale';
import { BudgetFrame } from './Frame';
import { SelectField, usePlanData } from './planKit';
import type { PlanData } from './planKit';

/** The months the trends cover: the last 12 up to the current one. */
const TREND_MONTHS = 12;

function trendsOf(data: PlanData, ym: Ym) {
  const months = Array.from({ length: TREND_MONTHS }, (_, i) => addMonths(ym, i - TREND_MONTHS + 1));
  const summaries = months.map((m) => summariseMonth({
    month: effectiveMonth(data.months, m), entries: data.entries, categories: data.categories, fundMoves: data.fundMoves, funds: data.funds,
    corrections: data.corrections,
  }));
  const { balances } = balancesByMonth({
    entries: data.entries, corrections: data.corrections, debts: data.debts, assets: data.assets, categories: data.categories,
    fundMoves: data.fundMoves, funds: data.funds, recurring: data.recurring, fromYm: months[0], toYm: ym,
  });
  return { months, summaries, balances };
}

function TrendsBody({ data }: { data: PlanData }) {
  const { shipToday } = useAppState();
  const ym = ymOf(shipToday);
  const t = useMemo(() => trendsOf(data, ym), [data, ym]);
  const [categoryId, setCategoryId] = useState('');
  const category = data.categories.find((c) => c.id === categoryId);
  const labels = t.months.map(monthLabel);
  const short = t.months.map(shortMonth);
  const debtsOf = (record: Record<string, number>) => Object.entries(record).reduce((sum, [k, v]) => (k.startsWith('debt:') ? sum + v : sum), 0);
  return (
    <>
      <LineChart name="Spending by pot" months={t.months}
        series={POTS.map((p) => ({ label: p.label, values: t.summaries.map((s) => s.pots.find((x) => x.pot === p.id)!.spent) }))} />
      <SelectField label="Category" value={categoryId} onChange={setCategoryId}>
        <option value="">Choose a category…</option>
        {data.categories.filter((c) => !c.hidden).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </SelectField>
      {category && (
        <BarChart name={`${category.name} by month`} labels={labels} short={short} series={[
          { label: 'Target', values: t.summaries.map((s) => s.categories.find((c) => c.categoryId === category.id)?.target ?? 0) },
          { label: 'Spent', values: t.summaries.map((s) => s.categories.find((c) => c.categoryId === category.id)?.spent ?? 0) },
        ]} />
      )}
      <BarChart name="Income planned and received" labels={labels} short={short} series={[
        { label: 'Planned', values: t.summaries.map((s) => s.plannedIncome) },
        { label: 'Received', values: t.summaries.map((s) => s.actualIncome) },
      ]} />
      <LineChart name="Balances over time" months={t.months} series={[
        { label: 'Investments', values: t.months.map((m) => t.balances.get(m)?.investments ?? 0) },
        { label: 'Emergency fund', values: t.months.map((m) => t.balances.get(m)?.emergency ?? 0) },
        { label: 'Debts', values: t.months.map((m) => debtsOf(t.balances.get(m) ?? {})) },
      ]} />
    </>
  );
}

function TrendsData() {
  const data = usePlanData();
  return data ? <TrendsBody data={data} /> : <p class="live" role="status">Loading…</p>;
}

/** `/budget/trends` (base §3.8): each pot and a chosen category across months, income planned and received, and the balances. */
export function Trends() {
  return <BudgetFrame title="Trends"><p class="plan-back no-print"><a href="#/budget">← Dashboard</a></p><TrendsData /></BudgetFrame>;
}

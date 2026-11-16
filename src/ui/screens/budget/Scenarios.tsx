import { useState } from 'preact/hooks';
import { useAppState } from '../../../app/AppState';
import { navigate, useRoute } from '../../../app/router';
import { createBudgetRecord } from '../../../db/budget';
import { Compare } from './Compare';
import { BudgetFrame } from './Frame';
import { TextField, useBusy, usePlanData } from './planKit';
import type { PlanData } from './planKit';
import { ScenarioEditor } from './ScenarioEditor';
import { MAX_COMPARED, MAX_SCENARIOS } from './scenarioView';

function ScenarioList({ data }: { data: PlanData }) {
  const { db } = useAppState();
  const [name, setName] = useState('');
  const [busy, run] = useBusy();
  const [picked, setPicked] = useState<string[] | undefined>(undefined);
  const scenarios = data.scenarios;
  const compared = (picked ?? scenarios.slice(0, MAX_COMPARED).map((s) => s.id)).filter((id) => scenarios.some((s) => s.id === id));
  const full = scenarios.length >= MAX_SCENARIOS;
  const toggle = (id: string) => setPicked(compared.includes(id) ? compared.filter((x) => x !== id) : [...compared, id].slice(-MAX_COMPARED));
  return (
    <>
      <p class="helper-text">A scenario is a set of changes on top of the plan. It never changes the plan until you apply it.</p>
      {scenarios.length === 0 ? <p class="empty">No scenarios yet.</p> : (
        <ul class="budget-list" aria-label="Scenarios">
          {scenarios.map((s) => (
            <li key={s.id} class="card budget-row">
              <div class="budget-row-head">
                <a class="budget-row-name" href={`#/budget/scenarios/${encodeURIComponent(s.id)}`}>{s.name}</a>
                <span class="budget-row-detail">{s.changes.length} change{s.changes.length === 1 ? '' : 's'}</span>
              </div>
              <label class="check">
                <input type="checkbox" checked={compared.includes(s.id)} onChange={() => toggle(s.id)} />
                Compare
              </label>
            </li>
          ))}
        </ul>
      )}
      <form class="budget-edit budget-section" aria-label="New scenario" onSubmit={(e) => {
        e.preventDefault();
        const text = name.trim();
        if (text === '' || full) return;
        run(() => createBudgetRecord(db, 'budgetScenarios', { name: text, changes: [] }).then((s) => navigate(`/budget/scenarios/${encodeURIComponent(s.id)}`)));
      }}>
        <TextField label="Scenario name" value={name} onInput={setName} maxLength={80}
          hint={full ? `Up to ${MAX_SCENARIOS} scenarios can be saved: delete one to add another.` : undefined} />
        <div class="row-actions"><button type="submit" class="btn btn-primary" disabled={busy || full || name.trim() === ''}>Add scenario</button></div>
      </form>
      {scenarios.length > 0 && <Compare data={data} scenarios={scenarios.filter((s) => compared.includes(s.id))} />}
    </>
  );
}

function ScenariosData() {
  const data = usePlanData();
  return data ? <ScenarioList data={data} /> : <p class="live" role="status">Loading…</p>;
}

/** `/budget/scenarios`: the scenarios and the compare; `/budget/scenarios/:id`: one scenario's changes. */
export function Scenarios() {
  const { params } = useRoute();
  if (params.id !== undefined) return <ScenarioEditor id={params.id} />;
  return <BudgetFrame title="Scenarios"><ScenariosData /></BudgetFrame>;
}

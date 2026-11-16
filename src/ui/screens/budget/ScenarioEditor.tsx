import { useMemo, useState } from 'preact/hooks';
import { useAppState } from '../../../app/AppState';
import { reportError } from '../../../app/errors';
import { navigate } from '../../../app/router';
import { POTS } from '../../../budget/catalog';
import { applyToPlan } from '../../../budget/scenarios';
import type { ScenarioChange } from '../../../budget/scenarioTypes';
import { applyPlanWrites, deleteBudgetRecord, updateBudgetRecord } from '../../../db/budget';
import { takeSnapshot } from '../../../db/snapshots';
import type { BudgetScenario, PotId } from '../../../domain/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { BudgetFrame } from './Frame';
import { AMOUNT_ERROR, budgetDataOf, RATE_ERROR, SelectField, TextField, typedMoney, typedRate, typedWhole, useBusy, usePlanData } from './planKit';
import type { PlanData } from './planKit';
import { Compare } from './Compare';
import { describeChange } from './scenarioView';

type Kind = ScenarioChange['kind'];
const KINDS: { id: Kind; label: string }[] = [
  { id: 'oneOff', label: 'One-off purchase or income' },
  { id: 'rotation', label: 'Rotation: contract or pattern' },
  { id: 'salary', label: 'Salary from a month on' },
  { id: 'extraDebt', label: 'Extra debt payment' },
  { id: 'investment', label: 'Investment contribution from a month on' },
  { id: 'rates', label: 'Expected return, withdrawal rate or inflation' },
  { id: 'potTarget', label: 'Pot target from a month on' },
];
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH_ERROR = 'Enter a month.';

/** The change the form's fields make, or the first thing wrong with them. */
function changeOf(kind: Kind, f: Record<string, string>, data: PlanData): ScenarioChange | { error: string } {
  const money = (key: string) => { const v = typedMoney(f[key] ?? ''); return typeof v === 'number' ? v : undefined; };
  const month = (key: string) => (YM.test(f[key] ?? '') ? f[key] : undefined);
  const pot = (f.pot ?? 'needs') as PotId;
  switch (kind) {
    case 'oneOff': {
      const amount = money('amount');
      if ((f.label ?? '').trim() === '') return { error: 'Say what it is, such as Car.' };
      if (month('ym') === undefined) return { error: MONTH_ERROR };
      if (amount === undefined || amount <= 0) return { error: AMOUNT_ERROR };
      return { kind, ym: f.ym, amount, label: f.label.trim(), ...(f.income === 'yes' ? { income: true } : { pot }) };
    }
    case 'salary': case 'investment': case 'potTarget': {
      const amount = money('amount');
      if (month('fromYm') === undefined) return { error: MONTH_ERROR };
      if (amount === undefined) return { error: AMOUNT_ERROR };
      if (kind === 'salary') return { kind, fromYm: f.fromYm, amount };
      if (kind === 'investment') return { kind, fromYm: f.fromYm, monthly: amount };
      return { kind, pot, fromYm: f.fromYm, amount };
    }
    case 'extraDebt': {
      const debtId = f.debtId ?? data.debts[0]?.id;
      if (debtId === undefined) return { error: 'There is no debt in the plan.' };
      const monthly = money('monthly');
      const lump = money('lump');
      if (lump !== undefined && lump > 0 && month('lumpYm') === undefined) return { error: MONTH_ERROR };
      if (!((monthly ?? 0) > 0 || (lump ?? 0) > 0)) return { error: 'Enter an extra each month, a lump sum, or both.' };
      return { kind, debtId, ...((monthly ?? 0) > 0 && { monthly }), ...((lump ?? 0) > 0 && { lump, lumpYm: f.lumpYm }) };
    }
    case 'rates': {
      const r = typedRate(f.ret ?? ''); const w = typedRate(f.withdrawal ?? ''); const i = typedRate(f.inflation ?? '');
      if (r === 'invalid' || w === 'invalid' || i === 'invalid' || w === 0) return { error: RATE_ERROR };
      if (r === undefined && w === undefined && i === undefined) return { error: 'Enter at least one rate.' };
      return { kind, ...(r !== undefined && { yearlyReturnPct: r }), ...(w !== undefined && { withdrawalRatePct: w }), ...(i !== undefined && { inflationPct: i }) };
    }
    case 'rotation': {
      const on = typedWhole(f.on ?? '', 1, 24); const off = typedWhole(f.off ?? '', 0, 24);
      if (typeof on !== 'number' || typeof off !== 'number') return { error: 'Enter months on from 1 to 24 and months off from 0 to 24.' };
      const periods = [...data.settings.rotation.periods].sort((a, b) => (a.signOn < b.signOn ? -1 : 1)).map(({ signOn, signOff }) => ({ signOn, signOff }));
      const last = periods[periods.length - 1];
      const signOn = f.signOn ?? ''; const signOff = f.signOff ?? '';
      const edited = signOn !== (last?.signOn ?? '') || signOff !== (last?.signOff ?? '');
      if (edited) {
        if (!DATE.test(signOn) || !DATE.test(signOff) || signOff < signOn) return { error: 'Enter a sign-on date and a later sign-off date.' };
        if (last) periods[periods.length - 1] = { signOn, signOff }; else periods.push({ signOn, signOff });
      }
      return { kind, patternOn: on, patternOff: off, ...(edited && { periods }) };
    }
  }
}

/** The fields each kind of change starts with. */
function startFields(kind: Kind, data: PlanData): Record<string, string> {
  if (kind === 'rotation') {
    const r = data.settings.rotation;
    const last = [...r.periods].sort((a, b) => (a.signOn < b.signOn ? -1 : 1)).pop();
    return { on: String(r.patternOn), off: String(r.patternOff), signOn: last?.signOn ?? '', signOff: last?.signOff ?? '' };
  }
  return kind === 'oneOff' || kind === 'potTarget' ? { pot: kind === 'oneOff' ? 'wants' : 'needs' } : {};
}

function ChangeForm({ data, onAdd }: { data: PlanData; onAdd: (c: ScenarioChange) => Promise<unknown> }) {
  const [kind, setKind] = useState<Kind>('oneOff');
  const [f, setF] = useState<Record<string, string>>(() => startFields('oneOff', data));
  const [error, setError] = useState('');
  const [busy, run] = useBusy();
  const set = (key: string) => (v: string) => { setF({ ...f, [key]: v }); setError(''); };
  const field = (key: string, label: string, opts: { type?: 'month' | 'date'; money?: boolean; rate?: boolean; hint?: string } = {}) => (
    <TextField label={label} value={f[key] ?? ''} onInput={set(key)} type={opts.type} inputMode={opts.money || opts.rate ? 'decimal' : undefined} hint={opts.hint} />
  );
  const potSelect = (
    <SelectField label="Pot" value={f.pot ?? 'needs'} onChange={set('pot')}>
      {POTS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
    </SelectField>
  );
  return (
    <form class="budget-edit card" aria-label="New change" onSubmit={(e) => {
      e.preventDefault();
      const c = changeOf(kind, f, data);
      if ('error' in c) { setError(c.error); return; }
      run(() => onAdd(c), () => setF(startFields(kind, data)));
    }}>
      <SelectField label="Kind of change" value={kind} onChange={(v) => { setKind(v as Kind); setF(startFields(v as Kind, data)); setError(''); }}>
        {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
      </SelectField>
      {kind === 'oneOff' && (
        <>
          {field('label', 'What')}
          {field('ym', 'Month', { type: 'month' })}
          {field('amount', 'Amount', { money: true })}
          <label class="check">
            <input type="checkbox" checked={f.income === 'yes'} onChange={(e) => set('income')(e.currentTarget.checked ? 'yes' : '')} />
            Income, not a purchase
          </label>
          {f.income !== 'yes' && potSelect}
        </>
      )}
      {kind === 'rotation' && (
        <>
          {field('on', 'Months on')}
          {field('off', 'Months off')}
          {field('signOn', 'Last contract sign-on', { type: 'date', hint: 'A longer or shorter contract, or a different start: change the last contract.' })}
          {field('signOff', 'Last contract sign-off', { type: 'date' })}
        </>
      )}
      {kind === 'salary' && <>{field('fromYm', 'From month', { type: 'month' })}{field('amount', 'Monthly salary', { money: true })}</>}
      {kind === 'investment' && <>{field('fromYm', 'From month', { type: 'month' })}{field('amount', 'Each month', { money: true })}</>}
      {kind === 'potTarget' && <>{potSelect}{field('fromYm', 'From month', { type: 'month' })}{field('amount', 'Amount a month', { money: true })}</>}
      {kind === 'extraDebt' && (data.debts.length === 0 ? <p class="empty">There is no debt in the plan.</p> : (
        <>
          <SelectField label="Debt" value={f.debtId ?? data.debts[0].id} onChange={set('debtId')}>
            {data.debts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </SelectField>
          {field('monthly', 'Extra each month', { money: true })}
          {field('lump', 'Lump sum', { money: true })}
          {field('lumpYm', 'Lump sum month', { type: 'month' })}
        </>
      ))}
      {kind === 'rates' && (
        <>
          {field('ret', 'Expected yearly return (%)', { rate: true })}
          {field('withdrawal', 'Withdrawal rate (%)', { rate: true, hint: 'an assumption, not advice' })}
          {field('inflation', 'Inflation (% a year)', { rate: true, hint: 'Yearly spending grows smoothly through the year at this rate (compounded monthly).' })}
        </>
      )}
      {error !== '' && <p class="field-error" role="alert">{error}</p>}
      <div class="row-actions"><button type="submit" class="btn btn-primary btn-small" disabled={busy}>Add change</button></div>
    </form>
  );
}

function ApplyDialog({ data, scenario, onDone, onCancel }: { data: PlanData; scenario: BudgetScenario; onDone: () => void; onCancel: () => void }) {
  const { db, shipToday } = useAppState();
  const [busy, setBusy] = useState(false);
  // Worked out once, when the dialog opens: what is listed is what is written.
  const [plan] = useState(() => applyToPlan(budgetDataOf(data), data.settings, scenario, shipToday));
  return (
    <ConfirmDialog
      title={`Apply ${scenario.name} to the plan?`} confirmLabel="Apply" busy={busy} onCancel={onCancel}
      onConfirm={() => {
        setBusy(true);
        takeSnapshot(db, 'manual', `Before applying the scenario ${scenario.name}`)
          .then(() => applyPlanWrites(db, plan.writes))
          .then(onDone, (e) => { setBusy(false); reportError(e); });
      }}
      body={(
        <>
          <p>These changes are written to the plan:</p>
          <ul class="budget-lines">{plan.summary.filter((l) => l !== '').map((l, i) => <li key={i}>{l}</li>)}</ul>
          <p class="helper-text">A snapshot is taken first, so the plan as it is now can be restored from Settings.</p>
        </>
      )}
    />
  );
}

function EditorBody({ data, scenario }: { data: PlanData; scenario: BudgetScenario }) {
  const { db } = useAppState();
  const [name, setName] = useState(scenario.name);
  const [applying, setApplying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, run] = useBusy();
  const save = (changes: ScenarioChange[]) => updateBudgetRecord(db, 'budgetScenarios', scenario.id, { changes }).then(() => setStatus(''));
  const compared = useMemo(() => [scenario], [scenario]);
  return (
    <>
      <section class="budget-section" aria-label="Changes">
        <h3>Changes</h3>
        {scenario.changes.length === 0 ? <p class="empty">No changes yet: add the first below.</p> : (
          <ul class="budget-list" aria-label="Changes">
            {scenario.changes.map((c, i) => (
              <li key={i} class="card scenario-change">
                <span class="budget-row-name">{describeChange(c, data.debts)}</span>
                <button type="button" class="btn btn-outline btn-small" disabled={busy}
                  onClick={() => run(() => save(scenario.changes.filter((_, k) => k !== i)))}>Remove</button>
              </li>
            ))}
          </ul>
        )}
        <ChangeForm data={data} onAdd={(c) => save([...scenario.changes, c])} />
      </section>

      <div class="row-actions budget-section no-print">
        <button type="button" class="btn btn-primary" disabled={scenario.changes.length === 0} onClick={() => setApplying(true)}>Apply to plan</button>
      </div>
      <p class="live" role="status">{status}</p>

      <Compare data={data} scenarios={compared} />

      <form class="budget-edit budget-section" aria-label="Rename scenario" onSubmit={(e) => {
        e.preventDefault();
        if (name.trim() !== '') run(() => updateBudgetRecord(db, 'budgetScenarios', scenario.id, { name: name.trim() }));
      }}>
        <TextField label="Name" value={name} onInput={setName} maxLength={80} />
        <div class="row-actions">
          <button type="submit" class="btn btn-outline btn-small" disabled={busy || name.trim() === '' || name.trim() === scenario.name}>Save name</button>
          <button type="button" class="btn btn-outline btn-small" onClick={() => setDeleting(true)}>Delete scenario</button>
        </div>
      </form>

      {applying && (
        <ApplyDialog data={data} scenario={scenario} onCancel={() => setApplying(false)}
          onDone={() => { setApplying(false); setStatus(`${scenario.name} is in the plan. A snapshot was taken first.`); }} />
      )}
      {deleting && (
        <ConfirmDialog title={`Delete ${scenario.name}?`} confirmLabel="Delete" danger body={<p>The scenario is deleted. The plan does not change.</p>}
          onCancel={() => setDeleting(false)}
          onConfirm={() => { setDeleting(false); deleteBudgetRecord(db, 'budgetScenarios', scenario.id).then(() => navigate('/budget/scenarios'), reportError); }} />
      )}
    </>
  );
}

function EditorData({ id }: { id: string }) {
  const data = usePlanData();
  if (!data) return <p class="live" role="status">Loading…</p>;
  const scenario = data.scenarios.find((s) => s.id === id);
  if (!scenario) return <p class="empty">There is no such scenario.</p>;
  return <EditorBody key={scenario.id} data={data} scenario={scenario} />;
}

/** `/budget/scenarios/:id` (v2 §3.5): a scenario's changes, an editor for each kind, its compare with the base plan, and Apply to plan. */
export function ScenarioEditor({ id }: { id: string }) {
  const data = usePlanData();
  const title = data?.scenarios.find((s) => s.id === id)?.name ?? 'Scenario';
  return (
    <BudgetFrame title={title}>
      <p class="plan-back no-print"><a href="#/budget/scenarios">← Scenarios</a></p>
      <EditorData id={id} />
    </BudgetFrame>
  );
}

import { useState } from 'preact/hooks';
import { useAppState } from '../../../app/AppState';
import { goalPlannedMonthly } from '../../../budget/alerts';
import { POTS } from '../../../budget/catalog';
import { averageMonthlyNeeds, emergencyOutlook, goalProgress } from '../../../budget/goals';
import { formatMoney } from '../../../budget/money';
import { monthLabel } from '../../../budget/months';
import { effectiveMonth, potTargetAmount } from '../../../budget/targets';
import { createBudgetRecord, deleteBudgetRecord, updateBudgetRecord } from '../../../db/budget';
import type { BudgetFields } from '../../../db/budget';
import type { BudgetGoal } from '../../../domain/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useCurrentYm } from './Frame';
import { AMOUNT_ERROR, SelectField, TextField, balancesAt, inputText, typedMoney, useBusy } from './planKit';
import type { PlanData } from './planKit';

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;

function GoalForm({ data, goal, label, submit, onDone }: { data: PlanData; goal?: BudgetGoal; label: string; submit: string; onDone?: () => void }) {
  const { db } = useAppState();
  const shown = data.categories.filter((c) => !c.hidden || c.id === goal?.categoryId);
  const [name, setName] = useState(goal?.name ?? '');
  const [amount, setAmount] = useState(inputText(goal?.amount));
  const [targetYm, setTargetYm] = useState(goal?.targetYm ?? '');
  const [categoryId, setCategoryId] = useState(goal?.categoryId ?? '');
  const [busy, run] = useBusy();
  const cents = typedMoney(amount);
  const ok = name.trim() !== '' && typeof cents === 'number' && cents > 0 && YM.test(targetYm);
  const save = () => {
    if (!ok) return;
    const fields: BudgetFields<'budgetGoals'> = { name: name.trim(), amount: cents as number, targetYm, ...(categoryId !== '' && { categoryId }) };
    if (goal) run(() => updateBudgetRecord(db, 'budgetGoals', goal.id, { categoryId: undefined, ...fields }), onDone);
    else run(() => createBudgetRecord(db, 'budgetGoals', fields), () => { setName(''); setAmount(''); setTargetYm(''); });
  };
  return (
    <form class="card budget-edit" aria-label={label} onSubmit={(e) => { e.preventDefault(); save(); }}>
      {!goal && <h3>New goal</h3>}
      <TextField label="Name" value={name} onInput={setName} />
      <TextField label="Amount" value={amount} onInput={setAmount} inputMode="decimal" error={cents === 'invalid' ? AMOUNT_ERROR : undefined} />
      <TextField label="Target month" type="month" value={targetYm} onInput={setTargetYm} />
      <SelectField label="Category" value={categoryId} onChange={setCategoryId} hint="What you put towards the goal is entered in it.">
        <option value="">—</option>
        {POTS.map((p) => (
          <optgroup key={p.id} label={p.label}>
            {shown.filter((c) => c.pot === p.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </optgroup>
        ))}
      </SelectField>
      <div class="row-actions">
        <button type="submit" class="btn btn-primary btn-small" disabled={busy || !ok}>{submit}</button>
        {onDone && <button type="button" class="btn btn-outline btn-small" onClick={onDone}>Cancel</button>}
      </div>
    </form>
  );
}

function GoalRow({ goal, data, onDelete }: { goal: BudgetGoal; data: PlanData; onDelete: () => void }) {
  const currentYm = useCurrentYm();
  const [editing, setEditing] = useState(false);
  if (editing) return <li class="budget-row"><GoalForm data={data} goal={goal} label={`Edit ${goal.name}`} submit="Save" onDone={() => setEditing(false)} /></li>;
  // What the plan puts towards it each month: its category's target, and the templates paying into that category.
  const plan = effectiveMonth(data.months, currentYm);
  const p = goalProgress(goal, data.entries, currentYm, goalPlannedMonthly(goal, plan, data.recurring, currentYm));
  const category = data.categories.find((c) => c.id === goal.categoryId)?.name;
  return (
    <li class="card budget-row">
      <div class="budget-row-head">
        <span class="budget-row-name">{goal.name}</span>
        <span class="budget-amount">{formatMoney(goal.amount)}</span>
      </div>
      <span class="budget-row-detail">By {monthLabel(goal.targetYm)}{category ? ` · ${category}` : ' · no category, so nothing is counted as saved'}</span>
      <span class="budget-row-detail">Saved {formatMoney(p.saved)} of {formatMoney(goal.amount)} ({p.progressPct}%)</span>
      {p.remaining > 0 ? <p class="budget-debt-free">Suggested {formatMoney(p.suggestedMonthly)} a month</p> : <p class="budget-debt-free">Reached.</p>}
      {p.behind && <span class="badge band-badge" data-band="amber">Behind plan</span>}
      <div class="row-actions">
        <button type="button" class="btn btn-outline btn-small" onClick={() => setEditing(true)}>Edit</button>
        <button type="button" class="btn btn-outline btn-small" onClick={onDelete}>Delete</button>
      </div>
    </li>
  );
}

/** The emergency fund against its target: N × the average monthly Needs (N in Assumptions). */
function EmergencyTarget({ data }: { data: PlanData }) {
  const currentYm = useCurrentYm();
  const months = data.settings.assumptions.emergencyMonths;
  const average = averageMonthlyNeeds(data.entries, data.categories, currentYm);
  const target = average * months;
  const balance = balancesAt(data, currentYm).emergency;
  const plan = effectiveMonth(data.months, currentYm);
  // The current contribution: the Emergency fund pot target, else the templates paying into an Emergency fund category.
  const emergencyCategories = new Set(data.categories.filter((c) => c.pot === 'emergency').map((c) => c.id));
  const templates = data.recurring.filter((t) => t.incomeSource === undefined && t.categoryId !== undefined && emergencyCategories.has(t.categoryId)
    && t.startYm <= currentYm && (t.endYm === undefined || t.endYm >= currentYm)).reduce((sum, t) => sum + t.amount, 0);
  const contribution = Math.max(potTargetAmount(plan.potTargets.emergency, plan.plannedIncome ?? 0), templates);
  const outlook = emergencyOutlook({ balance, target, monthlyContribution: contribution, ym: currentYm });
  return (
    <section class="card budget-row budget-section" aria-label="Emergency fund target">
      <h3>Emergency fund target</h3>
      <span class="budget-row-detail">{months} × average monthly Needs ({formatMoney(average)}, the last 6 tracked months) · <a href="#/budget/plan/assumptions">Change N</a></span>
      <p class="budget-row-name">{formatMoney(balance)} of {formatMoney(target)} ({outlook.progressPct}%)</p>
      <span class="budget-row-detail">
        {target === 0 ? 'The target is worked out once Needs spending is tracked.'
          : outlook.reachedYm === undefined ? 'Set an Emergency fund target to see when it is reached.'
            : outlook.reachedYm < currentYm ? 'Reached.' : `Reached in ${monthLabel(outlook.reachedYm)} at ${formatMoney(contribution)} a month`}
      </span>
    </section>
  );
}

/**
 * Plan → Goals (base §3.7): savings goals, each with what is saved so far, the progress and the suggested monthly amount
 * (amber when the plan will not make it), and the emergency fund target.
 */
export function PlanGoals({ data }: { data: PlanData }) {
  const { db } = useAppState();
  const [deleting, setDeleting] = useState<BudgetGoal>();
  const [, run] = useBusy();
  const goals = [...data.goals].sort((a, b) => (a.targetYm < b.targetYm ? -1 : a.targetYm > b.targetYm ? 1 : a.name.localeCompare(b.name)));
  return (
    <>
      <EmergencyTarget data={data} />
      <GoalForm data={data} label="New goal" submit="Add goal" />
      <section class="budget-section" aria-label="Savings goals">
        <h3>Savings goals</h3>
        {goals.length === 0 ? <p class="empty">No goals yet.</p> : (
          <ul class="budget-list" aria-label="Goals">
            {goals.map((g) => <GoalRow key={g.id} goal={g} data={data} onDelete={() => setDeleting(g)} />)}
          </ul>
        )}
      </section>
      {deleting && (
        <ConfirmDialog
          title="Delete goal?" confirmLabel="Delete" danger body={<p>{deleting.name} is no longer in the plan. What you saved stays.</p>}
          onCancel={() => setDeleting(undefined)}
          onConfirm={() => { const id = deleting.id; setDeleting(undefined); run(() => deleteBudgetRecord(db, 'budgetGoals', id)); }}
        />
      )}
    </>
  );
}

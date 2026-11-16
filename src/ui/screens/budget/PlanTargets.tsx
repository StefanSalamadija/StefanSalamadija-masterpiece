import { useState } from 'preact/hooks';
import { useAppState } from '../../../app/AppState';
import { POTS } from '../../../budget/catalog';
import { formatMoney } from '../../../budget/money';
import { summariseMonth, targetsWarning } from '../../../budget/month';
import { addMonths, monthLabel } from '../../../budget/months';
import { editOrigin, effectiveMonth, setCategoryTarget, setPlannedIncome, setPotTarget } from '../../../budget/targets';
import type { MonthChanges, PlanScope, Planned } from '../../../budget/targets';
import type { BudgetMonth, Cents, PlanEdit, PotTarget, Ym } from '../../../domain/types';
import { useCurrentYm } from './Frame';
import { AMOUNT_ERROR, RATE_ERROR, ScopeDialog, SelectField, TextField, inputText, saveMonthChanges, typedMoney, typedRate, useBusy } from './planKit';
import type { PlanData } from './planKit';

/** Where a value comes from, as the screen says it. */
function originText<V>(months: BudgetMonth[], ym: Ym, read: (m: BudgetMonth) => PlanEdit<V> | undefined): string {
  const origin = editOrigin(months, ym, read);
  if (!origin) return 'Not set';
  return origin.scope === 'this' ? 'This month only' : `From ${monthLabel(origin.ym)}`;
}

/** A change waiting for the "This month only" / "From this month on" answer. */
interface Pending { title: string; changes: (scope: PlanScope) => MonthChanges }

function PotRow({ label, target, plannedIncome, origin, onSave }: {
  label: string; target?: Planned<PotTarget>; plannedIncome: Cents; origin: string; onSave: (t: PotTarget) => void;
}) {
  const [kind, setKind] = useState<PotTarget['kind']>(target?.kind ?? 'pct');
  const [text, setText] = useState(target === undefined ? '' : target.kind === 'pct' ? String(target.value).replace('.', ',') : inputText(target.value));
  const value = kind === 'pct' ? typedRate(text) : typedMoney(text);
  const valid = typeof value === 'number';
  let other = '';
  if (valid && plannedIncome > 0) {
    other = kind === 'pct'
      ? `= ${formatMoney(Math.round((plannedIncome * value) / 100))}`
      : `= ${Math.round((value / plannedIncome) * 10000) / 100}% of income`;
  }
  return (
    <section class="card budget-row" aria-label={label}>
      <h4 class="budget-row-name">{label}</h4>
      <SelectField label={`${label} target as`} value={kind} onChange={(v) => setKind(v as PotTarget['kind'])}>
        <option value="pct">% of planned income</option>
        <option value="amount">Amount</option>
      </SelectField>
      <TextField
        label={`${label} target`} value={text} onInput={setText} inputMode="decimal"
        error={value === 'invalid' ? (kind === 'pct' ? RATE_ERROR : AMOUNT_ERROR) : undefined}
      />
      <p class="budget-row-detail">{[other, origin].filter(Boolean).join(' · ')}</p>
      <div class="row-actions">
        <button type="button" class="btn btn-primary btn-small" disabled={!valid}
          onClick={() => { if (valid) onSave({ kind, value }); }}>Save</button>
      </div>
    </section>
  );
}

function CategoryTargetForm({ data, onSave }: { data: PlanData; onSave: (categoryId: string, amount: Cents | undefined) => void }) {
  const shown = data.categories.filter((c) => !c.hidden);
  const [categoryId, setCategoryId] = useState(shown[0]?.id ?? '');
  const [text, setText] = useState('');
  const amount = typedMoney(text);
  return (
    <form class="card budget-edit" aria-label="Category target" onSubmit={(e) => {
      e.preventDefault();
      if (categoryId !== '' && amount !== 'invalid') onSave(categoryId, amount);
    }}>
      <SelectField label="Category" value={categoryId} onChange={setCategoryId}>
        {POTS.map((p) => (
          <optgroup key={p.id} label={p.label}>
            {shown.filter((c) => c.pot === p.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </optgroup>
        ))}
      </SelectField>
      <TextField label="Monthly target" value={text} onInput={setText} inputMode="decimal" hint="Leave it empty to remove the target."
        error={amount === 'invalid' ? AMOUNT_ERROR : undefined} />
      <div class="row-actions">
        <button type="submit" class="btn btn-primary btn-small" disabled={categoryId === '' || amount === 'invalid'}>Save</button>
      </div>
    </form>
  );
}

/**
 * Plan → Targets (base §3.1–§3.3): a month's planned income, each pot's target (a % of planned income or an amount,
 * the other one shown) and the category targets. Every save asks "This month only" or "From this month on".
 */
export function PlanTargets({ data }: { data: PlanData }) {
  const { db } = useAppState();
  const currentYm = useCurrentYm();
  const [ym, setYm] = useState(currentYm);
  const [pending, setPending] = useState<Pending>();
  const [incomeText, setIncomeText] = useState<string>();
  const [, run] = useBusy();

  const plan = effectiveMonth(data.months, ym);
  const plannedIncome = plan.plannedIncome ?? 0;
  const summary = summariseMonth({ month: plan, entries: [], categories: data.categories, fundMoves: [], funds: [] });
  const warning = targetsWarning(summary.targetsPctTotal);
  const income = incomeText ?? inputText(plan.plannedIncome);
  const incomeValue = typedMoney(income);
  const categoryName = new Map(data.categories.map((c) => [c.id, c.name]));
  const go = (n: number) => { setYm(addMonths(ym, n)); setIncomeText(undefined); };

  const ask = (title: string, changes: (scope: PlanScope) => MonthChanges) => setPending({ title, changes });

  return (
    <>
      <div class="budget-months">
        <button type="button" class="btn btn-outline btn-small" onClick={() => go(-1)}>← Previous month</button>
        <button type="button" class="btn btn-outline btn-small" onClick={() => go(1)}>Next month →</button>
      </div>
      <h3 class="plan-month">{monthLabel(ym)}</h3>
      {warning && <p class="field-warning budget-warning">{warning}</p>}

      <form class="budget-edit plan-income" onSubmit={(e) => {
        e.preventDefault();
        if (incomeValue !== 'invalid') ask('Change planned income', (scope) => setPlannedIncome(data.months, ym, incomeValue, scope));
      }}>
        <TextField label="Planned income" value={income} onInput={setIncomeText} inputMode="decimal"
          hint={originText(data.months, ym, (m) => m.plannedIncome)} error={incomeValue === 'invalid' ? AMOUNT_ERROR : undefined} />
        <div class="row-actions">
          <button type="submit" class="btn btn-primary btn-small" disabled={incomeValue === 'invalid'}>Save planned income</button>
        </div>
      </form>

      <section class="budget-section" aria-label="Pot targets">
        <h3>Pots</h3>
        <div class="budget-pots">
          {POTS.map((p) => {
            const target = plan.potTargets[p.id];
            return (
              <PotRow
                key={`${ym}:${p.id}:${JSON.stringify(target)}`} label={p.label} target={target} plannedIncome={plannedIncome}
                origin={originText(data.months, ym, (m) => m.potTargets[p.id])}
                onSave={(t) => ask(`Change the ${p.label} target`, (scope) => setPotTarget(data.months, ym, p.id, t, scope))}
              />
            );
          })}
        </div>
      </section>

      <section class="budget-section" aria-label="Category targets">
        <h3>Category targets</h3>
        <CategoryTargetForm key={ym} data={data} onSave={(id, amount) =>
          ask(`Change the ${categoryName.get(id) ?? 'category'} target`, (scope) => setCategoryTarget(data.months, ym, id, amount, scope))} />
        {Object.keys(plan.categoryTargets).length === 0 ? <p class="empty">No category targets in {monthLabel(ym)}.</p> : (
          <ul class="budget-list" aria-label="Category targets">
            {Object.entries(plan.categoryTargets).map(([id, t]) => (
              <li key={id} class="card budget-row">
                <div class="budget-row-head">
                  <span class="budget-row-name">{categoryName.get(id) ?? 'Deleted category'}</span>
                  <span class="budget-amount">{formatMoney(t.amount)}</span>
                </div>
                <span class="budget-row-detail">{originText(data.months, ym, (m) => m.categoryTargets[id])}</span>
                <div class="row-actions">
                  <button type="button" class="btn btn-outline btn-small"
                    onClick={() => ask(`Remove the ${categoryName.get(id) ?? 'category'} target`, (scope) => setCategoryTarget(data.months, ym, id, undefined, scope))}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {pending && (
        <ScopeDialog
          title={pending.title} onCancel={() => setPending(undefined)}
          onChoose={(scope) => {
            const changes = pending.changes(scope);
            setPending(undefined);
            run(() => saveMonthChanges(db, changes), () => setIncomeText(undefined));
          }}
        />
      )}
    </>
  );
}

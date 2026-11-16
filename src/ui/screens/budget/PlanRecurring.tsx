import { useState } from 'preact/hooks';
import { useAppState } from '../../../app/AppState';
import { POTS } from '../../../budget/catalog';
import { formatMoney } from '../../../budget/money';
import { monthLabel } from '../../../budget/months';
import { createBudgetRecord, deleteBudgetRecord, updateBudgetRecord } from '../../../db/budget';
import type { BudgetFields } from '../../../db/budget';
import type { BudgetCategory, BudgetRecurring, IncomeSource } from '../../../domain/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useCurrentYm } from './Frame';
import { AMOUNT_ERROR, SelectField, TextField, inputText, typedMoney, typedWhole, useBusy } from './planKit';
import type { PlanData } from './planKit';
import { INCOME_SOURCES } from './quickAddView';

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;

/** What a template pays or brings, as its row says it. */
function sourceText(t: BudgetRecurring, categories: BudgetCategory[], data: PlanData): string {
  const what = t.incomeSource !== undefined
    ? `Income · ${INCOME_SOURCES.find((s) => s.id === t.incomeSource)?.label ?? 'Other'}`
    : categories.find((c) => c.id === t.categoryId)?.name ?? 'No category';
  const until = t.untilDebtId !== undefined ? ` until ${data.debts.find((d) => d.id === t.untilDebtId)?.name ?? 'the debt'} is paid` : '';
  const span = `from ${monthLabel(t.startYm)}${t.endYm !== undefined ? ` to ${monthLabel(t.endYm)}` : ''}${until}`;
  return `${what} · day ${t.day} · ${span}`;
}

/** The template form, for a new one or to change one. */
function TemplateForm({ data, template, label, submit, onDone }: {
  data: PlanData; template?: BudgetRecurring; label: string; submit: string; onDone?: () => void;
}) {
  const { db } = useAppState();
  const currentYm = useCurrentYm();
  const shown = data.categories.filter((c) => !c.hidden || c.id === template?.categoryId);
  const [kind, setKind] = useState<'expense' | 'income'>(template?.incomeSource !== undefined ? 'income' : 'expense');
  const [name, setName] = useState(template?.name ?? '');
  const [amount, setAmount] = useState(inputText(template?.amount));
  const [categoryId, setCategoryId] = useState(template?.categoryId ?? shown[0]?.id ?? '');
  const [source, setSource] = useState<IncomeSource>(template?.incomeSource ?? 'salary');
  const [day, setDay] = useState(String(template?.day ?? 1));
  const [startYm, setStartYm] = useState(template?.startYm ?? currentYm);
  const [endYm, setEndYm] = useState(template?.endYm ?? '');
  const [untilDebtId, setUntilDebtId] = useState(template?.untilDebtId ?? '');
  const [busy, run] = useBusy();

  const cents = typedMoney(amount);
  const dayValue = typedWhole(day, 1, 31);
  const endOk = endYm === '' || (YM.test(endYm) && endYm >= startYm);
  const ok = name.trim() !== '' && typeof cents === 'number' && cents > 0 && typeof dayValue === 'number' && YM.test(startYm) && endOk
    && (kind === 'income' || categoryId !== '');

  const save = () => {
    if (!ok) return;
    const fields: BudgetFields<'budgetRecurring'> = {
      name: name.trim(), amount: cents as number, day: dayValue as number, startYm,
      ...(endYm !== '' && { endYm }),
      ...(kind === 'income' ? { incomeSource: source } : { categoryId, ...(untilDebtId !== '' && { untilDebtId }) }),
    };
    if (template) {
      // A field left out is removed, so that a template turned from expense to income loses its category, say.
      const patch = { categoryId: undefined, incomeSource: undefined, endYm: undefined, untilDebtId: undefined, ...fields };
      run(() => updateBudgetRecord(db, 'budgetRecurring', template.id, patch), onDone);
    } else {
      run(() => createBudgetRecord(db, 'budgetRecurring', fields), () => { setName(''); setAmount(''); setEndYm(''); setUntilDebtId(''); });
    }
  };

  return (
    <form class="card budget-edit" aria-label={label} onSubmit={(e) => { e.preventDefault(); save(); }}>
      {!template && <h3>New template</h3>}
      <SelectField label="Type" value={kind} onChange={(v) => setKind(v as 'expense' | 'income')}>
        <option value="expense">Payment</option>
        <option value="income">Income</option>
      </SelectField>
      <TextField label="Name" value={name} onInput={setName} />
      <TextField label="Amount" value={amount} onInput={setAmount} inputMode="decimal" error={cents === 'invalid' ? AMOUNT_ERROR : undefined} />
      {kind === 'expense' ? (
        <SelectField label="Category" value={categoryId} onChange={setCategoryId}>
          {POTS.map((p) => (
            <optgroup key={p.id} label={p.label}>
              {shown.filter((c) => c.pot === p.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
          ))}
        </SelectField>
      ) : (
        <SelectField label="Source" value={source} onChange={(v) => setSource(v as IncomeSource)}>
          {INCOME_SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </SelectField>
      )}
      <TextField label="Day of the month" value={day} onInput={setDay} inputMode="numeric"
        error={dayValue === 'invalid' ? 'Enter a day from 1 to 31.' : undefined} hint="A shorter month uses its last day." />
      <TextField label="Start month" type="month" value={startYm} onInput={setStartYm} />
      <TextField label="End month" type="month" value={endYm} onInput={setEndYm} hint="Optional."
        error={endOk ? undefined : 'The end month cannot be before the start month.'} />
      {kind === 'expense' && data.debts.length > 0 && (
        <SelectField label="Until this debt is paid" value={untilDebtId} onChange={setUntilDebtId}>
          <option value="">—</option>
          {data.debts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </SelectField>
      )}
      <div class="row-actions">
        <button type="submit" class="btn btn-primary btn-small" disabled={busy || !ok}>{submit}</button>
        {onDone && <button type="button" class="btn btn-outline btn-small" onClick={onDone}>Cancel</button>}
      </div>
    </form>
  );
}

function TemplateRow({ template, data, onDelete }: { template: BudgetRecurring; data: PlanData; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <li class="budget-row">
        <TemplateForm data={data} template={template} label={`Edit ${template.name}`} submit="Save" onDone={() => setEditing(false)} />
      </li>
    );
  }
  return (
    <li class="card budget-row">
      <div class="budget-row-head">
        <span class="budget-row-name">{template.name}</span>
        <span class="budget-amount">{template.incomeSource !== undefined ? '+' : ''}{formatMoney(template.amount)}</span>
      </div>
      <span class="budget-row-detail">{sourceText(template, data.categories, data)}</span>
      <div class="row-actions">
        <button type="button" class="btn btn-outline btn-small" onClick={() => setEditing(true)}>Edit</button>
        <button type="button" class="btn btn-outline btn-small" onClick={onDelete}>Delete</button>
      </div>
    </li>
  );
}

/**
 * Plan → Recurring (base §3.5): templates that repeat every month on a day, from a start month to an optional end month
 * (or until a debt is paid). Each month they make a planned item to confirm when the month is opened. A change affects
 * the months still to be made; the items already made stay as they are.
 */
export function PlanRecurring({ data }: { data: PlanData }) {
  const { db } = useAppState();
  const [deleting, setDeleting] = useState<BudgetRecurring>();
  const [, run] = useBusy();
  const templates = [...data.recurring].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <TemplateForm data={data} label="New template" submit="Add template" />
      <section class="budget-section" aria-label="Recurring templates">
        <h3>Templates</h3>
        {templates.length === 0 ? <p class="empty">No templates yet.</p> : (
          <ul class="budget-list" aria-label="Templates">
            {templates.map((t) => <TemplateRow key={t.id} template={t} data={data} onDelete={() => setDeleting(t)} />)}
          </ul>
        )}
      </section>
      {deleting && (
        <ConfirmDialog
          title="Delete template?" confirmLabel="Delete" danger
          body={<p>{deleting.name} makes no more planned items. The ones already made stay.</p>}
          onCancel={() => setDeleting(undefined)}
          onConfirm={() => { const id = deleting.id; setDeleting(undefined); run(() => deleteBudgetRecord(db, 'budgetRecurring', id)); }}
        />
      )}
    </>
  );
}

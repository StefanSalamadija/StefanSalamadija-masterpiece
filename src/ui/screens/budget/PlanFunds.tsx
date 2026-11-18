import { useState } from 'preact/hooks';
import { useAppState } from '../../../app/AppState';
import { POTS } from '../../../budget/catalog';
import { fundStatus } from '../../../budget/funds';
import { formatMoney } from '../../../budget/money';
import { monthLabel } from '../../../budget/months';
import { createBudgetRecord, deleteBudgetRecord, updateBudgetRecord } from '../../../db/budget';
import type { BudgetFields } from '../../../db/budget';
import type { BudgetFund } from '../../../domain/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useCurrentYm } from './Frame';
import { AMOUNT_ERROR, SelectField, TextField, inputText, typedMoney, typedWhole, useBusy } from './planKit';
import type { PlanData } from './planKit';

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;

type Repeat = 'once' | 'yearly' | 'months';

function repeatText(fund: BudgetFund): string {
  if (fund.repeatMonths === undefined) return 'Once';
  return fund.repeatMonths === 12 ? 'Every year' : `Every ${fund.repeatMonths} months`;
}

function FundForm({ data, fund, label, submit, onDone }: { data: PlanData; fund?: BudgetFund; label: string; submit: string; onDone?: () => void }) {
  const { db } = useAppState();
  const currentYm = useCurrentYm();
  const shown = data.categories.filter((c) => !c.hidden || c.id === fund?.categoryId);
  const [name, setName] = useState(fund?.name ?? '');
  const [amount, setAmount] = useState(inputText(fund?.amount));
  const [dueYm, setDueYm] = useState(fund?.dueYm ?? '');
  const [repeat, setRepeat] = useState<Repeat>(fund?.repeatMonths === undefined ? 'once' : fund.repeatMonths === 12 ? 'yearly' : 'months');
  const [every, setEvery] = useState(String(fund?.repeatMonths ?? 6));
  const [categoryId, setCategoryId] = useState(fund?.categoryId ?? '');
  const [start, setStart] = useState(fund ? inputText(fund.startBalance) : '');
  const [busy, run] = useBusy();

  const cents = typedMoney(amount);
  const startCents = typedMoney(start);
  const everyValue = typedWhole(every, 1, 120);
  const ok = name.trim() !== '' && typeof cents === 'number' && cents > 0 && YM.test(dueYm) && startCents !== 'invalid'
    && (repeat !== 'months' || typeof everyValue === 'number');

  const save = () => {
    if (!ok) return;
    const repeatMonths = repeat === 'yearly' ? 12 : repeat === 'months' ? everyValue as number : undefined;
    const fields: BudgetFields<'budgetFunds'> = {
      name: name.trim(), amount: cents as number, dueYm, startBalance: startCents ?? 0,
      ...(repeatMonths !== undefined && { repeatMonths }), ...(categoryId !== '' && { categoryId }),
    };
    if (fund) run(() => updateBudgetRecord(db, 'budgetFunds', fund.id, { repeatMonths: undefined, categoryId: undefined, ...fields }), onDone);
    else run(() => createBudgetRecord(db, 'budgetFunds', fields), () => { setName(''); setAmount(''); setDueYm(''); setStart(''); });
  };

  return (
    <form class="card budget-edit" aria-label={label} onSubmit={(e) => { e.preventDefault(); save(); }}>
      {!fund && <h3>New fund</h3>}
      <TextField label="Name" value={name} onInput={setName} hint={fund ? undefined : 'Such as car registration, home insurance or Christmas.'} />
      <TextField label="Amount" value={amount} onInput={setAmount} inputMode="decimal" error={cents === 'invalid' ? AMOUNT_ERROR : undefined} />
      <TextField label="Due month" type="month" value={dueYm} onInput={setDueYm} hint={dueYm === '' ? `Such as ${monthLabel(currentYm)}.` : undefined} />
      <SelectField label="Repeats" value={repeat} onChange={(v) => setRepeat(v as Repeat)}>
        <option value="once">Once</option>
        <option value="yearly">Every year</option>
        <option value="months">Every few months</option>
      </SelectField>
      {repeat === 'months' && (
        <TextField label="Every (months)" value={every} onInput={setEvery} inputMode="numeric"
          error={everyValue === 'invalid' ? 'Enter a number of months from 1 to 120.' : undefined} />
      )}
      <SelectField label="Category" value={categoryId} onChange={setCategoryId} hint="The bill is booked to it when it is paid, and the set-asides count in its pot.">
        <option value="">—</option>
        {POTS.map((p) => (
          <optgroup key={p.id} label={p.label}>
            {shown.filter((c) => c.pot === p.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </optgroup>
        ))}
      </SelectField>
      <TextField label="Start balance" value={start} onInput={setStart} inputMode="decimal" hint="What is in it already (optional)."
        error={startCents === 'invalid' ? AMOUNT_ERROR : undefined} />
      <div class="row-actions">
        <button type="submit" class="btn btn-primary btn-small" disabled={busy || !ok}>{submit}</button>
        {onDone && <button type="button" class="btn btn-outline btn-small" onClick={onDone}>Cancel</button>}
      </div>
    </form>
  );
}

function FundRow({ fund, data, onDelete }: { fund: BudgetFund; data: PlanData; onDelete: () => void }) {
  const currentYm = useCurrentYm();
  const [editing, setEditing] = useState(false);
  if (editing) return <li class="budget-row"><FundForm data={data} fund={fund} label={`Edit ${fund.name}`} submit="Save" onDone={() => setEditing(false)} /></li>;
  const status = fundStatus(fund, data.fundMoves, currentYm, data.corrections);
  const setAsideNow = data.fundMoves.some((m) => m.fundId === fund.id && m.ym === currentYm && m.kind === 'setaside');
  const category = data.categories.find((c) => c.id === fund.categoryId)?.name;
  return (
    <li class="card budget-row">
      <div class="budget-row-head">
        <span class="budget-row-name">{fund.name}</span>
        <span class="budget-amount">{formatMoney(fund.amount)}</span>
      </div>
      <span class="budget-row-detail">
        Due {monthLabel(status.dueYm)} · {repeatText(fund)}{category ? ` · ${category}` : ''}
      </span>
      <span class="budget-row-detail">
        Balance {formatMoney(status.balance)} · {setAsideNow ? 'Set aside this month' : status.setAside > 0 ? `${formatMoney(status.setAside)} to set aside this month` : 'Nothing to set aside this month'}
      </span>
      {status.behind && <span class="status" data-tone="warn" data-band="amber">Behind plan</span>}
      <div class="row-actions">
        <button type="button" class="btn btn-outline btn-small" onClick={() => setEditing(true)}>Edit</button>
        <button type="button" class="btn btn-outline btn-small" onClick={onDelete}>Delete</button>
      </div>
    </li>
  );
}

/**
 * Plan → Sinking funds (v2 §3.2): a bill of an amount due in a month, once or repeating; each month the fund asks for
 * (amount − balance) ÷ the months left, which the month view offers to confirm. Each fund shows its status now.
 */
export function PlanFunds({ data }: { data: PlanData }) {
  const { db } = useAppState();
  const [deleting, setDeleting] = useState<BudgetFund>();
  const [, run] = useBusy();
  const funds = [...data.funds].sort((a, b) => (a.dueYm < b.dueYm ? -1 : a.dueYm > b.dueYm ? 1 : a.name.localeCompare(b.name)));
  return (
    <>
      <FundForm data={data} label="New fund" submit="Add fund" />
      <section class="budget-section" aria-label="Sinking funds">
        <h3>Funds</h3>
        {funds.length === 0 ? <p class="empty">No funds yet.</p> : (
          <ul class="budget-list" aria-label="Funds">
            {funds.map((f) => <FundRow key={f.id} fund={f} data={data} onDelete={() => setDeleting(f)} />)}
          </ul>
        )}
      </section>
      {deleting && (
        <ConfirmDialog
          title="Delete fund?" confirmLabel="Delete" danger
          body={<p>{deleting.name} and its balance are no longer in the budget.</p>}
          onCancel={() => setDeleting(undefined)}
          onConfirm={() => { const id = deleting.id; setDeleting(undefined); run(() => deleteBudgetRecord(db, 'budgetFunds', id)); }}
        />
      )}
    </>
  );
}

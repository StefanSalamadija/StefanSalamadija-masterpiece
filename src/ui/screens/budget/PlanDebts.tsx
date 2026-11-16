import { useState } from 'preact/hooks';
import { useAppState } from '../../../app/AppState';
import { debtOutlook, extraDebtLine } from '../../../budget/debts';
import { formatMoney } from '../../../budget/money';
import { addMonths, monthLabel, ymOf } from '../../../budget/months';
import { createBudgetRecord, deleteBudgetRecord, updateBudgetRecord } from '../../../db/budget';
import type { BudgetFields } from '../../../db/budget';
import type { BudgetDebt, Cents } from '../../../domain/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useCurrentYm } from './Frame';
import { AMOUNT_ERROR, RATE_ERROR, TextField, balancesAt, inputText, typedMoney, typedRate, useBusy } from './planKit';
import type { PlanData } from './planKit';

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
/** The extra the "With an extra €X/month" line starts with. */
const DEFAULT_EXTRA = 5000;

function DebtForm({ debt, label, submit, onDone }: { debt?: BudgetDebt; label: string; submit: string; onDone?: () => void }) {
  const { db } = useAppState();
  const currentYm = useCurrentYm();
  const [name, setName] = useState(debt?.name ?? '');
  const [balance, setBalance] = useState(inputText(debt?.startBalance));
  const [rate, setRate] = useState(debt ? String(debt.yearlyRatePct).replace('.', ',') : '');
  const [instalment, setInstalment] = useState(inputText(debt?.instalment));
  const [startYm, setStartYm] = useState(debt?.startYm ?? currentYm);
  const [busy, run] = useBusy();

  const balanceCents = typedMoney(balance);
  const rateValue = typedRate(rate);
  const instalmentCents = typedMoney(instalment);
  const ok = name.trim() !== '' && typeof balanceCents === 'number' && rateValue !== 'invalid' && typeof instalmentCents === 'number' && YM.test(startYm);

  const save = () => {
    if (!ok) return;
    const fields: BudgetFields<'budgetDebts'> = {
      name: name.trim(), startBalance: balanceCents as number, yearlyRatePct: rateValue ?? 0, instalment: instalmentCents as number, startYm,
    };
    if (debt) run(() => updateBudgetRecord(db, 'budgetDebts', debt.id, fields), onDone);
    else run(() => createBudgetRecord(db, 'budgetDebts', fields), () => { setName(''); setBalance(''); setRate(''); setInstalment(''); });
  };

  return (
    <form class="card budget-edit" aria-label={label} onSubmit={(e) => { e.preventDefault(); save(); }}>
      {!debt && <h3>New debt</h3>}
      <TextField label="Name" value={name} onInput={setName} />
      <TextField label="Balance" value={balance} onInput={setBalance} inputMode="decimal" hint="What is owed at the start of the From month."
        error={balanceCents === 'invalid' ? AMOUNT_ERROR : undefined} />
      <TextField label="Yearly rate (%)" value={rate} onInput={setRate} inputMode="decimal" hint="Leave it empty if you do not know it (0%)."
        error={rateValue === 'invalid' ? RATE_ERROR : undefined} />
      <TextField label="Instalment" value={instalment} onInput={setInstalment} inputMode="decimal" hint="The monthly payment, interest included."
        error={instalmentCents === 'invalid' ? AMOUNT_ERROR : undefined} />
      <TextField label="From month" type="month" value={startYm} onInput={setStartYm} />
      <div class="row-actions">
        <button type="submit" class="btn btn-primary btn-small" disabled={busy || !ok}>{submit}</button>
        {onDone && <button type="button" class="btn btn-outline btn-small" onClick={onDone}>Cancel</button>}
      </div>
    </form>
  );
}

function DebtRow({ debt, data, before, onDelete }: { debt: BudgetDebt; data: PlanData; before: Cents; onDelete: () => void }) {
  const currentYm = useCurrentYm();
  const [editing, setEditing] = useState(false);
  const [extraText, setExtraText] = useState(inputText(DEFAULT_EXTRA));
  if (editing) return <li class="budget-row"><DebtForm debt={debt} label={`Edit ${debt.name}`} submit="Save" onDone={() => setEditing(false)} /></li>;

  // What was paid to this debt this month already (a payment naming it, or the only debt's).
  const paidThisMonth = data.entries
    .filter((e) => e.kind === 'expense' && e.status === 'actual' && ymOf(e.date) === currentYm
      && (e.debtId === debt.id || (e.debtId === undefined && data.debts.length === 1 && data.categories.find((c) => c.id === e.categoryId)?.pot === 'debts')))
    .reduce((sum, e) => sum + e.amount, 0);
  const input = { debt, ym: currentYm, balanceBefore: before, paidThisMonth, recurring: data.recurring };
  const outlook = debtOutlook(input);
  const extra = typedMoney(extraText);
  const withExtra = typeof extra === 'number' && extra > 0 ? debtOutlook({ ...input, extra }) : undefined;
  const line = withExtra && typeof extra === 'number' ? extraDebtLine(extra, outlook.debtFreeYm, withExtra.debtFreeYm) : undefined;
  const done = outlook.debtFreeYm !== undefined && outlook.debtFreeYm < outlook.fromYm;

  return (
    <li class="card budget-row">
      <div class="budget-row-head">
        <span class="budget-row-name">{debt.name}</span>
        <span class="budget-amount">{formatMoney(outlook.balance)}</span>
      </div>
      <span class="budget-row-detail">
        {debt.yearlyRatePct}% a year · {formatMoney(debt.instalment)} a month · from {monthLabel(debt.startYm)}
      </span>
      <p class="budget-debt-free">
        {done ? 'Paid off.' : outlook.debtFreeYm === undefined ? 'Not paid off at this payment.' : `Debt-free in ${monthLabel(outlook.debtFreeYm)}`}
      </p>
      {!done && outlook.totalInterest > 0 && <span class="budget-row-detail">Interest still to pay {formatMoney(outlook.totalInterest)}</span>}
      {!done && (
        <>
          <TextField label="Extra per month" value={extraText} onInput={setExtraText} inputMode="decimal"
            error={extra === 'invalid' ? AMOUNT_ERROR : undefined} />
          {line && <p class="budget-row-detail" role="status">{line}</p>}
        </>
      )}
      <div class="row-actions">
        <button type="button" class="btn btn-outline btn-small" onClick={() => setEditing(true)}>Edit</button>
        <button type="button" class="btn btn-outline btn-small" onClick={onDelete}>Delete</button>
      </div>
    </li>
  );
}

/**
 * Plan → Debts (base §3.7, v2 §3.9.2): each debt's balance now, rate and instalment, the month it is paid off as the
 * plan pays it (its templates, else its instalment), the interest still to pay, and what an extra amount each month
 * would do ("With an extra €X/month…", X editable).
 */
export function PlanDebts({ data }: { data: PlanData }) {
  const { db } = useAppState();
  const currentYm = useCurrentYm();
  const [deleting, setDeleting] = useState<BudgetDebt>();
  const [, run] = useBusy();
  const before: Partial<Record<string, Cents>> = data.debts.length > 0 ? balancesAt(data, addMonths(currentYm, -1)) : {};
  return (
    <>
      <DebtForm label="New debt" submit="Add debt" />
      <section class="budget-section" aria-label="Your debts">
        <h3>Debts</h3>
        {data.debts.length === 0 ? <p class="empty">No debts.</p> : (
          <ul class="budget-list" aria-label="Debts">
            {data.debts.map((d) => (
              <DebtRow key={d.id} debt={d} data={data} before={before[`debt:${d.id}`] ?? d.startBalance} onDelete={() => setDeleting(d)} />
            ))}
          </ul>
        )}
      </section>
      {deleting && (
        <ConfirmDialog
          title="Delete debt?" confirmLabel="Delete" danger
          body={<p>{deleting.name} is no longer in the budget. Its payments stay as entries.</p>}
          onCancel={() => setDeleting(undefined)}
          onConfirm={() => { const id = deleting.id; setDeleting(undefined); run(() => deleteBudgetRecord(db, 'budgetDebts', id)); }}
        />
      )}
    </>
  );
}

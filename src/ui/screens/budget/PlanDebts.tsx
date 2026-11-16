import { useMemo, useState } from 'preact/hooks';
import { useAppState } from '../../../app/AppState';
import { debtPayoffs } from '../../../budget/debtPlan';
import type { DebtPayoff } from '../../../budget/debtPlan';
import { extraDebtLine } from '../../../budget/debts';
import type { ExtraStep } from '../../../budget/debts';
import { formatMoney } from '../../../budget/money';
import { addMonths, monthLabel } from '../../../budget/months';
import { createBudgetRecord, deleteBudgetRecord, updateBudgetRecord } from '../../../db/budget';
import type { BudgetFields } from '../../../db/budget';
import type { BudgetDebt, Cents } from '../../../domain/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useCurrentYm } from './Frame';
import { AMOUNT_ERROR, RATE_ERROR, TextField, balancesAt, budgetDataOf, inputText, typedMoney, typedRate, useBusy } from './planKit';
import type { PlanData } from './planKit';

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
/** The extra the "With an extra €X/month" line starts with. */
const DEFAULT_EXTRA = 5000;

const sortedSteps = (steps: readonly ExtraStep[] | undefined): ExtraStep[] =>
  [...(steps ?? [])].sort((a, b) => (a.fromYm < b.fromYm ? -1 : a.fromYm > b.fromYm ? 1 : 0));
const stepText = (st: ExtraStep) => (st.monthly > 0 ? `Extra ${formatMoney(st.monthly)} a month from ${monthLabel(st.fromYm)}` : `No extra from ${monthLabel(st.fromYm)}`);

function DebtForm({ debt, label, submit, onDone }: { debt?: BudgetDebt; label: string; submit: string; onDone?: () => void }) {
  const { db } = useAppState();
  const currentYm = useCurrentYm();
  const [name, setName] = useState(debt?.name ?? '');
  const [balance, setBalance] = useState(inputText(debt?.startBalance));
  const [rate, setRate] = useState(debt ? String(debt.yearlyRatePct).replace('.', ',') : '');
  const [instalment, setInstalment] = useState(inputText(debt?.instalment));
  const [startYm, setStartYm] = useState(debt?.startYm ?? currentYm);
  const [steps, setSteps] = useState<ExtraStep[]>(sortedSteps(debt?.extraSteps));
  const [extra, setExtra] = useState('');
  const [extraFromYm, setExtraFromYm] = useState('');
  const [busy, run] = useBusy();

  const balanceCents = typedMoney(balance);
  const rateValue = typedRate(rate);
  const instalmentCents = typedMoney(instalment);
  const extraCents = typedMoney(extra);
  const stepOk = extraCents !== 'invalid' && (extraFromYm === '' || YM.test(extraFromYm));
  const ok = name.trim() !== '' && typeof balanceCents === 'number' && rateValue !== 'invalid' && typeof instalmentCents === 'number' && YM.test(startYm) && stepOk;
  /** The steps with the one typed in the extra fields, if any: it replaces a step of the same month. */
  const withTyped = (): ExtraStep[] => {
    if (typeof extraCents !== 'number') return steps;
    const fromYm = extraFromYm === '' ? startYm : extraFromYm;
    return sortedSteps([...steps.filter((st) => st.fromYm !== fromYm), { fromYm, monthly: extraCents }]);
  };

  const save = () => {
    if (!ok) return;
    const all = withTyped();
    const fields: BudgetFields<'budgetDebts'> = {
      name: name.trim(), startBalance: balanceCents as number, yearlyRatePct: rateValue ?? 0, instalment: instalmentCents as number, startYm,
      ...(all.length > 0 && { extraSteps: all }),
    };
    // A field left out is removed, so that removing every step takes the extra away.
    if (debt) run(() => updateBudgetRecord(db, 'budgetDebts', debt.id, { extraSteps: undefined, ...fields }), onDone);
    else run(() => createBudgetRecord(db, 'budgetDebts', fields), () => { setName(''); setBalance(''); setRate(''); setInstalment(''); setSteps([]); setExtra(''); setExtraFromYm(''); });
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
      <fieldset class="plan-methods">
        <legend>Planned extra</legend>
        <p class="helper-text">Paid each month on top of the instalment until the debt is paid off. Each amount holds from its month to the next; 0 stops it.</p>
        {steps.length > 0 && (
          <ul class="budget-list" aria-label="Planned extra">
            {steps.map((st) => (
              <li key={st.fromYm} class="budget-row-head">
                <span>{stepText(st)}</span>
                <button type="button" class="btn btn-outline btn-small" onClick={() => setSteps(steps.filter((x) => x.fromYm !== st.fromYm))}>Remove</button>
              </li>
            ))}
          </ul>
        )}
        <TextField label="Extra each month" value={extra} onInput={setExtra} inputMode="decimal" error={extraCents === 'invalid' ? AMOUNT_ERROR : undefined} />
        <TextField label="Extra from month" type="month" value={extraFromYm} onInput={setExtraFromYm} hint="Empty: from the From month." />
        <div class="row-actions">
          <button type="button" class="btn btn-outline btn-small" disabled={typeof extraCents !== 'number' || !stepOk}
            onClick={() => { setSteps(withTyped()); setExtra(''); setExtraFromYm(''); }}>Add extra</button>
        </div>
      </fieldset>
      <div class="row-actions">
        <button type="submit" class="btn btn-primary btn-small" disabled={busy || !ok}>{submit}</button>
        {onDone && <button type="button" class="btn btn-outline btn-small" onClick={onDone}>Cancel</button>}
      </div>
    </form>
  );
}

function DebtRow({ debt, data, balance, payoff, onDelete }: { debt: BudgetDebt; data: PlanData; balance: Cents; payoff: DebtPayoff; onDelete: () => void }) {
  const { shipToday } = useAppState();
  const currentYm = useCurrentYm();
  const [editing, setEditing] = useState(false);
  const [extraText, setExtraText] = useState(inputText(DEFAULT_EXTRA));
  const extra = typedMoney(extraText);
  // The what-if: the plan as it stands, with the extra on top from this month.
  const withExtra = useMemo(() => (typeof extra === 'number' && extra > 0 && !editing
    ? debtPayoffs({ today: shipToday, data: budgetDataOf(data), settings: data.settings, whatIfExtra: { debtId: debt.id, amount: extra } })[debt.id]
    : undefined), [extra, data, debt.id, shipToday, editing]);
  if (editing) return <li class="budget-row"><DebtForm debt={debt} label={`Edit ${debt.name}`} submit="Save" onDone={() => setEditing(false)} /></li>;

  const line = withExtra && typeof extra === 'number' ? extraDebtLine(extra, payoff.debtFreeYm, withExtra.debtFreeYm) : undefined;
  const done = payoff.debtFreeYm !== undefined && payoff.debtFreeYm < currentYm;
  const steps = sortedSteps(debt.extraSteps);
  const hasExtra = steps.some((st) => st.monthly > 0);

  return (
    <li class="card budget-row">
      <div class="budget-row-head">
        <span class="budget-row-name">{debt.name}</span>
        <span class="budget-amount">{formatMoney(balance)}</span>
      </div>
      <span class="budget-row-detail">
        {debt.yearlyRatePct}% a year · {formatMoney(debt.instalment)} a month · from {monthLabel(debt.startYm)}
      </span>
      {steps.length > 0 && <span class="budget-row-detail">{steps.map(stepText).join('; ')}</span>}
      <p class="budget-debt-free">
        {done ? 'Paid off.' : payoff.debtFreeYm === undefined ? 'Not paid off at this payment.' : `Debt-free in ${monthLabel(payoff.debtFreeYm)}`}
      </p>
      {!done && payoff.debtFreeYm !== undefined && payoff.totalInterest > 0 && <span class="budget-row-detail">Interest still to pay {formatMoney(payoff.totalInterest)}</span>}
      {!done && (
        <>
          <TextField label="Try an extra per month" value={extraText} onInput={setExtraText} inputMode="decimal"
            hint={hasExtra ? 'On top of the planned extra. Nothing is saved.' : 'Nothing is saved.'}
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
 * Plan → Debts (base §3.7, v2 §3.9.2): each debt's balance now, rate, instalment and planned extra; the month it is
 * paid off and the interest still to pay, both read from the forecast (`debtPayoffs`), so they are what the Forecast
 * shows; and what an extra amount each month would do on top ("With an extra €X/month…", X editable, not saved).
 */
export function PlanDebts({ data }: { data: PlanData }) {
  const { db, shipToday } = useAppState();
  const currentYm = useCurrentYm();
  const [deleting, setDeleting] = useState<BudgetDebt>();
  const [, run] = useBusy();
  const before: Partial<Record<string, Cents>> = data.debts.length > 0 ? balancesAt(data, addMonths(currentYm, -1)) : {};
  const payoffs = useMemo(
    () => (data.debts.length > 0 ? debtPayoffs({ today: shipToday, data: budgetDataOf(data), settings: data.settings }) : {}), [data, shipToday]);
  return (
    <>
      <DebtForm label="New debt" submit="Add debt" />
      <section class="budget-section" aria-label="Your debts">
        <h3>Debts</h3>
        {data.debts.length === 0 ? <p class="empty">No debts.</p> : (
          <ul class="budget-list" aria-label="Debts">
            {data.debts.map((d) => (
              <DebtRow
                key={d.id} debt={d} data={data} payoff={payoffs[d.id] ?? { totalInterest: 0 }} onDelete={() => setDeleting(d)}
                balance={d.startYm >= currentYm ? d.startBalance : before[`debt:${d.id}`] ?? d.startBalance}
              />
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

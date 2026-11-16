import { useState } from 'preact/hooks';
import { useAppState } from '../../../app/AppState';
import { correctionChanges, latestCorrection } from '../../../budget/corrections';
import { addMonths } from '../../../budget/months';
import { createBudgetRecord, updateBudgetRecord } from '../../../db/budget';
import type { BudgetAccount, Cents } from '../../../domain/types';
import { useCurrentYm } from './Frame';
import { AMOUNT_ERROR, PlanFrame, TextField, inputText, typedMoney, useBusy, usePlanData } from './planKit';
import type { PlanData } from './planKit';

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The accounts a start can be given for, with their labels: the bank, investments, emergency fund, each debt, fund and asset. */
function accountsOf(data: PlanData): { account: BudgetAccount; label: string; negative?: boolean }[] {
  return [
    { account: 'bank', label: 'Bank & cash', negative: true },
    { account: 'investments', label: 'Investments' },
    { account: 'emergency', label: 'Emergency fund' },
    ...data.debts.map((d) => ({ account: `debt:${d.id}` as const, label: d.name })),
    ...data.funds.map((f) => ({ account: `fund:${f.id}` as const, label: f.name })),
    ...data.assets.map((a) => ({ account: `asset:${a.id}` as const, label: a.name })),
  ];
}

function BalancesForm({ data, ym }: { data: PlanData; ym: string }) {
  const { db } = useAppState();
  const accounts = accountsOf(data);
  const held = (account: BudgetAccount) => {
    const c = latestCorrection(data.corrections, account, ym);
    return c && c.ym === ym ? inputText(c.balance) : '';
  };
  const [texts, setTexts] = useState<Partial<Record<BudgetAccount, string>>>(() => Object.fromEntries(accounts.map((a) => [a.account, held(a.account)])));
  const [status, setStatus] = useState('');
  const [busy, run] = useBusy();
  const values = Object.fromEntries(accounts.map((a) => [a.account, typedMoney(texts[a.account] ?? '', { negative: a.negative })])) as Record<BudgetAccount, Cents | undefined | 'invalid'>;
  const ok = Object.values(values).every((v) => v !== 'invalid') && Object.values(values).some((v) => typeof v === 'number');

  const section = (title: string, list: typeof accounts) => list.length > 0 && (
    <fieldset class="plan-methods">
      <legend>{title}</legend>
      {list.map((a) => (
        <TextField key={a.account} label={a.label} value={texts[a.account] ?? ''} inputMode="decimal"
          onInput={(v) => { setTexts({ ...texts, [a.account]: v }); setStatus(''); }}
          error={values[a.account] === 'invalid' ? AMOUNT_ERROR : undefined} />
      ))}
    </fieldset>
  );

  return (
    <form class="budget-edit" aria-label="Starting balances" onSubmit={(e) => {
      e.preventDefault();
      if (!ok) return;
      const given: Partial<Record<BudgetAccount, Cents>> = {};
      for (const a of accounts) if (typeof values[a.account] === 'number') given[a.account] = values[a.account] as Cents;
      const { create, update } = correctionChanges(data.corrections, ym, given);
      run(async () => {
        for (const c of create) await createBudgetRecord(db, 'budgetCorrections', c);
        for (const u of update) await updateBudgetRecord(db, 'budgetCorrections', u.id, { balance: u.balance });
      }, () => setStatus('Starting balances saved.'));
    }}>
      {section('Accounts', accounts.slice(0, 3))}
      {section('Debts', accounts.filter((a) => a.account.startsWith('debt:')))}
      {section('Sinking funds', accounts.filter((a) => a.account.startsWith('fund:')))}
      {section('Assets', accounts.filter((a) => a.account.startsWith('asset:')))}
      <p class="helper-text">An empty field writes nothing. A debt is what is still owed.</p>
      <div class="row-actions"><button type="submit" class="btn btn-primary" disabled={busy || !ok}>Save starting balances</button></div>
      <p class="live" role="status">{status}</p>
      {status !== '' && <p><a href="#/budget">Go to the dashboard</a></p>}
    </form>
  );
}

function StartBody() {
  const data = usePlanData();
  const currentYm = useCurrentYm();
  const [ym, setYm] = useState(addMonths(currentYm, -1));
  if (!data) return <p class="live" role="status">Loading…</p>;
  return (
    <>
      <p class="helper-text">
        What each account held at the end of a month, as your bank and statements show it. Later months go on from these balances.
      </p>
      <TextField label="Balances at the end of" type="month" value={ym} onInput={(v) => { if (YM.test(v) && v <= currentYm) setYm(v); }}
        hint="This month at the latest: the forecast starts from a balance it already has." />
      <BalancesForm key={ym} data={data} ym={ym} />
    </>
  );
}

/**
 * `/budget/plan/start`: the starting balances (v2 §3.9.3), offered on the first run (while there is no bank balance)
 * and kept in the Plan. Each balance given is a correction of its account at the end of the chosen month: one already
 * there for that month is changed, never doubled.
 */
export function StartBalances() {
  return <PlanFrame title="Starting balances"><StartBody /></PlanFrame>;
}

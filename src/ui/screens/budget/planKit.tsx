import type { ComponentChildren } from 'preact';
import { useId, useRef, useState } from 'preact/hooks';
import { useAppState } from '../../../app/AppState';
import { reportError } from '../../../app/errors';
import type { BudgetData } from '../../../budget/forecast';
import { MONTH_NAMES } from '../../../domain/dates';
import { balancesByMonth } from '../../../budget/ledger';
import type { Account } from '../../../budget/ledger';
import { parseMoney } from '../../../budget/money';
import type { MonthChanges, PlanScope } from '../../../budget/targets';
import { createBudgetRecord, getBudgetSettings, listBudget, listCategories, updateBudgetRecord } from '../../../db/budget';
import type { MasterpieceDB } from '../../../db/schema';
import { parseDecimal } from '../../../domain/numbers';
import type { Cents, Ym } from '../../../domain/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useLive } from '../../useLive';
import { BudgetFrame } from './Frame';
import { padText } from './quickAddView';

/* What the Plan screens share: the budget's data, the typed amounts and rates, a save that runs once, the frame of a
 * Plan section, and the "This month only" / "From this month on" dialog. */

/** Every budget table, kept up to date (the scenarios in the order they were made). Deleted records are left out. */
export function usePlanData() {
  const { db } = useAppState();
  return useLive(async () => {
    const [categories, months, recurring, funds, fundMoves, debts, goals, assets, corrections, entries, scenarios, settings] = await Promise.all([
      listCategories(db), listBudget(db, 'budgetMonths'), listBudget(db, 'budgetRecurring'), listBudget(db, 'budgetFunds'),
      listBudget(db, 'budgetFundMoves'), listBudget(db, 'budgetDebts'), listBudget(db, 'budgetGoals'), listBudget(db, 'budgetAssets'),
      listBudget(db, 'budgetCorrections'), listBudget(db, 'budgetEntries'), listBudget(db, 'budgetScenarios'), getBudgetSettings(db),
    ]);
    scenarios.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));
    return { categories, months, recurring, funds, fundMoves, debts, goals, assets, corrections, entries, scenarios, settings };
  }, [db]);
}

export type PlanData = NonNullable<ReturnType<typeof usePlanData>>;

/** The Plan's data as the forecast takes it. */
export function budgetDataOf(data: PlanData): BudgetData {
  return {
    budgetCategories: data.categories, budgetEntries: data.entries, budgetMonths: data.months, budgetRecurring: data.recurring, budgetFunds: data.funds,
    budgetFundMoves: data.fundMoves, budgetDebts: data.debts, budgetGoals: data.goals, budgetAssets: data.assets, budgetCorrections: data.corrections,
    budgetScenarios: data.scenarios,
  };
}

/** Every account's balance at the end of `ym`. */
export function balancesAt(data: PlanData, ym: Ym): Record<Account, Cents> {
  const { balances } = balancesByMonth({
    entries: data.entries, corrections: data.corrections, debts: data.debts, assets: data.assets, categories: data.categories,
    fundMoves: data.fundMoves, funds: data.funds, recurring: data.recurring, fromYm: ym, toYm: ym,
  });
  return balances.get(ym)!;
}

/** Cents as a field shows them for editing: `2500`, `3,20`, `-40`. */
export function inputText(cents: Cents | undefined): string {
  if (cents === undefined) return '';
  return cents < 0 ? `-${padText(-cents)}` : padText(cents);
}

/** An amount typed in a field: cents (0 included, a negative only with `negative`), undefined when empty, else invalid. */
export function typedMoney(text: string, opts: { negative?: boolean } = {}): Cents | undefined | 'invalid' {
  return parseMoney(text, opts);
}

/** A rate typed in a field, such as `2,5`: undefined when empty, invalid when not a number from 0 to `max`. */
export function typedRate(text: string, max = 100): number | undefined | 'invalid' {
  const value = parseDecimal(text);
  if (value === undefined || value === 'invalid') return value;
  return value >= 0 && value <= max ? value : 'invalid';
}

/** A whole number typed in a field, from `min` to `max`; undefined when empty. */
export function typedWhole(text: string, min: number, max: number): number | undefined | 'invalid' {
  const value = parseDecimal(text);
  if (value === undefined || value === 'invalid') return value;
  return Number.isInteger(value) && value >= min && value <= max ? value : 'invalid';
}

/** `2026-06-15` → `15 Jun 2026`. */
export function dayLabel(date: string): string {
  const [y, m, d] = date.split('-');
  return `${Number(d)} ${MONTH_NAMES[Number(m) - 1]} ${y}`;
}

/**
 * A save that runs once at a time: `busy` while it runs, and a second tap before it ends does nothing. A failure is
 * shown in the error toast; `done` runs after a success.
 */
export function useBusy(): [boolean, (work: () => Promise<unknown>, done?: () => void) => void] {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const run = (work: () => Promise<unknown>, done?: () => void) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    work().then(() => done?.(), reportError).finally(() => { running.current = false; setBusy(false); });
  };
  return [busy, run];
}

export { saveMonthChanges } from '../../../db/budget';

/** A Plan section's screen: the budget's frame, with the way back to the Plan. */
export function PlanFrame({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <BudgetFrame title={title}>
      <p class="plan-back no-print"><a href="#/budget/plan">← Plan</a></p>
      {children}
    </BudgetFrame>
  );
}

/** A labelled text input, for the Plan's forms. `error` is shown under it when there is one. */
export function TextField({ label, value, onInput, inputMode, type = 'text', hint, error, maxLength = 120 }: {
  label: string; value: string; onInput: (value: string) => void; inputMode?: 'decimal' | 'numeric'; type?: 'text' | 'month' | 'date';
  hint?: string; error?: string; maxLength?: number;
}) {
  const id = useId();
  const described = [hint !== undefined && `${id}-hint`, error !== undefined && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div class="field">
      <label for={id}>{label}</label>
      <input
        // Preact types `<input>` as a union keyed by `type`; these types all take the same attributes.
        id={id} type={type as 'text'} inputMode={inputMode} maxLength={type === 'text' ? maxLength : undefined} value={value} autocomplete="off"
        aria-invalid={error !== undefined ? 'true' : undefined} aria-describedby={described} onInput={(e) => onInput(e.currentTarget.value)}
      />
      {hint !== undefined && <p id={`${id}-hint`} class="helper-text">{hint}</p>}
      {error !== undefined && <p id={`${id}-error`} class="field-error">{error}</p>}
    </div>
  );
}

/** A labelled select. */
export function SelectField({ label, value, onChange, children, hint }: {
  label: string; value: string; onChange: (value: string) => void; children: ComponentChildren; hint?: string;
}) {
  const id = useId();
  return (
    <div class="field">
      <label for={id}>{label}</label>
      <select id={id} value={value} aria-describedby={hint !== undefined ? `${id}-hint` : undefined} onChange={(e) => onChange(e.currentTarget.value)}>
        {children}
      </select>
      {hint !== undefined && <p id={`${id}-hint`} class="helper-text">{hint}</p>}
    </div>
  );
}

/** The message for an amount field that holds something that is not an amount. */
export const AMOUNT_ERROR = 'Enter an amount, such as 1234,56.';
/** The message for a rate field that holds something that is not a rate. */
export const RATE_ERROR = 'Enter a number from 0 to 100, such as 2,5.';

/**
 * Asks how far a target edit reaches (base §3.2): "This month only", or "From this month on", which also changes every
 * later month that still uses the inherited value (months edited on their own keep theirs).
 */
export function ScopeDialog({ title, onChoose, onCancel }: { title: string; onChoose: (scope: PlanScope) => void; onCancel: () => void }) {
  const [scope, setScope] = useState<PlanScope>('fromOn');
  const name = useId();
  return (
    <ConfirmDialog
      title={title} confirmLabel="Save" onCancel={onCancel} onConfirm={() => onChoose(scope)}
      body={(
        <fieldset class="plan-scope">
          <legend>Apply it to</legend>
          <label class="check">
            <input type="radio" name={name} checked={scope === 'this'} onChange={() => setScope('this')} />
            This month only
          </label>
          <label class="check">
            <input type="radio" name={name} checked={scope === 'fromOn'} onChange={() => setScope('fromOn')} />
            From this month on
          </label>
          <p class="helper-text">Later months that were changed on their own keep their own value.</p>
        </fieldset>
      )}
    />
  );
}

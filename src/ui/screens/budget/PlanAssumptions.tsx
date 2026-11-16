import { useState } from 'preact/hooks';
import { useAppState } from '../../../app/AppState';
import { POTS } from '../../../budget/catalog';
import { averageMonthlyNeeds } from '../../../budget/goals';
import { formatMoney } from '../../../budget/money';
import { yearlySpending } from '../../../budget/yearlySpending';
import { updateBudgetSettings } from '../../../db/budget';
import type { Assumptions, BudgetSettings, Cents, ForecastMethod, PotId } from '../../../domain/types';
import { useCurrentYm } from './Frame';
import { AMOUNT_ERROR, RATE_ERROR, SelectField, TextField, inputText, typedMoney, typedRate, typedWhole, useBusy } from './planKit';
import type { PlanData } from './planKit';

const HORIZONS: BudgetSettings['horizon'][] = [12, 24, 36, 60];
const METHODS: { id: ForecastMethod; label: string }[] = [
  { id: 'targets', label: 'Targets' }, { id: 'average', label: 'Average of the last 6 months' }, { id: 'fixed', label: 'A fixed amount' },
];

const rateText = (v: number | undefined) => (v === undefined ? '' : String(v).replace('.', ','));

/**
 * Plan → Assumptions (v2 §3.3, §3.4): the expected return, the withdrawal rate and inflation (the return and inflation
 * stay empty until the user enters them; 0% is allowed), the buffer, the emergency fund's months of Needs, the fund
 * reminder, the forecast horizon and each pot's forecast method.
 */
export function PlanAssumptions({ data }: { data: PlanData }) {
  const { db } = useAppState();
  const currentYm = useCurrentYm();
  const { settings } = data;
  const a = settings.assumptions;
  const [ret, setRet] = useState(rateText(a.yearlyReturnPct));
  const [withdrawal, setWithdrawal] = useState(rateText(a.withdrawalRatePct));
  const [inflation, setInflation] = useState(rateText(a.inflationPct));
  const [buffer, setBuffer] = useState(inputText(settings.bufferCents));
  const [yearly, setYearly] = useState(inputText(a.yearlySpendingCents));
  const [months, setMonths] = useState(String(a.emergencyMonths));
  const [reminder, setReminder] = useState(String(a.fundReminderDays));
  const [horizon, setHorizon] = useState(String(settings.horizon));
  const [methods, setMethods] = useState<Record<PotId, ForecastMethod>>(settings.forecastMethod);
  const [fixed, setFixed] = useState<Partial<Record<PotId, string>>>(
    Object.fromEntries(Object.entries(settings.fixedSpend ?? {}).map(([pot, c]) => [pot, inputText(c)])),
  );
  const [status, setStatus] = useState('');
  const [busy, run] = useBusy();

  const retValue = typedRate(ret);
  const withdrawalValue = typedRate(withdrawal);
  const inflationValue = typedRate(inflation);
  const bufferValue = typedMoney(buffer);
  const yearlyValue = typedMoney(yearly);
  const monthsValue = typedWhole(months, 1, 24);
  const reminderValue = typedWhole(reminder, 0, 365);
  const fixedValues = Object.fromEntries(POTS.map((p) => [p.id, typedMoney(fixed[p.id] ?? '')])) as Record<PotId, Cents | undefined | 'invalid'>;
  const fixedOk = POTS.every((p) => methods[p.id] !== 'fixed' || typeof fixedValues[p.id] === 'number');
  const ok = retValue !== 'invalid' && typeof withdrawalValue === 'number' && withdrawalValue > 0 && inflationValue !== 'invalid'
    && bufferValue !== 'invalid' && yearlyValue !== 'invalid' && typeof monthsValue === 'number' && typeof reminderValue === 'number' && fixedOk;
  const averageNeeds = averageMonthlyNeeds(data.entries, data.categories, currentYm);
  const average = yearlySpending({ entries: data.entries, categories: data.categories, assumptions: { ...a, yearlySpendingCents: undefined }, currentYm });
  const edited = <T,>(set: (v: T) => void) => (v: T) => { set(v); setStatus(''); };

  const save = () => {
    if (!ok) return;
    const assumptions: Assumptions = {
      ...(retValue !== undefined && { yearlyReturnPct: retValue }), withdrawalRatePct: withdrawalValue as number,
      ...(inflationValue !== undefined && { inflationPct: inflationValue }), emergencyMonths: monthsValue as number, fundReminderDays: reminderValue as number,
      ...(yearlyValue !== undefined && { yearlySpendingCents: yearlyValue }),
    };
    const fixedSpend: Partial<Record<PotId, Cents>> = {};
    for (const p of POTS) if (methods[p.id] === 'fixed') fixedSpend[p.id] = fixedValues[p.id] as Cents;
    run(() => updateBudgetSettings(db, {
      assumptions, horizon: Number(horizon) as BudgetSettings['horizon'], bufferCents: bufferValue, forecastMethod: methods,
      fixedSpend: Object.keys(fixedSpend).length > 0 ? fixedSpend : undefined,
    }), () => setStatus('Saved.'));
  };

  return (
    <form class="budget-edit" aria-label="Assumptions" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <p class="helper-text">Projection — not a forecast or financial advice.</p>
      <TextField label="Expected yearly return (%)" value={ret} onInput={edited(setRet)} inputMode="decimal"
        hint="Your own figure for the investments: none is assumed for you, and 0% is allowed. The freedom date needs it."
        error={retValue === 'invalid' ? RATE_ERROR : undefined} />
      <TextField label="Withdrawal rate (%)" value={withdrawal} onInput={edited(setWithdrawal)} inputMode="decimal" hint="an assumption, not advice"
        error={withdrawalValue === 'invalid' || withdrawalValue === 0 ? 'Enter a rate above 0 and up to 100, such as 4.' : withdrawalValue === undefined ? 'Enter a rate, such as 4.' : undefined} />
      <TextField label="Inflation (% a year)" value={inflation} onInput={edited(setInflation)} inputMode="decimal"
        hint="Yearly spending grows smoothly through the year at this rate (the forecast compounds it monthly). Empty until you enter it; 0% is allowed."
        error={inflationValue === 'invalid' ? RATE_ERROR : undefined} />
      <TextField label="Yearly spending (for the freedom date)" value={yearly} onInput={edited(setYearly)} inputMode="decimal"
        hint={`Empty: the average Needs + Wants of the last 12 tracked months, × 12 (${average.months === 0 ? 'no month tracked yet' : `${formatMoney(average.amount)} now`}).`}
        error={yearlyValue === 'invalid' ? AMOUNT_ERROR : undefined} />
      <TextField label="Buffer" value={buffer} onInput={edited(setBuffer)} inputMode="decimal"
        hint={`Warn when free to spend drops below it. Empty: 1 × average monthly Needs (${formatMoney(averageNeeds)} now).`}
        error={bufferValue === 'invalid' ? AMOUNT_ERROR : undefined} />
      <TextField label="Emergency fund (months of Needs)" value={months} onInput={edited(setMonths)} inputMode="numeric"
        hint="The emergency fund target is this many months of average Needs spending."
        error={monthsValue === 'invalid' || monthsValue === undefined ? 'Enter 1 to 24 months.' : undefined} />
      <TextField label="Fund reminder (days before due)" value={reminder} onInput={edited(setReminder)} inputMode="numeric"
        error={reminderValue === 'invalid' || reminderValue === undefined ? 'Enter 0 to 365 days.' : undefined} />
      <SelectField label="Forecast horizon" value={horizon} onChange={edited(setHorizon)}>
        {HORIZONS.map((h) => <option key={h} value={String(h)}>{h} months</option>)}
      </SelectField>
      <fieldset class="plan-methods">
        <legend>Forecast spending by pot</legend>
        {POTS.map((p) => (
          <div key={p.id} class="budget-edit">
            <SelectField label={`${p.label} forecast`} value={methods[p.id]} onChange={edited((v: string) => setMethods({ ...methods, [p.id]: v as ForecastMethod }))}>
              {METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </SelectField>
            {methods[p.id] === 'fixed' && (
              <TextField label={`${p.label} each month`} value={fixed[p.id] ?? ''} inputMode="decimal"
                onInput={edited((v: string) => setFixed({ ...fixed, [p.id]: v }))}
                error={fixedValues[p.id] === 'invalid' ? AMOUNT_ERROR : undefined} />
            )}
          </div>
        ))}
      </fieldset>
      <div class="row-actions"><button type="submit" class="btn btn-primary" disabled={busy || !ok}>Save assumptions</button></div>
      <p class="live" role="status">{status}</p>
    </form>
  );
}

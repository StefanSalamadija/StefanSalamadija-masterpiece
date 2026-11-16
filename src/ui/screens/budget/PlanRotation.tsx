import { useState } from 'preact/hooks';
import { useAppState } from '../../../app/AppState';
import { applyContract, contractPeriod, contractStatus, myLatestContract } from '../../../budget/contract';
import { formatMoney } from '../../../budget/money';
import { monthLabel } from '../../../budget/months';
import { updateBudgetSettings } from '../../../db/budget';
import { listShips } from '../../../db/ships';
import { rankLabel } from '../../../domain/catalogues';
import { isValidIsoDate } from '../../../domain/dates';
import type { CrewMember, RotationSettings } from '../../../domain/types';
import { useLive } from '../../useLive';
import { AMOUNT_ERROR, RATE_ERROR, SelectField, TextField, dayLabel, typedMoney, typedRate, typedWhole, useBusy } from './planKit';
import type { PlanData } from './planKit';

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Every live crew record of every ship, with its ship's name. */
function useCrew() {
  const { db } = useAppState();
  return useLive(async () => {
    const [crew, ships] = await Promise.all([db.crew.filter((c) => !c.deleted).toArray(), listShips(db)]);
    const shipName = new Map(ships.map((s) => [s.id, s.particulars.name]));
    return { crew, shipName };
  }, [db]);
}

function periodText(p: { signOn: string; signOff: string }): string {
  return `${dayLabel(p.signOn)} – ${dayLabel(p.signOff)}`;
}

/** "Which crew member is you?", and "Use my contract from ‹ship›" / "Update from contract". */
function MyContract({ data, save }: { data: PlanData; save: (rotation: RotationSettings) => void }) {
  const { db } = useAppState();
  const crewData = useCrew();
  const [busy, run] = useBusy();
  if (!crewData) return <p class="live" role="status">Loading…</p>;
  const { crew, shipName } = crewData;
  const { settings } = data;
  const base = (m: CrewMember) => `${m.surname}, ${m.givenNames} — ${rankLabel(m)} · ${shipName.get(m.shipId) ?? 'Deleted ship'}`;
  const counts = new Map<string, number>();
  for (const m of crew) counts.set(base(m), (counts.get(base(m)) ?? 0) + 1);
  const label = (m: CrewMember) => (counts.get(base(m))! > 1 ? `${base(m)} · signed on ${dayLabel(m.signOnDate)}` : base(m));
  const sorted = [...crew].sort((a, b) => label(a).localeCompare(label(b)));

  const latest = myLatestContract(crew, settings.meCrewId);
  const ship = latest ? shipName.get(latest.shipId) ?? 'the ship' : '';
  const period = latest ? contractPeriod(latest) : undefined;
  const status = latest && period ? contractStatus(settings.rotation.periods, latest.id, period) : undefined;
  const use = () => { if (latest && period) save({ ...settings.rotation, periods: applyContract(settings.rotation.periods, latest.id, period) }); };

  return (
    <section class="budget-section" aria-label="Your contract">
      <h3>Your contract</h3>
      {crew.length === 0 ? <p class="empty">Add yourself to a ship's crew list to take your contract from it.</p> : (
        <SelectField label="Which crew member is you?" value={settings.meCrewId ?? ''}
          onChange={(id) => run(() => updateBudgetSettings(db, { meCrewId: id === '' ? undefined : id }))}>
          <option value="">—</option>
          {sorted.map((m) => <option key={m.id} value={m.id}>{label(m)}</option>)}
        </SelectField>
      )}
      {settings.meCrewId !== undefined && !latest && <p class="field-warning">The crew record marked as you is no longer there.</p>}
      {latest && !period && <p class="helper-text">Your crew record on {ship} has no contract length or sign-off date yet.</p>}
      {latest && period && status === 'missing' && (
        <div class="row-actions"><button type="button" class="btn btn-primary btn-small" disabled={busy} onClick={use}>Use my contract from {ship}</button></div>
      )}
      {latest && period && status === 'same' && <p class="helper-text">Your contract from {ship} is in the plan.</p>}
      {latest && period && status === 'differs' && (
        <>
          <p class="field-warning">Your contract from {ship} has changed: {periodText(period)}.</p>
          <div class="row-actions"><button type="button" class="btn btn-primary btn-small" disabled={busy} onClick={use}>Update from contract</button></div>
        </>
      )}
    </section>
  );
}

function Periods({ rotation, save }: { rotation: RotationSettings; save: (rotation: RotationSettings) => void }) {
  const [signOn, setSignOn] = useState('');
  const [signOff, setSignOff] = useState('');
  const ok = isValidIsoDate(signOn) && isValidIsoDate(signOff) && signOff >= signOn;
  const periods = rotation.periods.map((p, i) => ({ p, i })).sort((a, b) => (a.p.signOn < b.p.signOn ? -1 : a.p.signOn > b.p.signOn ? 1 : 0));
  return (
    <section class="budget-section" aria-label="Contract periods">
      <h3>Periods</h3>
      {periods.length === 0 ? <p class="empty">No periods yet: the forecast has no salary until there is one.</p> : (
        <ul class="budget-list" aria-label="Periods">
          {periods.map(({ p, i }) => (
            <li key={`${p.signOn}:${p.signOff}:${i}`} class="card budget-row">
              <div class="budget-row-head">
                <span class="budget-row-name">{periodText(p)}</span>
                {p.crewId !== undefined && <span class="badge">From your contract</span>}
              </div>
              <div class="row-actions">
                <button type="button" class="btn btn-outline btn-small"
                  onClick={() => save({ ...rotation, periods: rotation.periods.filter((_, j) => j !== i) })}>Remove</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form class="card budget-edit" aria-label="New period" onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        save({ ...rotation, periods: [...rotation.periods, { signOn, signOff }] });
        setSignOn(''); setSignOff('');
      }}>
        <TextField label="Sign-on" type="date" value={signOn} onInput={setSignOn} />
        <TextField label="Sign-off" type="date" value={signOff} onInput={setSignOff}
          error={isValidIsoDate(signOn) && isValidIsoDate(signOff) && signOff < signOn ? 'The sign-off cannot be before the sign-on.' : undefined} />
        <div class="row-actions"><button type="submit" class="btn btn-outline btn-small" disabled={!ok}>Add period</button></div>
      </form>
    </section>
  );
}

function Salary({ rotation, save }: { rotation: RotationSettings; save: (rotation: RotationSettings) => void }) {
  const [amount, setAmount] = useState('');
  const [ym, setYm] = useState('');
  const cents = typedMoney(amount);
  const ok = typeof cents === 'number' && cents > 0 && YM.test(ym);
  const salaries = [...rotation.salaryFrom].sort((a, b) => (a.ym < b.ym ? -1 : 1));
  return (
    <>
      {salaries.length === 0 ? <p class="empty">No salary yet.</p> : (
        <ul class="budget-list" aria-label="Salary">
          {salaries.map((s) => (
            <li key={s.ym} class="card budget-row">
              <div class="budget-row-head">
                <span class="budget-row-name">{formatMoney(s.amount)} from {monthLabel(s.ym)}</span>
                <button type="button" class="btn btn-outline btn-small"
                  onClick={() => save({ ...rotation, salaryFrom: rotation.salaryFrom.filter((x) => x.ym !== s.ym) })}>Remove</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form class="card budget-edit" aria-label="New salary" onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        save({ ...rotation, salaryFrom: [...rotation.salaryFrom.filter((s) => s.ym !== ym), { ym, amount: cents as number }] });
        setAmount(''); setYm('');
      }}>
        <TextField label="Monthly salary onboard" value={amount} onInput={setAmount} inputMode="decimal" hint="Net, for a whole month onboard."
          error={cents === 'invalid' ? AMOUNT_ERROR : undefined} />
        <TextField label="From month" type="month" value={ym} onInput={setYm} />
        <div class="row-actions"><button type="submit" class="btn btn-outline btn-small" disabled={!ok}>Add salary</button></div>
      </form>
    </>
  );
}

function PatternAndPay({ rotation, save }: { rotation: RotationSettings; save: (rotation: RotationSettings, done: () => void) => void }) {
  const [on, setOn] = useState(String(rotation.patternOn));
  const [off, setOff] = useState(String(rotation.patternOff));
  const [paidIn, setPaidIn] = useState(rotation.paidNextMonth ? 'next' : 'same');
  const [home, setHome] = useState(String(rotation.paidAtHomePct).replace('.', ','));
  const [status, setStatus] = useState('');
  const onValue = typedWhole(on, 1, 24);
  const offValue = typedWhole(off, 0, 24);
  const homeValue = typedRate(home);
  const ok = typeof onValue === 'number' && typeof offValue === 'number' && homeValue !== 'invalid';
  const edited = (set: (v: string) => void) => (v: string) => { set(v); setStatus(''); };
  return (
    <form class="budget-edit" aria-label="Pattern and pay" onSubmit={(e) => {
      e.preventDefault();
      if (!ok) return;
      save({ ...rotation, patternOn: onValue as number, patternOff: offValue as number, paidNextMonth: paidIn === 'next', paidAtHomePct: homeValue ?? 0 },
        () => setStatus('Saved.'));
    }}>
      <p class="helper-text">After the last period, this pattern repeats up to the forecast horizon.</p>
      <TextField label="Months on" value={on} onInput={edited(setOn)} inputMode="numeric" error={onValue === 'invalid' || onValue === undefined ? 'Enter 1 to 24 months.' : undefined} />
      <TextField label="Months off" value={off} onInput={edited(setOff)} inputMode="numeric" error={offValue === 'invalid' || offValue === undefined ? 'Enter 0 to 24 months.' : undefined} />
      <SelectField label="Paid in" value={paidIn} onChange={edited(setPaidIn)} hint="The month the salary lands in the bank.">
        <option value="same">The same month</option>
        <option value="next">The next month</option>
      </SelectField>
      <TextField label="Paid at home (%)" value={home} onInput={edited(setHome)} inputMode="decimal" hint="Leave pay at home, as a % of the salary onboard."
        error={homeValue === 'invalid' ? RATE_ERROR : undefined} />
      <div class="row-actions"><button type="submit" class="btn btn-primary btn-small" disabled={!ok}>Save pattern and pay</button></div>
      <p class="live" role="status">{status}</p>
    </form>
  );
}

/**
 * Plan → Rotation (v2 §3.3): the contract periods (your own contract taken from a crew list, if you like), the pattern
 * that repeats after them, the salary from a month on, the month it is paid in, and leave pay at home. A change to the
 * crew record is never copied by itself: the screen offers "Update from contract".
 */
export function PlanRotation({ data }: { data: PlanData }) {
  const { db } = useAppState();
  const [, run] = useBusy();
  const save = (rotation: RotationSettings, done?: () => void) => run(() => updateBudgetSettings(db, { rotation }), done);
  const { rotation } = data.settings;
  return (
    <>
      <MyContract data={data} save={save} />
      <Periods rotation={rotation} save={save} />
      <section class="budget-section" aria-label="Pay">
        <h3>Pay</h3>
        <Salary rotation={rotation} save={save} />
        <PatternAndPay rotation={rotation} save={save} />
      </section>
      <p class="helper-text">Salary for a month = monthly salary × the days onboard ÷ the days in the month{rotation.paidAtHomePct > 0 ? `, plus ${rotation.paidAtHomePct}% for the days at home` : ''}.</p>
    </>
  );
}

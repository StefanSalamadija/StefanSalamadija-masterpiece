import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useAppState } from '../../../app/AppState';
import { reportError } from '../../../app/errors';
import { useRoute } from '../../../app/router';
import { POTS } from '../../../budget/catalog';
import { balancesByMonth } from '../../../budget/ledger';
import { formatMoney, parseMoney } from '../../../budget/money';
import { monthTargetsWarning, summariseMonth } from '../../../budget/month';
import type { CategoryBand } from '../../../budget/month';
import { addMonths } from '../../../budget/months';
import { plannedItemsFor } from '../../../budget/planned';
import { effectiveMonth } from '../../../budget/targets';
import {
  confirmSetAside, deleteBudgetRecord, entriesInMonth, generatePlannedEntries, getBudgetSettings, listBudget, listCategories, saveMonthNotes,
  updateBudgetSettings, updateEntry,
} from '../../../db/budget';
import type { BudgetCategory, BudgetEntry, BudgetFund } from '../../../domain/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useLive } from '../../useLive';
import { BudgetFrame, useCurrentYm } from './Frame';
import { entryLabel, monthLabel } from './quickAddView';

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const BAND_TEXT: Record<CategoryBand, string | undefined> = { ok: '✓ On track', amber: 'Near target', red: 'Over target', none: undefined };
/** The status pill of a category's band: near target outlined, over target filled, on track a ✓ and the words. */
const BAND_TONE = { ok: 'ok', amber: 'warn', red: 'danger', none: undefined } as const;

/** An amount typed by the user, in cents above zero, or undefined. */
function typed(text: string): number | undefined {
  const value = parseMoney(text);
  return typeof value === 'number' && value > 0 ? value : undefined;
}

function pctText(pct: number): string {
  return `${pct}% of income`;
}

function useMonthData(ym: string) {
  const { db } = useAppState();
  return useLive(async () => {
    const [entries, categories, months, funds, fundMoves, corrections, debts, recurring, settings] = await Promise.all([
      entriesInMonth(db, ym), listCategories(db), listBudget(db, 'budgetMonths'), listBudget(db, 'budgetFunds'), listBudget(db, 'budgetFundMoves'),
      listBudget(db, 'budgetCorrections'), listBudget(db, 'budgetDebts'), listBudget(db, 'budgetRecurring'), getBudgetSettings(db),
    ]);
    return { entries, categories, months, funds, fundMoves, corrections, debts, recurring, settings };
  }, [db, ym]);
}

/** A planned entry or a fund's set-aside: Confirm, or Edit amount first. */
function ConfirmRow({ rowId, name, detail, amount, onConfirm }: {
  /** The planned entry's or the fund's id, which no other row has. */
  rowId: string; name: string; detail: string; amount: number; onConfirm: (amount: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  // Checked at once, so that a second tap before the re-render confirms nothing more.
  const confirming = useRef(false);
  const run = (value: number | undefined) => {
    if (value === undefined || confirming.current) return;
    confirming.current = true;
    setBusy(true);
    onConfirm(value).catch(reportError).finally(() => { confirming.current = false; setBusy(false); });
  };
  const id = `confirm-${rowId}`.replace(/[^\w-]/g, '-');
  return (
    <li class="card budget-row">
      <div class="budget-row-head">
        <span class="budget-row-name">{name}</span>
        <span class="budget-amount">{formatMoney(amount)}</span>
      </div>
      <span class="budget-row-detail">{detail}</span>
      {editing && (
        <div class="field">
          <label for={id}>Amount for {name}</label>
          <input id={id} type="text" inputMode="decimal" value={text} onInput={(e) => setText(e.currentTarget.value)} />
        </div>
      )}
      <div class="row-actions">
        <button type="button" class="btn btn-primary btn-small" disabled={busy || (editing && typed(text) === undefined)}
          onClick={() => run(editing ? typed(text) : amount)}>Confirm</button>
        {!editing && (
          <button type="button" class="btn btn-outline btn-small" onClick={() => { setText(formatMoney(amount).replace('€', '')); setEditing(true); }}>
            Edit amount
          </button>
        )}
      </div>
    </li>
  );
}

function EntryRow({ entry, categories, onDelete }: { entry: BudgetEntry; categories: BudgetCategory[]; onDelete: () => void }) {
  const { db } = useAppState();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [faved, setFaved] = useState(false);
  const category = categories.find((c) => c.id === entry.categoryId);
  const name = entryLabel(entry, category);
  const [, month, day] = entry.date.split('-');
  const base = `entry-${entry.id}`;

  function edit() {
    setAmount(formatMoney(entry.amount).replace('€', ''));
    setCategoryId(entry.categoryId ?? '');
    setDate(entry.date);
    setNote(entry.note ?? '');
    setEditing(true);
  }

  function save() {
    const cents = typed(amount);
    if (cents === undefined || busy) return;
    setBusy(true);
    updateEntry(db, entry.id, {
      amount: cents, date, note: note.trim() === '' ? undefined : note.trim(),
      ...(entry.kind === 'expense' && categoryId !== '' && { categoryId }),
    }).then(() => setEditing(false), reportError).finally(() => setBusy(false));
  }

  function favourite() {
    if (entry.categoryId === undefined) return;
    const fav = { name: entry.note ?? category?.name ?? 'Favourite', amount: entry.amount, categoryId: entry.categoryId };
    getBudgetSettings(db).then((s) => {
      if (s.favourites.some((f) => f.name === fav.name && f.amount === fav.amount && f.categoryId === fav.categoryId)) return undefined;
      return updateBudgetSettings(db, { favourites: [...s.favourites, fav] });
    }).then(() => setFaved(true), reportError);
  }

  if (editing) {
    return (
      <li class="card budget-row">
        <form class="budget-edit" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <div class="field">
            <label for={`${base}-amount`}>Amount</label>
            <input id={`${base}-amount`} type="text" inputMode="decimal" value={amount} onInput={(e) => setAmount(e.currentTarget.value)} />
          </div>
          {entry.kind === 'expense' && (
            <div class="field">
              <label for={`${base}-cat`}>Category</label>
              <select id={`${base}-cat`} value={categoryId} onChange={(e) => setCategoryId(e.currentTarget.value)}>
                {categories.filter((c) => !c.hidden || c.id === entry.categoryId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          <div class="field">
            <label for={`${base}-date`}>Date</label>
            <input id={`${base}-date`} type="date" value={date} onInput={(e) => { if (e.currentTarget.value) setDate(e.currentTarget.value); }} />
          </div>
          <div class="field">
            <label for={`${base}-note`}>Note</label>
            <input id={`${base}-note`} type="text" maxLength={200} value={note} onInput={(e) => setNote(e.currentTarget.value)} />
          </div>
          <div class="row-actions">
            <button type="submit" class="btn btn-primary btn-small" disabled={busy || typed(amount) === undefined}>Save</button>
            <button type="button" class="btn btn-outline btn-small" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li class="card budget-row">
      <div class="budget-row-head">
        <span class="budget-row-name">{name}</span>
        <span class="budget-amount">{entry.kind === 'income' ? '+' : ''}{formatMoney(entry.amount)}</span>
      </div>
      <span class="budget-row-detail">{Number(day)}.{Number(month)}.{entry.note ? ` · ${entry.note}` : ''}</span>
      <div class="row-actions">
        <button type="button" class="btn btn-outline btn-small" onClick={edit}>Edit</button>
        <button type="button" class="btn btn-outline btn-small" onClick={onDelete}>Delete</button>
        <a class="btn btn-outline btn-small" href={`#/budget/add/same/${encodeURIComponent(entry.id)}`}>Same as last time</a>
        {entry.kind === 'expense' && entry.categoryId !== undefined && (
          <button type="button" class="btn btn-outline btn-small" disabled={faved} onClick={favourite}>
            {faved ? 'In favourites' : 'Add to favourites'}
          </button>
        )}
      </div>
    </li>
  );
}

function Notes({ ym, notes }: { ym: string; notes: string }) {
  const { db } = useAppState();
  const [text, setText] = useState(notes);
  const [status, setStatus] = useState('');
  useEffect(() => setText(notes), [notes]);
  return (
    <section class="budget-section" aria-label="Notes">
      <h3 id="month-notes-head">Notes</h3>
      <div class="field">
        <textarea aria-labelledby="month-notes-head" rows={3} maxLength={2000} value={text} onInput={(e) => { setText(e.currentTarget.value); setStatus(''); }} />
      </div>
      <div class="row-actions">
        <button type="button" class="btn btn-outline btn-small" disabled={text.trim() === notes.trim()}
          onClick={() => saveMonthNotes(db, ym, text).then(() => setStatus('Notes saved.'), reportError)}>Save notes</button>
      </div>
      <p class="live" role="status">{status}</p>
    </section>
  );
}

/**
 * `/budget/month/:ym`: a month's pots (target, spent, unused, % of income), its categories with their bands, what is
 * still to confirm (planned recurring items and fund set-asides), the Debts payments that need a debt, the entries,
 * the notes and the surplus. Opening a month up to the current one writes its planned items, once.
 */
export function MonthView() {
  const { db } = useAppState();
  const { params } = useRoute();
  const ym = params.ym ?? '';
  const valid = YM.test(ym);
  const currentYm = useCurrentYm();
  const data = useMonthData(valid ? ym : currentYm);
  const [deleting, setDeleting] = useState<BudgetEntry>();

  useEffect(() => {
    if (valid && ym <= currentYm) generatePlannedEntries(db, ym).catch(reportError);
  }, [db, ym, valid, currentYm]);

  const view = useMemo(() => {
    if (!data) return undefined;
    const plan = effectiveMonth(data.months, ym);
    const summary = summariseMonth({ month: plan, entries: data.entries, categories: data.categories, fundMoves: data.fundMoves, funds: data.funds, corrections: data.corrections });
    // Set-asides are offered in the current month only (T2 M-1): a past month's is no longer to be done, a later one not yet.
    const setAsides = ym === currentYm
      ? plannedItemsFor(ym, { recurring: [], funds: data.funds, fundMoves: data.fundMoves, existing: [], debts: [], debtBalances: {}, corrections: data.corrections }).setAsides
      : [];
    const { unassignedDebtPayments } = balancesByMonth({
      entries: data.entries, corrections: [], debts: data.debts, assets: [], categories: data.categories, fundMoves: [], funds: [],
      recurring: data.recurring, fromYm: ym, toYm: ym,
    });
    return { plan, summary, setAsides, unassigned: unassignedDebtPayments.filter((u) => u.ym === ym) };
  }, [data, ym, currentYm]);

  if (!valid) return <BudgetFrame title="Month"><p class="empty">There is no such month.</p></BudgetFrame>;
  const title = monthLabel(ym);
  if (!data || !view) return <BudgetFrame title={title}><p class="live" role="status">Loading…</p></BudgetFrame>;

  const { summary, setAsides, unassigned, plan } = view;
  const categoryName = new Map(data.categories.map((c) => [c.id, c.name]));
  const fundsById = new Map<string, BudgetFund>(data.funds.map((f) => [f.id, f]));
  const planned = data.entries.filter((e) => e.status === 'planned').sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const actual = data.entries.filter((e) => e.status === 'actual').sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1));
  const warning = monthTargetsWarning(summary, plan);
  const shownCategories = summary.categories.filter((c) => c.spent !== 0 || c.target !== undefined);
  const unassignedEntries = unassigned.map((u) => data.entries.find((e) => e.id === u.entryId)).filter((e): e is BudgetEntry => e !== undefined);
  const dayOf = (date: string) => { const [, m, d] = date.split('-'); return `${Number(d)}.${Number(m)}.`; };

  return (
    <BudgetFrame title={title}>
      <p class="budget-months no-print">
        <a href={`#/budget/month/${addMonths(ym, -1)}`}>← {monthLabel(addMonths(ym, -1))}</a>
        <a href={`#/budget/month/${addMonths(ym, 1)}`}>{monthLabel(addMonths(ym, 1))} →</a>
      </p>
      <p class="budget-months no-print">
        <a class="btn btn-outline" href="#/budget/add/income">+ Income</a>
      </p>
      {warning && <p class="field-warning budget-warning">{warning}</p>}
      <p class="budget-income">
        Planned income {formatMoney(summary.plannedIncome)} · Received {formatMoney(summary.actualIncome)}
      </p>

      <div class="budget-pots">
        {summary.pots.map((p) => {
          const label = POTS.find((x) => x.id === p.pot)!.label;
          return (
            <section key={p.pot} class="card budget-pot" aria-label={label}>
              <h3>{label}</h3>
              <ul class="budget-figures">
                <li>Target {formatMoney(p.target)} ({pctText(p.targetPct)})</li>
                <li>Spent {formatMoney(p.spent)} ({pctText(p.spentPct)})</li>
                <li class={p.unused < 0 ? 'budget-over' : undefined}>{p.unused < 0 ? 'Over' : 'Unused'} {formatMoney(p.unused < 0 ? -p.unused : p.unused)}</li>
                <li>Planned {formatMoney(p.planned)}</li>
              </ul>
            </section>
          );
        })}
      </div>
      <p class="budget-surplus">
        {summary.surplus < 0 ? `Overspent ${formatMoney(-summary.surplus)}` : `Surplus ${formatMoney(summary.surplus)}`}
      </p>

      <section class="budget-section" aria-label="Items to confirm">
        <h3>To confirm</h3>
        {planned.length === 0 && setAsides.length === 0 ? (
          <p class="empty">{ym > currentYm ? 'Planned items appear when the month starts.' : 'Nothing to confirm.'}</p>
        ) : (
          <ul class="budget-list" aria-label="To confirm">
            {planned.map((e) => (
              <ConfirmRow
                key={e.id} rowId={e.id} name={e.note ?? categoryName.get(e.categoryId ?? '') ?? 'Planned'} amount={e.amount}
                detail={`${dayOf(e.date)} · ${entryLabel(e, data.categories.find((c) => c.id === e.categoryId))}`}
                onConfirm={(amount) => updateEntry(db, e.id, { status: 'actual', amount }).then(() => undefined)}
              />
            ))}
            {setAsides.map((s) => {
              const fund = fundsById.get(s.fundId);
              return (
                <ConfirmRow
                  key={s.fundId} rowId={`fund-${s.fundId}`} name={fund?.name ?? 'Fund'} amount={s.amount}
                  detail={`Set aside for ${fund ? monthLabel(fund.dueYm) : 'the bill'}`}
                  onConfirm={(amount) => confirmSetAside(db, s.fundId, ym, amount).then(() => undefined)}
                />
              );
            })}
          </ul>
        )}
      </section>

      {unassignedEntries.length > 0 && (
        <section class="budget-section" aria-label="Which debt?">
          <h3>Which debt?</h3>
          <ul class="budget-list">
            {unassignedEntries.map((e) => (
              <li key={e.id} class="card budget-row">
                <div class="field">
                  <label for={`debt-${e.id}`}>Which debt did {formatMoney(e.amount)} on {dayOf(e.date)} pay?</label>
                  <select id={`debt-${e.id}`} value="" onChange={(ev) => {
                    const debtId = ev.currentTarget.value;
                    if (debtId !== '') updateEntry(db, e.id, { debtId }).catch(reportError);
                  }}>
                    <option value="">Choose…</option>
                    {data.debts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section class="budget-section" aria-label="Categories">
        <h3>Categories</h3>
        {shownCategories.length === 0 ? <p class="empty">No spending yet.</p> : (
          <ul class="budget-list budget-cats">
            {shownCategories.map((c) => (
              <li key={c.categoryId} class="budget-cat">
                <span class="budget-row-name">{categoryName.get(c.categoryId)}</span>
                <span class="budget-amount">{formatMoney(c.spent)}{c.target !== undefined ? ` of ${formatMoney(c.target)}` : ''}</span>
                {BAND_TEXT[c.band] && <span class="status" data-tone={BAND_TONE[c.band]} data-band={c.band}>{BAND_TEXT[c.band]}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section class="budget-section" aria-label="Entries of the month">
        <h3>Entries</h3>
        {actual.length === 0 ? <p class="empty">No entries yet.</p> : (
          <ul class="budget-list" aria-label="Entries">
            {actual.map((e) => <EntryRow key={e.id} entry={e} categories={data.categories} onDelete={() => setDeleting(e)} />)}
          </ul>
        )}
      </section>

      <Notes ym={ym} notes={plan.notes ?? ''} />

      {deleting && (
        <ConfirmDialog
          title="Delete entry?" confirmLabel="Delete" danger
          body={<p>{formatMoney(deleting.amount)} on {dayOf(deleting.date)} is deleted.</p>}
          onCancel={() => setDeleting(undefined)}
          onConfirm={() => { const id = deleting.id; setDeleting(undefined); deleteBudgetRecord(db, 'budgetEntries', id).catch(reportError); }}
        />
      )}
    </BudgetFrame>
  );
}

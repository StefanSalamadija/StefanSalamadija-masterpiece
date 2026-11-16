import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useAppState } from '../../../app/AppState';
import { reportError } from '../../../app/errors';
import { navigate } from '../../../app/router';
import { POTS } from '../../../budget/catalog';
import { formatMoney, parseMoney } from '../../../budget/money';
import { ymOf } from '../../../budget/months';
import { parseShorthand } from '../../../budget/shorthand';
import { addEntry, getBudgetSettings, listBudget, listCategories, undoEntry } from '../../../db/budget';
import { addDays } from '../../../domain/dates';
import type { BudgetCategory, BudgetEntry } from '../../../domain/types';
import { useLive } from '../../useLive';
import { BudgetFrame } from './Frame';
import { dateChips, lastExpense, padPress, padText, topCategories } from './quickAddView';
import { offerUndo } from './undoToast';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'back'];

/** How far back quick add looks for the categories used most and the last expense. */
const LOOKBACK_DAYS = 90;

/** The amount the pad's text stands for, in cents, when it is one above zero. A trailing comma (`12,`) reads as `12`. */
function amountOf(text: string): number | undefined {
  const value = parseMoney(text.replace(/,$/, ''));
  return typeof value === 'number' && value > 0 ? value : undefined;
}

function useQuickAddData() {
  const { db, shipToday } = useAppState();
  return useLive(async () => {
    const from = addDays(shipToday, -LOOKBACK_DAYS);
    const [categories, settings, debts, recent] = await Promise.all([
      listCategories(db), getBudgetSettings(db), listBudget(db, 'budgetDebts'),
      db.budgetEntries.where('date').aboveOrEqual(from).filter((e) => !e.deleted).toArray(),
    ]);
    return { categories, favourites: settings.favourites, debts, recent };
  }, [db, shipToday]);
}

/**
 * The quick entry of an expense: favourites, the typed shorthand line, the amount pad, the category grid (the 6 most
 * used first), the date chips and an optional note, then Save. Save is off while it saves, so a double tap writes one
 * entry; the Undo toast then removes exactly that entry. `onSaved` says what comes next.
 */
export function EntryPad({ onSaved, onUndone }: { onSaved: (entry: BudgetEntry, category: BudgetCategory) => void; onUndone?: (id: string) => void }) {
  const { db, shipToday } = useAppState();
  const data = useQuickAddData();
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState<string>();
  const [date, setDate] = useState(shipToday);
  const [picking, setPicking] = useState(false);
  const [note, setNote] = useState('');
  const [shorthand, setShorthand] = useState('');
  const [debtId, setDebtId] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const preselected = useRef(false);

  const top = useMemo(() => (data ? topCategories(data.categories, data.recent, shipToday) : []), [data, shipToday]);
  const last = useMemo(() => (data ? lastExpense(data.recent) : undefined), [data]);
  const shown = useMemo(() => data?.categories.filter((c) => !c.hidden) ?? [], [data]);
  const byId = useMemo(() => new Map(data?.categories.map((c) => [c.id, c]) ?? []), [data]);

  // The last category used is chosen to begin with (base §3.4).
  useEffect(() => {
    if (!data || preselected.current) return;
    preselected.current = true;
    if (last?.categoryId !== undefined && byId.get(last.categoryId)?.hidden === false) setCategoryId((id) => id ?? last.categoryId);
  }, [data]);

  const category = categoryId !== undefined ? byId.get(categoryId) : undefined;
  const debts = data?.debts ?? [];
  const asksDebt = category?.pot === 'debts' && debts.length >= 2;
  const cents = amountOf(amount);
  const canSave = data !== undefined && cents !== undefined && category !== undefined && (!asksDebt || debtId !== '');

  function fill(c: number | undefined, id: string | undefined, text?: string) {
    setAmount(c === undefined ? '' : padText(c));
    setCategoryId(id);
    if (text !== undefined) setNote(text);
  }

  function typeShorthand(text: string) {
    setShorthand(text);
    const parsed = parseShorthand(text, data?.categories ?? []);
    fill(parsed.amount, parsed.categoryId, parsed.note ?? '');
  }

  async function save() {
    if (saving.current || !canSave || cents === undefined || !category) return;
    saving.current = true;
    setBusy(true);
    try {
      const debt = category.pot !== 'debts' ? undefined : asksDebt ? debtId : debts.length === 1 ? debts[0].id : undefined;
      const entry = await addEntry(db, {
        kind: 'expense', date, amount: cents, categoryId: category.id, status: 'actual',
        ...(note.trim() !== '' && { note: note.trim() }), ...(debt !== undefined && { debtId: debt }),
      });
      offerUndo(`Saved ${formatMoney(entry.amount)} to ${category.name}.`, async () => {
        await undoEntry(db, entry.id);
        onUndone?.(entry.id);
      });
      setAmount(''); setNote(''); setShorthand(''); setCategoryId(undefined); setDebtId('');
      onSaved(entry, category);
    } catch (err) {
      reportError(err);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  if (!data) return <p class="live" role="status">Loading…</p>;
  const rest = shown.filter((c) => !top.some((t) => t.id === c.id));
  const chips = dateChips(shipToday);
  const chipDate = chips.find((c) => c.date === date && !picking);

  const categoryButton = (c: BudgetCategory) => (
    <button key={c.id} type="button" class="qa-cat" aria-pressed={c.id === categoryId ? 'true' : 'false'} onClick={() => setCategoryId(c.id)}>
      {c.name}
    </button>
  );

  return (
    <form class="quick-add" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div class="qa-row">
        {last && last.categoryId !== undefined && byId.has(last.categoryId) && (
          <button type="button" class="chip qa-chip" onClick={() => fill(last.amount, last.categoryId)}>Repeat last</button>
        )}
        {data.favourites.filter((f) => byId.has(f.categoryId)).map((f, i) => (
          <button key={`${f.name}-${i}`} type="button" class="chip qa-chip" onClick={() => fill(f.amount, f.categoryId, f.name)}>
            {f.name} {formatMoney(f.amount)}
          </button>
        ))}
      </div>

      <div class="field">
        <label for="qa-shorthand">Type it</label>
        <input
          id="qa-shorthand" type="text" autocomplete="off" placeholder="e.g. 12,5 groceries lidl" value={shorthand}
          onInput={(e) => typeShorthand(e.currentTarget.value)}
        />
      </div>

      <div class="field qa-amount">
        <label for="qa-amount">Amount</label>
        <input
          id="qa-amount" type="text" inputMode="none" autocomplete="off" placeholder="0" value={amount}
          onInput={(e) => setAmount(e.currentTarget.value.replace(/[^\d.,]/g, ''))}
        />
      </div>
      <div class="qa-pad" role="group" aria-label="Amount pad">
        {KEYS.map((k) => (
          <button
            key={k} type="button" class="qa-key" aria-label={k === 'back' ? 'Delete last digit' : undefined}
            onClick={() => setAmount((text) => padPress(text, k))}
          >
            {k === 'back' ? '⌫' : k}
          </button>
        ))}
      </div>

      <div class="qa-categories" role="group" aria-label="Category">
        <div class="qa-grid">{top.map(categoryButton)}</div>
        {rest.length > 0 && (
          <details class="qa-more">
            <summary>More categories</summary>
            {POTS.map((pot) => {
              const inPot = rest.filter((c) => c.pot === pot.id);
              if (inPot.length === 0) return null;
              return (
                <div key={pot.id} class="qa-pot">
                  <h3>{pot.label}</h3>
                  <div class="qa-grid">{inPot.map(categoryButton)}</div>
                </div>
              );
            })}
          </details>
        )}
      </div>
      {category && !top.some((t) => t.id === category.id) && <p class="qa-chosen">Category: {category.name}</p>}

      {asksDebt && (
        <div class="field">
          <label for="qa-debt">Which debt?</label>
          <select id="qa-debt" value={debtId} onChange={(e) => setDebtId(e.currentTarget.value)}>
            <option value="">Choose…</option>
            {debts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
      )}

      <div class="qa-row" role="group" aria-label="Date">
        {chips.map((c) => (
          <button
            key={c.label} type="button" class="chip qa-chip" aria-pressed={chipDate?.label === c.label ? 'true' : 'false'}
            onClick={() => { setPicking(false); setDate(c.date); }}
          >
            {c.label}
          </button>
        ))}
        <button type="button" class="chip qa-chip" aria-pressed={chipDate ? 'false' : 'true'} onClick={() => setPicking(true)}>Pick</button>
      </div>
      {(picking || !chipDate) && (
        <div class="field">
          <label for="qa-date">Date</label>
          <input id="qa-date" type="date" value={date} max={shipToday} onInput={(e) => { if (e.currentTarget.value) setDate(e.currentTarget.value); }} />
        </div>
      )}

      <div class="field">
        <label for="qa-note">Note</label>
        <input id="qa-note" type="text" maxLength={200} value={note} onInput={(e) => setNote(e.currentTarget.value)} />
      </div>

      <button type="submit" class="btn btn-primary btn-large qa-save" disabled={!canSave || busy}>Save</button>
    </form>
  );
}

/** `/budget/add`: quick add. Save goes on to the month the expense went into, where the Undo toast stays up. */
export function QuickAdd() {
  return (
    <BudgetFrame title="Add expense" addButton={false}>
      <p class="qa-links"><a href="#/budget/catch-up">Catch up</a> — several entries in a row</p>
      <EntryPad onSaved={(entry) => navigate(`/budget/month/${ymOf(entry.date)}`)} />
    </BudgetFrame>
  );
}

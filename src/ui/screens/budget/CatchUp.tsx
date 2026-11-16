import { useState } from 'preact/hooks';
import { formatMoney } from '../../../budget/money';
import type { BudgetEntry } from '../../../domain/types';
import { BudgetFrame } from './Frame';
import { EntryPad } from './QuickAdd';

interface Added { id: string; text: string }

function dayText(date: string): string {
  const [, month, day] = date.split('-');
  return `${Number(day)}.${Number(month)}.`;
}

/**
 * `/budget/catch-up`: after days without entering (common onboard), several entries in a row. Each Save stays on the
 * pad, ready for the next, and the entries added so far are listed (one undone with the toast leaves the list).
 */
export function CatchUp() {
  const [added, setAdded] = useState<Added[]>([]);
  const onSaved = (entry: BudgetEntry, label: string) =>
    setAdded((list) => [{ id: entry.id, text: `${dayText(entry.date)} ${label} ${entry.kind === 'income' ? '+' : ''}${formatMoney(entry.amount)}` }, ...list]);
  const onUndone = (id: string) => setAdded((list) => list.filter((a) => a.id !== id));
  return (
    <BudgetFrame title="Catch up" addButton={false}>
      <p class="qa-links">Enter each expense with its day; the pad stays open for the next one.</p>
      <EntryPad onSaved={onSaved} onUndone={onUndone} />
      <section class="budget-section" aria-label="Added so far">
        <h3>Added</h3>
        {added.length === 0 ? <p class="empty">Nothing added yet.</p> : (
          <ul class="budget-list" aria-label="Added">
            {added.map((a) => <li key={a.id} class="card">{a.text}</li>)}
          </ul>
        )}
      </section>
    </BudgetFrame>
  );
}

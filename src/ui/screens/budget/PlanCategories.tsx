import { useState } from 'preact/hooks';
import { useAppState } from '../../../app/AppState';
import { POTS } from '../../../budget/catalog';
import { createBudgetRecord, updateBudgetRecord } from '../../../db/budget';
import type { BudgetCategory, PotId } from '../../../domain/types';
import { SelectField, TextField, useBusy } from './planKit';
import type { PlanData } from './planKit';

/** `dog, vet ` → `['dog', 'vet']`. */
function synonymsOf(text: string): string[] {
  return [...new Set(text.split(',').map((s) => s.trim()).filter((s) => s !== ''))];
}

function nextOrder(categories: BudgetCategory[]): number {
  return categories.reduce((max, c) => Math.max(max, c.order), -1) + 1;
}

function EditCategory({ category, onDone }: { category: BudgetCategory; onDone: () => void }) {
  const { db } = useAppState();
  const [name, setName] = useState(category.name);
  const [group, setGroup] = useState(category.group ?? '');
  const [synonyms, setSynonyms] = useState((category.synonyms ?? []).join(', '));
  const [busy, run] = useBusy();
  const save = () => {
    if (name.trim() === '') return;
    const words = synonymsOf(synonyms);
    run(() => updateBudgetRecord(db, 'budgetCategories', category.id, {
      name: name.trim(), group: group.trim() === '' ? undefined : group.trim(), synonyms: words.length === 0 ? undefined : words,
    }), onDone);
  };
  return (
    <form class="budget-edit" aria-label={`Edit ${category.name}`} onSubmit={(e) => { e.preventDefault(); save(); }}>
      <TextField label="Name" value={name} onInput={setName} error={name.trim() === '' ? 'A category needs a name.' : undefined} />
      <TextField label="Group" value={group} onInput={setGroup} hint="A heading for it, such as Housing (optional)." />
      <TextField label="Other words for it" value={synonyms} onInput={setSynonyms} maxLength={300}
        hint="Words the typed shorthand knows it by, split by commas." />
      <div class="row-actions">
        <button type="submit" class="btn btn-primary btn-small" disabled={busy || name.trim() === ''}>Save</button>
        <button type="button" class="btn btn-outline btn-small" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

function CategoryRow({ category, siblings, all }: { category: BudgetCategory; siblings: BudgetCategory[]; all: BudgetCategory[] }) {
  const { db } = useAppState();
  const [editing, setEditing] = useState(false);
  const [busy, run] = useBusy();
  const at = siblings.indexOf(category);
  /** Swaps the order with the neighbour `by` places away in the same pot. */
  const move = (by: number) => {
    const other = siblings[at + by];
    if (!other) return;
    run(async () => {
      await updateBudgetRecord(db, 'budgetCategories', category.id, { order: other.order });
      await updateBudgetRecord(db, 'budgetCategories', other.id, { order: category.order });
    });
  };
  const toPot = (pot: PotId) => {
    if (pot === category.pot) return;
    run(() => updateBudgetRecord(db, 'budgetCategories', category.id, {
      pot, order: nextOrder(all), group: pot === 'needs' ? category.group : undefined,
    }));
  };
  if (editing) return <li class="card budget-row"><EditCategory category={category} onDone={() => setEditing(false)} /></li>;
  const detail = [category.group, category.synonyms?.length ? `Also: ${category.synonyms.join(', ')}` : undefined].filter(Boolean).join(' · ');
  return (
    <li class="card budget-row">
      <div class="budget-row-head">
        <span class="budget-row-name">{category.name}</span>
        {category.hidden && <span class="badge">Hidden</span>}
      </div>
      {detail !== '' && <span class="budget-row-detail">{detail}</span>}
      <div class="row-actions">
        <button type="button" class="btn btn-outline btn-small" disabled={busy || at === 0} onClick={() => move(-1)}>Up</button>
        <button type="button" class="btn btn-outline btn-small" disabled={busy || at === siblings.length - 1} onClick={() => move(1)}>Down</button>
        <button type="button" class="btn btn-outline btn-small" onClick={() => setEditing(true)}>Edit</button>
        <button type="button" class="btn btn-outline btn-small" disabled={busy}
          onClick={() => run(() => updateBudgetRecord(db, 'budgetCategories', category.id, { hidden: !category.hidden }))}>
          {category.hidden ? 'Show' : 'Hide'}
        </button>
      </div>
      <div class="field">
        <select aria-label={`Move ${category.name} to`} value={category.pot} disabled={busy} onChange={(e) => toPot(e.currentTarget.value as PotId)}>
          {POTS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </div>
    </li>
  );
}

function NewCategory({ categories }: { categories: BudgetCategory[] }) {
  const { db } = useAppState();
  const [name, setName] = useState('');
  const [pot, setPot] = useState<PotId>('needs');
  const [group, setGroup] = useState('');
  const [busy, run] = useBusy();
  return (
    <form class="card budget-edit" aria-label="New category" onSubmit={(e) => {
      e.preventDefault();
      if (name.trim() === '') return;
      run(() => createBudgetRecord(db, 'budgetCategories', {
        pot, name: name.trim(), order: nextOrder(categories), hidden: false, ...(group.trim() !== '' && { group: group.trim() }),
      }), () => { setName(''); setGroup(''); });
    }}>
      <h3>New category</h3>
      <TextField label="Name" value={name} onInput={setName} />
      <SelectField label="Pot" value={pot} onChange={(v) => setPot(v as PotId)}>
        {POTS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </SelectField>
      <TextField label="Group" value={group} onInput={setGroup} hint="Optional, such as Housing." />
      <div class="row-actions">
        <button type="submit" class="btn btn-primary btn-small" disabled={busy || name.trim() === ''}>Add category</button>
      </div>
    </form>
  );
}

/**
 * Plan → Categories (base §3.3): the categories of each pot, in their order. Each can be renamed (with its group and the
 * other words the shorthand knows it by), hidden (it is kept, for its history), moved up or down, or moved to another
 * pot. Categories are never deleted here.
 */
export function PlanCategories({ data }: { data: PlanData }) {
  return (
    <>
      <NewCategory categories={data.categories} />
      {POTS.map((p) => {
        const inPot = data.categories.filter((c) => c.pot === p.id);
        return (
          <section key={p.id} class="budget-section" aria-label={`${p.label} categories`}>
            <h3>{p.label}</h3>
            {inPot.length === 0 ? <p class="empty">No categories.</p> : (
              <ul class="budget-list" aria-label={p.label}>
                {inPot.map((c) => <CategoryRow key={c.id} category={c} siblings={inPot} all={data.categories} />)}
              </ul>
            )}
          </section>
        );
      })}
    </>
  );
}

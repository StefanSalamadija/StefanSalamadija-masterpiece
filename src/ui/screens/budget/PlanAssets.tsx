import { useEffect, useState } from 'preact/hooks';
import { useAppState } from '../../../app/AppState';
import { correctionChanges } from '../../../budget/corrections';
import { formatMoney } from '../../../budget/money';
import { createBudgetRecord, deleteBudgetRecord, updateBudgetRecord } from '../../../db/budget';
import type { MasterpieceDB } from '../../../db/schema';
import type { BudgetAsset, BudgetCorrection, Cents, Ym } from '../../../domain/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useCurrentYm } from './Frame';
import { AMOUNT_ERROR, TextField, balancesAt, inputText, typedMoney, useBusy } from './planKit';
import type { PlanData } from './planKit';

/** Sets an asset's value at the end of `ym`: a correction of it (its value is only ever its corrections, less sales). */
async function saveValue(db: MasterpieceDB, corrections: BudgetCorrection[], assetId: string, ym: Ym, value: Cents): Promise<void> {
  const { create, update } = correctionChanges(corrections, ym, { [`asset:${assetId}`]: value });
  for (const c of create) await createBudgetRecord(db, 'budgetCorrections', c);
  for (const u of update) await updateBudgetRecord(db, 'budgetCorrections', u.id, { balance: u.balance });
}

function AssetRow({ asset, data, value, onDelete }: { asset: BudgetAsset; data: PlanData; value: Cents; onDelete: () => void }) {
  const { db } = useAppState();
  const currentYm = useCurrentYm();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(asset.name);
  const [text, setText] = useState('');
  const [busy, run] = useBusy();
  // Shown at once, as tapped, while the change is saved.
  const [include, setInclude] = useState(asset.includeInNetWorth);
  useEffect(() => setInclude(asset.includeInNetWorth), [asset.includeInNetWorth]);
  const cents = typedMoney(text);
  if (editing) {
    return (
      <li class="card budget-row">
        <form class="budget-edit" aria-label={`Edit ${asset.name}`} onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() === '' || typeof cents !== 'number') return;
          run(async () => {
            if (name.trim() !== asset.name) await updateBudgetRecord(db, 'budgetAssets', asset.id, { name: name.trim() });
            if (cents !== value) await saveValue(db, data.corrections, asset.id, currentYm, cents);
          }, () => setEditing(false));
        }}>
          <TextField label="Name" value={name} onInput={setName} />
          <TextField label="Value" value={text} onInput={setText} inputMode="decimal" hint="Its value now: kept as this month's correction."
            error={cents === 'invalid' ? AMOUNT_ERROR : undefined} />
          <div class="row-actions">
            <button type="submit" class="btn btn-primary btn-small" disabled={busy || name.trim() === '' || typeof cents !== 'number'}>Save</button>
            <button type="button" class="btn btn-outline btn-small" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      </li>
    );
  }
  return (
    <li class="card budget-row">
      <div class="budget-row-head">
        <span class="budget-row-name">{asset.name}</span>
        <span class="budget-amount">{formatMoney(value)}</span>
      </div>
      <label class="check">
        <input type="checkbox" checked={include}
          onChange={(e) => {
            const value = e.currentTarget.checked;
            setInclude(value);
            run(() => updateBudgetRecord(db, 'budgetAssets', asset.id, { includeInNetWorth: value }));
          }} />
        In net worth
      </label>
      <div class="row-actions">
        <button type="button" class="btn btn-outline btn-small" onClick={() => { setName(asset.name); setText(inputText(value)); setEditing(true); }}>Edit</button>
        <button type="button" class="btn btn-outline btn-small" onClick={onDelete}>Delete</button>
      </div>
    </li>
  );
}

function NewAsset({ data }: { data: PlanData }) {
  const { db } = useAppState();
  const currentYm = useCurrentYm();
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [include, setInclude] = useState(true);
  const [busy, run] = useBusy();
  const cents = typedMoney(text);
  const ok = name.trim() !== '' && typeof cents === 'number';
  return (
    <form class="card budget-edit" aria-label="New asset" onSubmit={(e) => {
      e.preventDefault();
      if (!ok) return;
      run(async () => {
        const asset = await createBudgetRecord(db, 'budgetAssets', { name: name.trim(), includeInNetWorth: include });
        await saveValue(db, data.corrections, asset.id, currentYm, cents as number);
      }, () => { setName(''); setText(''); setInclude(true); });
    }}>
      <h3>New asset</h3>
      <TextField label="Name" value={name} onInput={setName} hint="Such as a flat or a car." />
      <TextField label="Value" value={text} onInput={setText} inputMode="decimal" error={cents === 'invalid' ? AMOUNT_ERROR : undefined} />
      <label class="check">
        <input type="checkbox" checked={include} onChange={(e) => setInclude(e.currentTarget.checked)} />
        Count it in the net worth
      </label>
      <div class="row-actions">
        <button type="submit" class="btn btn-primary btn-small" disabled={busy || !ok}>Add asset</button>
      </div>
    </form>
  );
}

/**
 * Plan → Assets (v2 §3.4): other things you own, each with its value now (a correction this month, as every later
 * value is) and whether it counts in the net worth. A sale entered as income lowers it.
 */
export function PlanAssets({ data }: { data: PlanData }) {
  const { db } = useAppState();
  const currentYm = useCurrentYm();
  const [deleting, setDeleting] = useState<BudgetAsset>();
  const [, run] = useBusy();
  const balances: Partial<Record<string, number>> = data.assets.length > 0 ? balancesAt(data, currentYm) : {};
  return (
    <>
      <NewAsset data={data} />
      <section class="budget-section" aria-label="Your assets">
        <h3>Assets</h3>
        {data.assets.length === 0 ? <p class="empty">No assets yet.</p> : (
          <ul class="budget-list" aria-label="Assets">
            {data.assets.map((a) => (
              <AssetRow key={a.id} asset={a} data={data} value={balances[`asset:${a.id}`] ?? 0} onDelete={() => setDeleting(a)} />
            ))}
          </ul>
        )}
      </section>
      {deleting && (
        <ConfirmDialog
          title="Delete asset?" confirmLabel="Delete" danger body={<p>{deleting.name} is no longer in the net worth.</p>}
          onCancel={() => setDeleting(undefined)}
          onConfirm={() => { const id = deleting.id; setDeleting(undefined); run(() => deleteBudgetRecord(db, 'budgetAssets', id)); }}
        />
      )}
    </>
  );
}

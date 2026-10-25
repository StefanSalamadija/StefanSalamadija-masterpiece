import { useState } from 'preact/hooks';
import { useAppState } from '../../app/AppState';
import { reportError } from '../../app/errors';
import { updateRecord } from '../../db/records';
import { validateParticulars } from '../../domain/validation';
import type { FieldError, Particulars as ParticularsData, ShipProfile } from '../../domain/types';
import { Field } from '../components/Field';

type TextKey = 'name' | 'imo' | 'callSign' | 'mmsi' | 'flag' | 'portOfRegistry' | 'owners' | 'managers' | 'pandi' | 'classSociety';
type NumberKey = 'gt' | 'nt' | 'dwt' | 'loa' | 'beam' | 'yearBuilt';
/** What is typed in the form: every field as text, numbers included. */
type Draft = Record<TextKey | NumberKey, string>;

const SECTIONS: { title: string; fields: { key: keyof Draft; label: string; numeric?: boolean }[] }[] = [
  {
    title: 'Identity',
    fields: [
      { key: 'name', label: 'Ship name' },
      { key: 'imo', label: 'IMO number' },
      { key: 'callSign', label: 'Call sign' },
      { key: 'mmsi', label: 'MMSI' },
      { key: 'flag', label: 'Flag' },
      { key: 'portOfRegistry', label: 'Port of registry' },
    ],
  },
  {
    title: 'Dimensions',
    fields: [
      { key: 'gt', label: 'GT', numeric: true },
      { key: 'nt', label: 'NT', numeric: true },
      { key: 'dwt', label: 'DWT (summer)', numeric: true },
      { key: 'loa', label: 'LOA (m)', numeric: true },
      { key: 'beam', label: 'Beam (m)', numeric: true },
      { key: 'yearBuilt', label: 'Year built', numeric: true },
    ],
  },
  {
    title: 'Companies',
    fields: [
      { key: 'owners', label: 'Owners' },
      { key: 'managers', label: 'Managers (ISM company)' },
      { key: 'pandi', label: 'P&I club' },
      { key: 'classSociety', label: 'Classification society' },
    ],
  },
];

const NUMBER_KEYS: readonly NumberKey[] = ['gt', 'nt', 'dwt', 'loa', 'beam', 'yearBuilt'];

function toDraft(p: ParticularsData): Draft {
  return {
    name: p.name, imo: p.imo, callSign: p.callSign, mmsi: p.mmsi, flag: p.flag, portOfRegistry: p.portOfRegistry,
    gt: String(p.gt ?? ''), nt: String(p.nt ?? ''), dwt: String(p.dwt ?? ''), loa: String(p.loa ?? ''),
    beam: String(p.beam ?? ''), yearBuilt: String(p.yearBuilt ?? ''),
    owners: p.owners, managers: p.managers, pandi: p.pandi, classSociety: p.classSociety,
  };
}

/**
 * The stored form of a draft, merged into `base` so that anything else kept in the particulars survives. Text is
 * trimmed. A number is stored as a number; an empty one is left out, and a non-numeric one becomes NaN, which the
 * validation rejects.
 */
function applyDraft(base: ParticularsData, draft: Draft): ParticularsData {
  const next: ParticularsData = {
    ...base,
    name: draft.name.trim(), imo: draft.imo.trim(), callSign: draft.callSign.trim(), mmsi: draft.mmsi.trim(),
    flag: draft.flag.trim(), portOfRegistry: draft.portOfRegistry.trim(), owners: draft.owners.trim(),
    managers: draft.managers.trim(), pandi: draft.pandi.trim(), classSociety: draft.classSociety.trim(),
  };
  for (const key of NUMBER_KEYS) {
    const text = draft[key].trim();
    if (text === '') delete next[key];
    else next[key] = Number(text);
  }
  return next;
}

/** The first problem for each field; an error wins over a warning. */
function problemsByField(errors: FieldError[]): Map<string, FieldError> {
  const byField = new Map<string, FieldError>();
  for (const error of errors) {
    const known = byField.get(error.field);
    if (!known || (known.severity === 'warning' && error.severity === 'error')) byField.set(error.field, error);
  }
  return byField;
}

function ParticularsForm({ ship }: { ship: ShipProfile }) {
  const { db } = useAppState();
  const [draft, setDraft] = useState(() => toDraft(ship.particulars));
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const candidate = applyDraft(ship.particulars, draft);
  // Validation owns the numbers and the IMO/MMSI; a ship must have a name, and that is checked only here.
  const errors = validateParticulars(candidate);
  if (candidate.name === '') errors.unshift({ field: 'name', severity: 'error', message: 'Ship name is required.' });
  const problems = problemsByField(errors);
  const blocked = errors.some((error) => error.severity === 'error');

  function edit(key: keyof Draft, value: string): void {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }

  async function save(event: Event): Promise<void> {
    event.preventDefault();
    if (blocked || busy) return;
    setBusy(true);
    try {
      await updateRecord<ShipProfile>(db, 'ships', ship.id, { particulars: candidate });
      setSaved(true);
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form class="particulars-form" onSubmit={save} noValidate>
      {SECTIONS.map((section) => (
        <div key={section.title} class="form-section">
          <h3>{section.title}</h3>
          <div class="form-grid">
            {section.fields.map(({ key, label, numeric }) => (
              <Field
                key={key} label={label} type={numeric ? 'number' : 'text'} value={draft[key]}
                error={problems.get(key)} onInput={(value) => edit(key, value)}
              />
            ))}
          </div>
        </div>
      ))}
      <div class="form-actions">
        <button type="submit" class="btn btn-primary" disabled={blocked || busy}>Save</button>
        <p class="save-status" role="status">{saved ? 'Saved' : ''}</p>
      </div>
    </form>
  );
}

/** The active ship's particulars: edited as a draft, saved with the Save button. */
export function Particulars() {
  const { activeShip } = useAppState();
  if (!activeShip) return null;
  // Keyed by ship, so switching ships starts a fresh draft instead of carrying edits across.
  return (
    <section class="screen">
      <h2>Vessel particulars</h2>
      <ParticularsForm key={activeShip.id} ship={activeShip} />
    </section>
  );
}

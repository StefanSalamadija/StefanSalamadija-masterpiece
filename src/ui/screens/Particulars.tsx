import { useState } from 'preact/hooks';
import { useAppState } from '../../app/AppState';
import { reportError } from '../../app/errors';
import { updateRecord } from '../../db/records';
import { looksLikeThousands, parseDecimal } from '../../domain/numbers';
import { validateParticulars } from '../../domain/validation';
import type { FieldError, Particulars as ParticularsData, ShipProfile } from '../../domain/types';
import { Field } from '../components/Field';
import { SHIP_NAME_REQUIRED } from '../messages';

type TextKey = 'name' | 'imo' | 'callSign' | 'mmsi' | 'flag' | 'portOfRegistry' | 'owners' | 'managers' | 'pandi' | 'classSociety';
type DimensionKey = 'gt' | 'nt' | 'dwt' | 'loa' | 'beam';
/** What is typed in the form: every field as text, numbers included. */
type Draft = Record<TextKey | DimensionKey | 'yearBuilt', string>;

const NUMBER_ERROR = 'Enter a number, e.g. 229.5.';
const THOUSANDS_ERROR = 'Enter the number without thousands separators, e.g. 32500.';
const YEAR_ERROR = 'Enter a year, e.g. 2012.';
const FIRST_YEAR = 1900;

const SECTIONS: { title: string; fields: { key: keyof Draft; label: string; inputMode?: 'decimal' | 'numeric' }[] }[] = [
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
      { key: 'gt', label: 'GT', inputMode: 'decimal' },
      { key: 'nt', label: 'NT', inputMode: 'decimal' },
      { key: 'dwt', label: 'DWT (summer)', inputMode: 'decimal' },
      { key: 'loa', label: 'LOA (m)', inputMode: 'decimal' },
      { key: 'beam', label: 'Beam (m)', inputMode: 'decimal' },
      { key: 'yearBuilt', label: 'Year built', inputMode: 'numeric' },
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

const DIMENSION_KEYS: readonly DimensionKey[] = ['gt', 'nt', 'dwt', 'loa', 'beam'];
/** Tonnages are written in whole units or with one or two decimals, so `32,500` is a thousands separator, not 32.5. */
const TONNAGE_KEYS: readonly DimensionKey[] = ['gt', 'nt', 'dwt'];

function toDraft(p: ParticularsData): Draft {
  return {
    name: p.name, imo: p.imo, callSign: p.callSign, mmsi: p.mmsi, flag: p.flag, portOfRegistry: p.portOfRegistry,
    gt: String(p.gt ?? ''), nt: String(p.nt ?? ''), dwt: String(p.dwt ?? ''), loa: String(p.loa ?? ''),
    beam: String(p.beam ?? ''), yearBuilt: String(p.yearBuilt ?? ''),
    owners: p.owners, managers: p.managers, pandi: p.pandi, classSociety: p.classSociety,
  };
}

const error = (field: string, message: string): FieldError => ({ field, severity: 'error', message });

/**
 * The particulars a draft stands for, merged into `base` so that anything else kept in them survives, and the
 * problems in what was typed. Text is trimmed. A number is stored as a number, an empty one is left out, and an entry
 * that is not a number or not a year is a problem and is left out too. The caller must not save while there are any.
 * A minus sign is read, so that the positive-number check of `validateParticulars` is the one to refuse it.
 */
function applyDraft(base: ParticularsData, draft: Draft, lastYear: number): { particulars: ParticularsData; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const next: ParticularsData = {
    ...base,
    name: draft.name.trim(), imo: draft.imo.trim(), callSign: draft.callSign.trim(), mmsi: draft.mmsi.trim(),
    flag: draft.flag.trim(), portOfRegistry: draft.portOfRegistry.trim(), owners: draft.owners.trim(),
    managers: draft.managers.trim(), pandi: draft.pandi.trim(), classSociety: draft.classSociety.trim(),
  };
  for (const key of DIMENSION_KEYS) {
    const tonnage = TONNAGE_KEYS.includes(key);
    const value = parseDecimal(draft[key], { signed: true, rejectThousandsLike: tonnage });
    if (value === 'invalid') errors.push(error(key, tonnage && looksLikeThousands(draft[key]) ? THOUSANDS_ERROR : NUMBER_ERROR));
    if (typeof value === 'number') next[key] = value;
    else delete next[key];
  }
  const year = parseDecimal(draft.yearBuilt);
  if (year === 'invalid' || (year !== undefined && !(Number.isInteger(year) && year >= FIRST_YEAR && year <= lastYear))) {
    errors.push(error('yearBuilt', YEAR_ERROR));
  }
  if (typeof year === 'number') next.yearBuilt = year;
  else delete next.yearBuilt;
  return { particulars: next, errors };
}

/** The first problem for each field; an error wins over a warning. */
function problemsByField(errors: FieldError[]): Map<string, FieldError> {
  const byField = new Map<string, FieldError>();
  for (const problem of errors) {
    const known = byField.get(problem.field);
    if (!known || (known.severity === 'warning' && problem.severity === 'error')) byField.set(problem.field, problem);
  }
  return byField;
}

function ParticularsForm({ ship, lastYear }: { ship: ShipProfile; lastYear: number }) {
  const { db } = useAppState();
  const [draft, setDraft] = useState(() => toDraft(ship.particulars));
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const { particulars: candidate, errors } = applyDraft(ship.particulars, draft, lastYear);
  // Validation owns the numbers' range and the IMO/MMSI; that a ship has a name is checked only here.
  errors.push(...validateParticulars(candidate));
  if (candidate.name === '') errors.unshift(error('name', SHIP_NAME_REQUIRED));
  const problems = problemsByField(errors);
  const blocked = errors.some((problem) => problem.severity === 'error');

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
            {section.fields.map(({ key, label, inputMode }) => (
              <Field
                key={key} label={label} inputMode={inputMode} value={draft[key]}
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
  const { activeShip, shipToday } = useAppState();
  if (!activeShip) return null;
  // Keyed by ship, so switching ships starts a fresh draft instead of carrying edits across.
  return (
    <section class="screen">
      <h2>Vessel particulars</h2>
      <ParticularsForm key={activeShip.id} ship={activeShip} lastYear={Number(shipToday.slice(0, 4)) + 1} />
    </section>
  );
}

import { useId, useRef, useState } from 'preact/hooks';
import { useAppState } from '../../app/AppState';
import { reportError } from '../../app/errors';
import { navigate, useRoute } from '../../app/router';
import { createRecord, updateRecord } from '../../db/records';
import { RANKS } from '../../domain/catalogues';
import type { CrewMember, FieldError } from '../../domain/types';
import { Field } from '../components/Field';
import {
  blankCrewForm, CONTROL_ORDER, crewFieldsOf, crewFormOf, crewFormProblems, crewPatchOf, problemsByControl,
} from '../crewForm';
import type { CrewControl, CrewForm } from '../crewForm';
import { useLive } from '../useLive';

type TextControl = Exclude<CrewControl, 'rank'>;

function RankSelect({ value, error, selectRef, onChange }: {
  value: CrewForm['rank'];
  error?: FieldError;
  selectRef: (element: HTMLSelectElement | null) => void;
  onChange: (rank: CrewForm['rank']) => void;
}) {
  const id = useId();
  const messageId = `${id}-message`;
  return (
    <div class="field">
      <label for={id}>Rank</label>
      <select
        id={id} ref={selectRef} value={value} aria-invalid={error ? 'true' : undefined} aria-describedby={error ? messageId : undefined}
        onChange={(event) => onChange(event.currentTarget.value as CrewForm['rank'])}
      >
        <option value="">Select a rank</option>
        {RANKS.map((rank) => <option key={rank.key} value={rank.key}>{rank.label}</option>)}
      </select>
      {error && <p id={messageId} class="field-error" role="alert">{error.message}</p>}
    </div>
  );
}

/**
 * The form for one contract, new (`member` absent) or saved. What is typed is a draft that is made once, so a change to
 * the record elsewhere does not overwrite it. A problem shows once its field has been changed, and all of them after a
 * Save that found any; Save itself is always on, and moves the focus to the first field with a problem.
 */
function CrewForm({ shipId, member }: { shipId: string; member?: CrewMember }) {
  const { db, shipToday } = useAppState();
  const [form, setForm] = useState(() => (member ? crewFormOf(member) : blankCrewForm()));
  const [changed, setChanged] = useState<ReadonlySet<CrewControl>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const controls = useRef<Partial<Record<CrewControl, HTMLElement | null>>>({});

  const problems = problemsByControl(crewFormProblems(form, shipToday, member?.signOffDate), form);
  const shown = (control: CrewControl): FieldError | undefined => {
    const found = problems.get(control);
    return found && (found.severity === 'warning' || attempted || changed.has(control)) ? found : undefined;
  };
  const refFor = (control: CrewControl) => (element: HTMLElement | null): void => {
    controls.current[control] = element;
  };
  const change = (control: CrewControl, value: string): void => {
    setForm((current) => ({ ...current, [control]: value }));
    setChanged((current) => new Set(current).add(control));
  };
  const textField = (control: TextControl, label: string, type?: 'date') => (
    <Field
      label={label} type={type} value={form[control]} error={shown(control)} inputRef={refFor(control)}
      onInput={(value) => change(control, value)}
    />
  );

  async function save(event: Event): Promise<void> {
    event.preventDefault();
    if (busy) return;
    const fields = crewFieldsOf(form);
    const firstWrong = CONTROL_ORDER.find((control) => problems.get(control)?.severity === 'error');
    if (!fields || firstWrong) {
      setAttempted(true);
      controls.current[firstWrong ?? 'rank']?.focus();
      return;
    }
    setBusy(true);
    try {
      if (member) await updateRecord<CrewMember>(db, 'crew', member.id, crewPatchOf(fields, member));
      else await createRecord<CrewMember>(db, 'crew', { shipId, ...fields });
      navigate('/ship/crew');
    } catch (err) {
      reportError(err);
      setBusy(false);
    }
  }

  return (
    <form class="crew-form" onSubmit={save} noValidate>
      <div class="form-grid">
        {textField('surname', 'Surname')}
        {textField('givenNames', 'Given names')}
        <RankSelect
          value={form.rank} error={shown('rank')} selectRef={refFor('rank')}
          onChange={(rank) => {
            setForm((current) => ({ ...current, rank }));
            setChanged((current) => new Set(current).add('rank'));
          }}
        />
        {form.rank === 'other' && textField('rankOther', 'Rank (other)')}
        {textField('nationality', 'Nationality')}
        {textField('dateOfBirth', 'Date of birth', 'date')}
        {textField('placeOfBirth', 'Place of birth')}
        {textField('passportNo', 'Passport no.')}
        {textField('passportExpiry', 'Passport expiry', 'date')}
        {textField('seamansBookNo', "Seaman's book no.")}
        {textField('seamansBookExpiry', "Seaman's book expiry", 'date')}
        {textField('signOnDate', 'Sign-on date', 'date')}
        {textField('signOnPort', 'Sign-on port')}
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary" disabled={busy}>Save</button>
      </div>
    </form>
  );
}

function NotFound() {
  return (
    <>
      <p>Crew member not found.</p>
      <p><a href="#/ship/crew">Back to crew</a></p>
    </>
  );
}

/** Adds a crew member (`/ship/crew/new`) or edits one (`/ship/crew/:id`). */
export function CrewEdit() {
  const { db, activeShip } = useAppState();
  const { id } = useRoute().params;
  // `null` is a member that does not exist; `undefined` is still loading.
  const saved = useLive(async () => (id ? (await db.crew.get(id)) ?? null : null), [db, id]);
  if (!activeShip) return null;

  let content;
  if (!id) {
    // Keyed by ship, so switching ships starts a fresh draft instead of carrying one across.
    content = <CrewForm key={`new-${activeShip.id}`} shipId={activeShip.id} />;
  } else if (saved === undefined) {
    content = null;
  } else if (saved === null || saved.deleted || saved.shipId !== activeShip.id) {
    content = <NotFound />;
  } else {
    content = <CrewForm key={saved.id} shipId={activeShip.id} member={saved} />;
  }

  return (
    <section class="screen">
      <h2>{id ? 'Edit crew member' : 'Add crew member'}</h2>
      {content}
    </section>
  );
}

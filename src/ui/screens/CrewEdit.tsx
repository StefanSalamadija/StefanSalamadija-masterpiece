import { useRef, useState } from 'preact/hooks';
import { useAppState } from '../../app/AppState';
import { reportError } from '../../app/errors';
import { navigate, useRoute } from '../../app/router';
import { createRecord, listForShip, updateRecord } from '../../db/records';
import type { CrewMember, FieldError } from '../../domain/types';
import { CrewFields } from '../components/CrewFields';
import {
  blankCrewForm, CONTROL_ORDER, crewFieldsOf, crewFormOf, crewFormProblems, crewPatchOf, problemsByControl,
} from '../crewForm';
import type { CrewControl, CrewForm } from '../crewForm';
import { useLive } from '../useLive';

/**
 * The form for one contract, new (`member` absent) or saved. What is typed is a draft that is made once, so a change to
 * the record elsewhere does not overwrite it. A problem shows once its field has been changed, and all of them after a
 * Save that found any; Save itself is always on, and moves the focus to the first field with a problem.
 */
function CrewForm({ shipId, member, crew }: { shipId: string; member?: CrewMember; crew: CrewMember[] }) {
  const { db, shipToday } = useAppState();
  const [form, setForm] = useState(() => (member ? crewFormOf(member) : blankCrewForm()));
  const [changed, setChanged] = useState<ReadonlySet<CrewControl>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const controls = useRef<Partial<Record<CrewControl, HTMLElement | null>>>({});

  const problems = problemsByControl(crewFormProblems(form, shipToday, { id: member?.id, signOffDate: member?.signOffDate, crew }), form);
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
      <CrewFields form={form} shown={shown} refFor={refFor} onChange={change} withContract />
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
  // The ship's other contracts, to keep one person's contracts from overlapping.
  const shipId = activeShip?.id;
  const crew = useLive(async () => (shipId ? listForShip<CrewMember>(db, 'crew', shipId) : []), [db, shipId]);
  if (!activeShip || !crew) return null;

  let content;
  if (!id) {
    // Keyed by ship, so switching ships starts a fresh draft instead of carrying one across.
    content = <CrewForm key={`new-${activeShip.id}`} shipId={activeShip.id} crew={crew} />;
  } else if (saved === undefined) {
    content = null;
  } else if (saved === null || saved.deleted || saved.shipId !== activeShip.id) {
    content = <NotFound />;
  } else {
    content = <CrewForm key={saved.id} shipId={activeShip.id} member={saved} crew={crew} />;
  }

  return (
    <section class="screen">
      <h2>{id ? 'Edit crew member' : 'Add crew member'}</h2>
      {content}
    </section>
  );
}

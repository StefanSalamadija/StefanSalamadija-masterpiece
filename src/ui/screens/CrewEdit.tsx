import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useAppState } from '../../app/AppState';
import { reportError } from '../../app/errors';
import { navigate, useRoute } from '../../app/router';
import { createRecord, listForShip, updateRecord } from '../../db/records';
import { docBand, docLabel, sortDocuments } from '../../domain/crewDocs';
import type { CrewMember, FieldError } from '../../domain/types';
import { BandBadge } from '../components/BandBadge';
import { CrewFields } from '../components/CrewFields';
import {
  blankCrewForm, CONTROL_ORDER, crewFieldsOf, crewFormOf, crewFormProblems, crewPatchOf, isCrewFormChanged, problemsByControl,
} from '../crewForm';
import type { CrewControl, CrewForm } from '../crewForm';
import { documentDetails } from '../crewDocsView';
import { useLive } from '../useLive';

/**
 * The form for one contract, new (`member` absent) or saved. What is typed is a draft that is made once, so a change to
 * the record elsewhere does not overwrite it. A problem shows once its field has been changed, and all of them after a
 * Save that found any; Save itself is always on, and moves the focus to the first field with a problem.
 */
function CrewForm({ shipId, member, crew, onUnsavedChange }: {
  shipId: string;
  member?: CrewMember;
  crew: CrewMember[];
  /** Told whether the form holds changes to the saved contract that are not saved yet (never for a new contract). */
  onUnsavedChange?: (unsaved: boolean) => void;
}) {
  const { db, shipToday } = useAppState();
  const [form, setForm] = useState(() => (member ? crewFormOf(member) : blankCrewForm()));
  const [changed, setChanged] = useState<ReadonlySet<CrewControl>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const controls = useRef<Partial<Record<CrewControl, HTMLElement | null>>>({});

  // Measured against the contract the form was made from, not the latest one: a change made elsewhere meanwhile is not something typed here.
  const [original] = useState(member);
  const unsaved = original !== undefined && isCrewFormChanged(form, original);
  useEffect(() => onUnsavedChange?.(unsaved), [unsaved]);
  useEffect(() => () => onUnsavedChange?.(false), []); // a form that is gone has nothing unsaved

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

const SAVE_FIRST = 'Save your changes first.';

/** True for a click that would open the link in this tab (not one that asks for a new tab or window). */
function opensHere(event: MouseEvent): boolean {
  return !(event.ctrlKey || event.metaKey || event.shiftKey || event.altKey);
}

/**
 * The papers of a saved contract: each one opens to be edited, and a new one is added from here. Both leave the contract's
 * form, so while that holds changes that are not saved (`unsaved`) they say so and stay where they are: nothing typed is lost.
 */
function Documents({ member, unsaved }: { member: CrewMember; unsaved: boolean }) {
  const { db, shipToday } = useAppState();
  const [refused, setRefused] = useState(false);
  const documents = useLive(() => db.crewDocuments.where('crewId').equals(member.id).filter((d) => !d.deleted).toArray(), [db, member.id]);
  const rows = useMemo(() => documents && sortDocuments(documents), [documents]);
  const documentsScreen = `/ship/crew/${encodeURIComponent(member.id)}/documents`;

  return (
    <section class="form-section crew-documents">
      <h3>Documents</h3>
      {refused && unsaved && <p class="field-error" role="alert">{SAVE_FIRST}</p>}
      {rows?.length === 0 && <p class="empty">No documents yet.</p>}
      {rows && rows.length > 0 && (
        <ul class="document-list" role="list" aria-label="Documents">
          {rows.map((d) => (
            <li key={d.id} class="card document-row">
              <a
                class="document-link" href={`#${documentsScreen}/${encodeURIComponent(d.id)}`}
                onClick={(event) => {
                  if (!unsaved || !opensHere(event)) return;
                  event.preventDefault();
                  setRefused(true);
                }}
              >
                <span class="document-head">
                  <span class="document-label">{docLabel(d)}</span>
                  <BandBadge band={docBand(d, shipToday)} kind="crew" />
                </span>
                <span class="document-details">{documentDetails(d).map((detail) => <span key={detail}>{detail}</span>)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button" class="btn btn-outline"
        onClick={() => {
          if (unsaved) setRefused(true);
          else navigate(`${documentsScreen}/new`);
        }}
      >
        Add document
      </button>
    </section>
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

/** Adds a crew member (`/ship/crew/new`) or edits one (`/ship/crew/:id`), who also has the papers they hold. */
export function CrewEdit() {
  const { db, activeShip } = useAppState();
  // Whether the form of the contract holds changes that are not saved; the Documents section must not leave them behind.
  const [unsaved, setUnsaved] = useState(false);
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
    content = (
      <>
        <CrewForm key={`new-${activeShip.id}`} shipId={activeShip.id} crew={crew} />
        <p class="helper-text crew-documents-note">Save the crew member first to add documents.</p>
      </>
    );
  } else if (saved === undefined) {
    content = null;
  } else if (saved === null || saved.deleted || saved.shipId !== activeShip.id) {
    content = <NotFound />;
  } else {
    content = (
      <>
        <CrewForm key={saved.id} shipId={activeShip.id} member={saved} crew={crew} onUnsavedChange={setUnsaved} />
        <Documents key={`documents-${saved.id}`} member={saved} unsaved={unsaved} />
      </>
    );
  }

  return (
    <section class="screen">
      <h2>{id ? 'Edit crew member' : 'Add crew member'}</h2>
      {content}
    </section>
  );
}

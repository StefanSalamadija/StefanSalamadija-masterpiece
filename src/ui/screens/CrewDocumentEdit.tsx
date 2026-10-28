import type { RefObject } from 'preact';
import { useId, useRef, useState } from 'preact/hooks';
import { useAppState } from '../../app/AppState';
import { reportError } from '../../app/errors';
import { navigate, useRoute } from '../../app/router';
import { createRecord, softDelete, updateRecord } from '../../db/records';
import { docLabel } from '../../domain/crewDocs';
import { fullName } from '../../domain/crew';
import type { CrewDocType, CrewDocument, CrewMember, FieldError } from '../../domain/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Field } from '../components/Field';
import {
  blankCrewDocumentForm, CREW_DOCUMENT_CONTROLS, crewDocumentFieldsOf, crewDocumentFormOf, crewDocumentGroups,
  crewDocumentPatchOf, crewDocumentProblems, isGraded, problemsByControl, withDocumentType,
} from '../crewDocumentForm';
import type { CrewDocumentControl } from '../crewDocumentForm';
import { useDialogAction } from '../useDialogAction';
import { useLive } from '../useLive';

const GROUPS = crewDocumentGroups();

/** The crew member's screen, where documents are listed and where each one returns to. */
const crewScreen = (crewId: string): string => `/ship/crew/${encodeURIComponent(crewId)}`;

/** The document: one of the catalogue, grouped, or Other, which is named in a box of its own. */
function DocumentSelect({ value, error, selectRef, onChange }: {
  value: CrewDocType | '';
  error?: FieldError;
  selectRef: (element: HTMLSelectElement | null) => void;
  onChange: (type: CrewDocType | '') => void;
}) {
  const id = useId();
  const messageId = `${id}-message`;
  return (
    <div class="field">
      <label for={id}>Document</label>
      <select
        id={id} ref={selectRef} value={value} aria-invalid={error ? 'true' : undefined} aria-describedby={error ? messageId : undefined}
        onChange={(event) => onChange(event.currentTarget.value as CrewDocType | '')}
      >
        <option value="">Select a document</option>
        {GROUPS.map(({ group, types }) => (
          <optgroup key={group} label={group}>
            {types.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
          </optgroup>
        ))}
        <option value="other">Other</option>
      </select>
      {error && <p id={messageId} class="field-error" role="alert">{error.message}</p>}
    </div>
  );
}

function DeleteDocumentDialog({ document, member, onClose, focusFallback }: {
  document: CrewDocument;
  member: CrewMember;
  onClose: () => void;
  focusFallback: RefObject<HTMLElement | null>;
}) {
  const { db } = useAppState();
  const { busy, failure, run } = useDialogAction();
  return (
    <ConfirmDialog
      title={`Delete ${docLabel(document)}?`} confirmLabel="Delete document" danger
      busy={busy} error={failure} focusFallback={focusFallback}
      // A failure stays in the dialog. On success the screen is left for the crew member's, which takes the dialog with it.
      onConfirm={() => void run(async () => {
        await softDelete(db, 'crewDocuments', document.id);
        navigate(crewScreen(member.id));
      })}
      onCancel={onClose}
      body={<p>This removes the document from this device.</p>}
    />
  );
}

/**
 * The form for one document of a contract, new (`document` absent) or saved. What is typed is a draft that is made
 * once, so a change to the record elsewhere does not overwrite it. A problem shows once its field has been changed,
 * and all of them after a Save that found any; Save itself is always on, and moves the focus to the first field with a
 * problem. Save and Delete return to the crew member.
 */
function DocumentForm({ member, document }: { member: CrewMember; document?: CrewDocument }) {
  const { db } = useAppState();
  const [form, setForm] = useState(() => (document ? crewDocumentFormOf(document) : blankCrewDocumentForm()));
  const [changed, setChanged] = useState<ReadonlySet<CrewDocumentControl>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const controls = useRef<Partial<Record<CrewDocumentControl, HTMLElement | null>>>({});
  const saveButton = useRef<HTMLButtonElement>(null);

  const problems = problemsByControl(crewDocumentProblems(form));
  const shown = (control: CrewDocumentControl): FieldError | undefined => {
    const found = problems.get(control);
    return found && (found.severity === 'warning' || attempted || changed.has(control)) ? found : undefined;
  };
  const refFor = (control: CrewDocumentControl) => (element: HTMLElement | null): void => {
    controls.current[control] = element;
  };
  const touch = (control: CrewDocumentControl): void => setChanged((current) => new Set(current).add(control));
  const change = (control: Exclude<CrewDocumentControl, 'type'>, value: string): void => {
    setForm((current) => ({ ...current, [control]: value }));
    touch(control);
  };
  const textField = (control: Exclude<CrewDocumentControl, 'type' | 'remarks'>, label: string, type?: 'date') => (
    <Field
      label={label} type={type} value={form[control]} error={shown(control)} inputRef={refFor(control)}
      onInput={(value) => change(control, value)}
    />
  );

  async function save(event: Event): Promise<void> {
    event.preventDefault();
    if (busy) return;
    const fields = crewDocumentFieldsOf(form);
    const firstWrong = CREW_DOCUMENT_CONTROLS.find((control) => problems.get(control)?.severity === 'error');
    if (!fields || firstWrong) {
      setAttempted(true);
      controls.current[firstWrong ?? 'type']?.focus();
      return;
    }
    setBusy(true);
    try {
      if (document) await updateRecord<CrewDocument>(db, 'crewDocuments', document.id, crewDocumentPatchOf(fields));
      else await createRecord<CrewDocument>(db, 'crewDocuments', { shipId: member.shipId, crewId: member.id, ...fields });
      navigate(crewScreen(member.id));
    } catch (err) {
      reportError(err);
      setBusy(false);
    }
  }

  return (
    <>
      <form class="crew-document-form" onSubmit={save} noValidate>
        <div class="form-grid">
          <DocumentSelect
            value={form.type} error={shown('type')} selectRef={refFor('type')}
            onChange={(type) => {
              setForm((current) => withDocumentType(current, type));
              touch('type');
            }}
          />
          {form.type === 'other' && textField('typeOther', 'Document name')}
          {isGraded(form.type) && textField('grade', 'Grade / capacity')}
          {textField('number', 'Number')}
          {textField('issuedBy', 'Issued by')}
          {textField('issueDate', 'Issue date', 'date')}
          {textField('expiryDate', 'Expiry date', 'date')}
          <Field label="Remarks" multiline value={form.remarks} onInput={(value) => change('remarks', value)} />
        </div>
        <div class="form-actions">
          <button ref={saveButton} type="submit" class="btn btn-primary" disabled={busy}>Save</button>
          {document && (
            <button type="button" class="btn btn-outline" disabled={busy} onClick={() => setDeleting(true)}>Delete</button>
          )}
        </div>
      </form>
      {document && deleting && (
        <DeleteDocumentDialog document={document} member={member} onClose={() => setDeleting(false)} focusFallback={saveButton} />
      )}
    </>
  );
}

function NotFound({ what, crewId }: { what: 'Crew member' | 'Document'; crewId?: string }) {
  return (
    <>
      <p>{what} not found.</p>
      <p>{crewId ? <a href={`#${crewScreen(crewId)}`}>Back to crew member</a> : <a href="#/ship/crew">Back to crew</a>}</p>
    </>
  );
}

/** Adds a document to a crew member (`/ship/crew/:id/documents/new`) or edits one (`…/documents/:docId`). */
export function CrewDocumentEdit() {
  const { db, activeShip } = useAppState();
  const { id, docId } = useRoute().params;
  // `null` is a record that does not exist; `undefined` is still loading.
  const member = useLive(async () => (id ? (await db.crew.get(id)) ?? null : null), [db, id]);
  const saved = useLive(async () => (docId ? (await db.crewDocuments.get(docId)) ?? null : null), [db, docId]);
  if (!activeShip) return null;

  let content;
  if (member === undefined) {
    content = null;
  } else if (member === null || member.deleted || member.shipId !== activeShip.id) {
    content = <NotFound what="Crew member" />;
  } else if (!docId) {
    // Keyed by the contract, so going to another one starts a fresh draft instead of carrying one across.
    content = <DocumentForm key={`new-${member.id}`} member={member} />;
  } else if (saved === undefined) {
    content = null;
  } else if (saved === null || saved.deleted || saved.shipId !== activeShip.id || saved.crewId !== member.id) {
    content = <NotFound what="Document" crewId={member.id} />;
  } else {
    content = <DocumentForm key={saved.id} member={member} document={saved} />;
  }

  return (
    <section class="screen">
      <h2>{docId ? 'Edit document' : 'Add document'}</h2>
      {member && !member.deleted && member.shipId === activeShip.id && <p class="crew-row-meta">{fullName(member)}</p>}
      {content}
    </section>
  );
}

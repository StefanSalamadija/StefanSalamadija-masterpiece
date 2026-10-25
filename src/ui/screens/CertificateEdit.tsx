import type { RefObject } from 'preact';
import { useId, useRef, useState } from 'preact/hooks';
import { useAppState } from '../../app/AppState';
import { reportError } from '../../app/errors';
import { navigate, useRoute } from '../../app/router';
import { createRecord, softDelete, updateRecord } from '../../db/records';
import type { Certificate, FieldError } from '../../domain/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Field } from '../components/Field';
import {
  blankCertificateForm, CERTIFICATE_CONTROLS, certificateFieldsOf, certificateFormOf, certificateGroups, certificatePatchOf,
  certificateProblems, problemsByControl, withCertificate,
} from '../certificateForm';
import type { CertificateControl } from '../certificateForm';
import { useDialogAction } from '../useDialogAction';
import { useLive } from '../useLive';

const GROUPS = certificateGroups();

/** The certificate: one of the catalogue, grouped, or Other, which is named in a box of its own. */
function CertificateSelect({ value, error, selectRef, onChange }: {
  value: string;
  error?: FieldError;
  selectRef: (element: HTMLSelectElement | null) => void;
  onChange: (key: string) => void;
}) {
  const id = useId();
  const messageId = `${id}-message`;
  return (
    <div class="field">
      <label for={id}>Certificate</label>
      <select
        id={id} ref={selectRef} value={value} aria-invalid={error ? 'true' : undefined} aria-describedby={error ? messageId : undefined}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        <option value="">Select a certificate</option>
        {GROUPS.map(({ group, certificates }) => (
          <optgroup key={group} label={group}>
            {certificates.map(({ key, name }) => <option key={key} value={key}>{name}</option>)}
          </optgroup>
        ))}
        <option value="other">Other</option>
      </select>
      {error && <p id={messageId} class="field-error" role="alert">{error.message}</p>}
    </div>
  );
}

function DeleteCertificateDialog({ certificate, onClose, focusFallback }: {
  certificate: Certificate;
  onClose: () => void;
  focusFallback: RefObject<HTMLElement | null>;
}) {
  const { db } = useAppState();
  const { busy, failure, run } = useDialogAction();
  return (
    <ConfirmDialog
      title={`Delete ${certificate.name}?`} confirmLabel="Delete certificate" danger
      busy={busy} error={failure} focusFallback={focusFallback}
      // A failure stays in the dialog. On success the screen is left for the register, which takes the dialog with it.
      onConfirm={() => void run(async () => {
        await softDelete(db, 'certificates', certificate.id);
        navigate('/ship/certificates');
      })}
      onCancel={onClose}
      body={<p>This removes the certificate from this device.</p>}
    />
  );
}

/**
 * The form for one certificate, new (`certificate` absent) or saved. What is typed is a draft that is made once, so a
 * change to the record elsewhere does not overwrite it. A problem shows once its field has been changed, and all of
 * them after a Save that found any; Save itself is always on, and moves the focus to the first field with a problem.
 */
function CertificateForm({ shipId, certificate }: { shipId: string; certificate?: Certificate }) {
  const { db } = useAppState();
  const [form, setForm] = useState(() => (certificate ? certificateFormOf(certificate) : blankCertificateForm()));
  const [changed, setChanged] = useState<ReadonlySet<CertificateControl>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const controls = useRef<Partial<Record<CertificateControl, HTMLElement | null>>>({});
  const saveButton = useRef<HTMLButtonElement>(null);

  const problems = problemsByControl(certificateProblems(form), form);
  const shown = (control: CertificateControl): FieldError | undefined => {
    const found = problems.get(control);
    return found && (found.severity === 'warning' || attempted || changed.has(control)) ? found : undefined;
  };
  const refFor = (control: CertificateControl) => (element: HTMLElement | null): void => {
    controls.current[control] = element;
  };
  const change = (control: CertificateControl, value: string): void => {
    setForm((current) => (control === 'key' ? withCertificate(current, value) : { ...current, [control]: value }));
    setChanged((current) => new Set(current).add(control));
  };
  const textField = (control: Exclude<CertificateControl, 'key'>, label: string, type?: 'date') => (
    <Field
      label={label} type={type} value={form[control]} error={shown(control)} inputRef={refFor(control)}
      onInput={(value) => change(control, value)}
    />
  );

  async function save(event: Event): Promise<void> {
    event.preventDefault();
    if (busy) return;
    const firstWrong = CERTIFICATE_CONTROLS.find((control) => problems.get(control)?.severity === 'error');
    if (firstWrong) {
      setAttempted(true);
      controls.current[firstWrong]?.focus();
      return;
    }
    setBusy(true);
    try {
      const fields = certificateFieldsOf(form);
      if (certificate) await updateRecord<Certificate>(db, 'certificates', certificate.id, certificatePatchOf(fields));
      else await createRecord<Certificate>(db, 'certificates', { shipId, ...fields });
      navigate('/ship/certificates');
    } catch (err) {
      reportError(err);
      setBusy(false);
    }
  }

  return (
    <>
      <form class="certificate-form" onSubmit={save} noValidate>
        <div class="form-grid">
          <CertificateSelect value={form.key} error={shown('key')} selectRef={refFor('key')} onChange={(key) => change('key', key)} />
          {form.key === 'other' && textField('customName', 'Certificate name')}
          {textField('number', 'Number')}
          {textField('issuedBy', 'Issued by')}
          {textField('issueDate', 'Issue date', 'date')}
          {textField('expiryDate', 'Expiry date', 'date')}
          {textField('nextSurveyDue', 'Next survey due', 'date')}
          <Field label="Remarks" multiline value={form.remarks} onInput={(value) => change('remarks', value)} />
        </div>
        <div class="form-actions">
          <button ref={saveButton} type="submit" class="btn btn-primary" disabled={busy}>Save</button>
          {certificate && (
            <button type="button" class="btn btn-outline" disabled={busy} onClick={() => setDeleting(true)}>Delete</button>
          )}
        </div>
      </form>
      {certificate && deleting && (
        <DeleteCertificateDialog certificate={certificate} onClose={() => setDeleting(false)} focusFallback={saveButton} />
      )}
    </>
  );
}

function NotFound() {
  return (
    <>
      <p>Certificate not found.</p>
      <p><a href="#/ship/certificates">Back to certificates</a></p>
    </>
  );
}

/** Adds a certificate (`/ship/certificates/new`) or edits one (`/ship/certificates/:id`). */
export function CertificateEdit() {
  const { db, activeShip } = useAppState();
  const { id } = useRoute().params;
  // `null` is a certificate that does not exist; `undefined` is still loading.
  const saved = useLive(async () => (id ? (await db.certificates.get(id)) ?? null : null), [db, id]);
  if (!activeShip) return null;

  let content;
  if (!id) {
    // Keyed by ship, so switching ships starts a fresh draft instead of carrying one across.
    content = <CertificateForm key={`new-${activeShip.id}`} shipId={activeShip.id} />;
  } else if (saved === undefined) {
    content = null;
  } else if (saved === null || saved.deleted || saved.shipId !== activeShip.id) {
    content = <NotFound />;
  } else {
    content = <CertificateForm key={saved.id} shipId={activeShip.id} certificate={saved} />;
  }

  return (
    <section class="screen">
      <h2>{id ? 'Edit certificate' : 'Add certificate'}</h2>
      {content}
    </section>
  );
}

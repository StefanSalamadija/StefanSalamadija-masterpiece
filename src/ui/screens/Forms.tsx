import type { RefObject } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { useAppState } from '../../app/AppState';
import { reportError } from '../../app/errors';
import { takeFlash } from '../../app/flash';
import { navigate } from '../../app/router';
import { listTemplates, replaceTemplate, saveTemplate } from '../../db/forms';
import type { TemplateInput } from '../../db/forms';
import { listForShip } from '../../db/records';
import type { FormDraft, FormTemplate } from '../../domain/types';
import { loadFormsEngine } from '../../forms/load';
import type { FormsEngine } from '../../forms/load';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Field } from '../components/Field';
import {
  draftRows, fillHref, FORM_FILE_TYPES, libraryRows, libraryText, replacePrompt, replaceTarget, revisionNotice, setupHref,
} from '../formsView';
import { importMany, importProgress, importSummaryLines } from '../formsImport';
import type { ImportSummary, ReadForm } from '../formsImport';
import { useDialogAction } from '../useDialogAction';
import { useLive } from '../useLive';
import { leaveSetupNotice } from './FormSetup';

/** A file read and found to be a new revision of a form in the library, waiting for the person to say Replace. */
interface PendingRevision {
  target: FormTemplate;
  input: Omit<TemplateInput, 'setup'>;
}

/** A file of a multi-file import that is a new revision of a form in the library, waiting for the answer. */
interface PendingAsk {
  target: FormTemplate;
  input: ReadForm;
  answer: (replace: boolean) => void;
}

/**
 * Asks `Replace Revision <old> with Revision <new>?`. Replace carries the form over (`replaceTemplate`) and opens its
 * setup, which lists what to check; Cancel saves nothing.
 */
function ReplaceDialog({ pending, onCancel, focusFallback }: {
  pending: PendingRevision;
  onCancel: () => void;
  focusFallback: RefObject<HTMLElement | null>;
}) {
  const { db } = useAppState();
  const { busy, failure, run } = useDialogAction();
  return (
    <ConfirmDialog
      title={replacePrompt(pending.target.revision, pending.input.schema.identity.revision)} confirmLabel="Replace"
      busy={busy} error={failure} focusFallback={focusFallback} onCancel={onCancel}
      onConfirm={() => void run(async () => {
        const result = await replaceTemplate(db, pending.target.id, pending.input);
        leaveSetupNotice(result.template.id, revisionNotice(result));
        navigate(setupHref(result.template.id));
      })}
      body={
        <>
          <p>{libraryText(pending.target)}</p>
          <p>The form in your library is replaced by this file. Its setup and the open drafts are carried over; new fields are listed for you to check.</p>
        </>
      }
    />
  );
}

/** The same question while several files are imported: Replace carries on with the next file, Cancel skips this one. */
function ReplaceInBatchDialog({ ask, focusFallback }: {
  ask: PendingAsk;
  focusFallback: RefObject<HTMLElement | null>;
}) {
  return (
    <ConfirmDialog
      title={replacePrompt(ask.target.revision, ask.input.schema.identity.revision)} confirmLabel="Replace"
      focusFallback={focusFallback} onCancel={() => ask.answer(false)} onConfirm={() => ask.answer(true)}
      body={
        <>
          <p>{libraryText(ask.target)}</p>
          <p>File: {ask.input.fileName}. Cancel skips this file and goes on with the others.</p>
        </>
      }
    />
  );
}

function FormsLibrary({ shipId }: { shipId: string }) {
  const { db } = useAppState();
  // Read together, so that a draft is never listed before the form it belongs to.
  const data = useLive(async () => {
    const [templates, drafts] = await Promise.all([listTemplates(db), listForShip<FormDraft>(db, 'formDrafts', shipId)]);
    return { templates, drafts };
  }, [db, shipId]);
  /** The engine, for the drafts' period labels; it is loaded at once so that an import does not wait for it. */
  const [engine, setEngine] = useState<FormsEngine | null>();
  const [query, setQuery] = useState('');
  const [fileName, setFileName] = useState<string>();
  const [problem, setProblem] = useState<string>();
  // What the screen before left to say (`Form saved.`), else what this screen is doing.
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingRevision>();
  const [ask, setAsk] = useState<PendingAsk>();
  const [summary, setSummary] = useState<ImportSummary>();
  const working = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const fileId = useId();
  const nameId = useId();
  const helpId = useId();
  const draftsHeadingId = useId();

  useEffect(() => setStatus(takeFlash() ?? ''), []);
  useEffect(() => {
    // A failure is not reported here: nothing was asked for yet. The drafts then show their period as it is kept, and an
    // import says what went wrong.
    loadFormsEngine().then(setEngine, () => setEngine(null));
  }, []);

  /**
   * Reads the chosen file. A form that is already in the library (the same code) asks to be replaced; any other is
   * added with the suggested setup, and its setup review opens. A file that is not a form says why, here.
   */
  async function choose(files: File[]): Promise<void> {
    const input = fileInput.current;
    if (files.length === 0 || working.current) {
      if (input) input.value = '';
      return;
    }
    if (files.length > 1) return chooseMany(files);
    const file = files[0];
    setSummary(undefined);
    working.current = true;
    setBusy(true);
    setProblem(undefined);
    setFileName(file.name);
    setStatus('Reading form…');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const forms = await loadFormsEngine();
      let read: ReturnType<FormsEngine['importForm']>;
      try {
        read = forms.importForm(file.name, bytes);
      } catch (err) {
        if (!(err instanceof forms.FormFileError)) throw err;
        setProblem(err.message);
        setStatus('');
        return;
      }
      const target = replaceTarget(await listTemplates(db), read.schema.identity.code);
      setStatus('');
      if (target) {
        setPending({ target, input: { fileName: file.name, bytes, kind: read.kind, schema: read.schema } });
        return;
      }
      const saved = await saveTemplate(db, {
        fileName: file.name, bytes, kind: read.kind, schema: read.schema, setup: forms.defaultSetup(read.schema),
      });
      navigate(setupHref(saved.id));
    } catch (err) {
      setStatus('');
      reportError(err);
    } finally {
      working.current = false;
      setBusy(false);
      // The browser only reports a file that is chosen again (say, saved over and picked a second time) when it was forgotten.
      if (input) input.value = '';
    }
  }

  /**
   * Imports several files one after another, as a single import does but without opening any setup: each form is saved
   * with its suggested setup. A new revision still asks to be replaced, for that file. At the end the summary says how
   * many were imported and which files failed.
   */
  async function chooseMany(files: File[]): Promise<void> {
    const input = fileInput.current;
    working.current = true;
    setBusy(true);
    setProblem(undefined);
    setSummary(undefined);
    setFileName(`${files.length} files`);
    try {
      const forms = await loadFormsEngine();
      const result = await importMany(
        files.map((f) => ({ name: f.name, bytes: async () => new Uint8Array(await f.arrayBuffer()) })),
        {
          read: (name, bytes) => forms.importForm(name, bytes),
          isFileError: (err): err is Error => err instanceof forms.FormFileError,
          findTarget: async (code) => replaceTarget(await listTemplates(db), code),
          confirmReplace: (target, read) => new Promise<boolean>((resolve) => {
            setAsk({ target, input: read, answer: (replace) => { setAsk(undefined); resolve(replace); } });
          }),
          replace: async (target, read) => void await replaceTemplate(db, target.id, read),
          save: async (read) => void await saveTemplate(db, { ...read, setup: forms.defaultSetup(read.schema) }),
        },
        (n, total) => setStatus(importProgress(n, total)),
      );
      setStatus('');
      setSummary(result);
      if (result.stopped !== undefined) reportError(result.stopped);
    } catch (err) {
      setStatus('');
      reportError(err);
    } finally {
      working.current = false;
      setBusy(false);
      if (input) input.value = '';
    }
  }

  const templates = data?.templates ?? [];
  const rows = libraryRows(templates, query);
  const drafts = data && engine !== undefined ? draftRows(data.drafts, data.templates, engine?.periodLabel ?? ((period) => period)) : undefined;

  return (
    <section class="screen">
      <div class="screen-head">
        <h2>Forms</h2>
        <div class="head-actions">
          {/* The input is hidden behind its label, which looks like a button; the input still takes the focus. */}
          <input
            id={fileId} ref={fileInput} type="file" multiple class="file-input" accept={FORM_FILE_TYPES}
            aria-disabled={busy ? 'true' : undefined} aria-invalid={problem ? 'true' : undefined}
            aria-describedby={fileName === undefined ? helpId : `${nameId} ${helpId}`}
            onChange={(event) => void choose([...(event.currentTarget.files ?? [])])}
          />
          <label for={fileId} class="btn btn-primary">Import form</label>
        </div>
      </div>
      <div class="forms-import">
        {fileName !== undefined && <p id={nameId} class="import-file">{fileName}</p>}
        <p id={helpId} class="helper-text">Company forms in Word (.docx, .dotx) or Excel (.xlsx); you can choose several at once. They are read on this device and go nowhere else.</p>
        {problem && <p class="field-error" role="alert">{problem}</p>}
        {summary && (
          <div class="forms-summary">
            <p>{importSummaryLines(summary)[0]}</p>
            {summary.failures.length > 0 && (
              <ul class="field-error" role="alert" aria-label="Files not imported">
                {importSummaryLines(summary).slice(1).map((line) => <li key={line}>{line}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>
      {/* Always on the page, with its text set after it is there, so that it is announced. */}
      <p class="live" role="status">{status}</p>

      {data && templates.length === 0 && <p class="empty">No forms yet. Import a company form to fill it in on this phone.</p>}
      {templates.length > 0 && (
        <>
          <Field label="Search forms" value={query} onInput={setQuery} />
          {rows.length === 0 && <p class="empty">No form matches your search.</p>}
          {rows.length > 0 && (
            <ul class="form-list" role="list" aria-label="Forms">
              {rows.map((t) => (
                <li key={t.id} class="card form-row">
                  <a class="form-link" href={fillHref(t.id)}>{libraryText(t)}</a>
                  <a class="btn btn-outline btn-small" href={setupHref(t.id)}>Set up</a>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {drafts && (
        <section class="forms-drafts" aria-labelledby={draftsHeadingId}>
          <h3 id={draftsHeadingId}>In progress</h3>
          {drafts.length === 0 && <p class="empty">No drafts in progress.</p>}
          {drafts.length > 0 && (
            <ul class="form-list" role="list" aria-label="In progress">
              {drafts.map((row) => (
                <li key={row.draft.id} class="card form-row">
                  {row.template ? <a class="form-link" href={fillHref(row.template.id)}>{row.text}</a> : <span class="form-missing">{row.text}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {ask && <ReplaceInBatchDialog ask={ask} focusFallback={fileInput} />}
      {pending && <ReplaceDialog pending={pending} onCancel={() => setPending(undefined)} focusFallback={fileInput} />}
    </section>
  );
}

/** The forms library, with search and import, and the active ship's drafts in progress. */
export function Forms() {
  const { activeShip } = useAppState();
  if (!activeShip) return null;
  // Keyed by ship, so that switching ships does not carry a dialog or a file across.
  return <FormsLibrary key={activeShip.id} shipId={activeShip.id} />;
}

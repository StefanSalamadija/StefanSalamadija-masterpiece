import { useEffect, useId, useMemo, useRef, useState } from 'preact/hooks';
import { useAppState } from '../../app/AppState';
import { reportError } from '../../app/errors';
import { setFlash } from '../../app/flash';
import { navigate } from '../../app/router';
import { BackupError, readHeader } from '../../backup/envelope';
import type { BackupHeader } from '../../backup/envelope';
import { applyImport, prepareImport } from '../../backup/service';
import type { PreparedImport } from '../../backup/service';
import { Field } from '../components/Field';
import {
  conflictViews, deletionsLabel, deletionTitles, fromLine, isTooBigForBackup, shownFileName, summaryLine, TOO_LARGE_MESSAGE,
  unresolvedCount,
} from '../importReview';
import type { ConflictView } from '../importReview';

type Choices = Record<string, 'local' | 'incoming'>;

/** A file that has been read and has a header; it is not opened until the password is given. */
interface ChosenFile { text: string; header: BackupHeader }

function Conflict({ view, choice, onChoose }: { view: ConflictView; choice?: 'local' | 'incoming'; onChoose: (choice: 'local' | 'incoming') => void }) {
  return (
    <fieldset class="card conflict">
      <legend>{view.title}</legend>
      <table class="conflict-table">
        <thead>
          <tr><th scope="col">Field</th><th scope="col">This device</th><th scope="col">File</th></tr>
        </thead>
        <tbody>
          {view.changes.map((change, index) => (
            <tr key={index}>
              <th scope="row">{change.label}</th>
              <td>{change.local}</td>
              <td>{change.incoming}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {view.changes.length === 0 && <p class="helper-text">The two versions look the same here. Either choice is fine.</p>}
      <label class="check">
        <input type="radio" name={view.key} checked={choice === 'local'} onChange={() => onChoose('local')} />
        <span>{view.keepLabel}</span>
      </label>
      <label class="check">
        <input type="radio" name={view.key} checked={choice === 'incoming'} onChange={() => onChoose('incoming')} />
        <span>{view.useLabel}</span>
      </label>
    </fieldset>
  );
}

/**
 * Imports a backup or handover file: choose the file, give its password, review what would change, and apply. It works
 * with no ship (it is how a new phone gets its data), and then has no header around it. Everything shown from the file
 * is text.
 *
 * Open and Apply import are `aria-disabled` while they run, not `disabled`, which would take the focus from them. Apply
 * import is `disabled` until every conflict has a choice (the focus is on the radios then, not on it).
 */
export function ImportBackup() {
  const { db, activeShip } = useAppState();
  const [fileName, setFileName] = useState<string>();
  const [chosen, setChosen] = useState<ChosenFile>();
  const [password, setPassword] = useState('');
  const [prepared, setPrepared] = useState<PreparedImport>();
  const [choices, setChoices] = useState<Choices>({});
  const [applyDeletions, setApplyDeletions] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'opening' | 'applying'>('idle');
  /** What is wrong with the file or the password, in the words of the backup errors. It stays on the page and only its text changes. */
  const [problem, setProblem] = useState('');
  const latestRead = useRef(0);
  // Set at once, where `phase` is only seen by the next render: a second tap in between must not run it twice.
  const working = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  /** The review was thrown away (the data here changed under it): the focus goes to the password, to open the file again. */
  const reopen = useRef(false);
  const fileId = useId();
  const nameId = `${fileId}-name`;
  const helpId = `${fileId}-help`;

  const conflicts = useMemo(() => (prepared ? conflictViews(prepared.plan) : []), [prepared]);
  const deletions = useMemo(() => (prepared ? deletionTitles(prepared.plan) : []), [prepared]);
  const unresolved = unresolvedCount(conflicts, choices);
  const busy = phase !== 'idle';

  // The password has opened the file: the review is what there is to read now, so the focus goes to it.
  useEffect(() => {
    if (prepared) reviewHeading.current?.focus();
    else if (reopen.current) {
      reopen.current = false;
      passwordInput.current?.focus();
    }
  }, [prepared]);

  async function choose(file: File | undefined): Promise<void> {
    const mine = ++latestRead.current;
    setFileName(file && shownFileName(file.name));
    setChosen(undefined);
    setPassword('');
    setPrepared(undefined);
    setChoices({});
    setApplyDeletions(false);
    setProblem('');
    if (!file) return;
    try {
      if (isTooBigForBackup(file.size)) {
        setProblem(TOO_LARGE_MESSAGE); // not read: it may be a video picked by mistake
        return;
      }
      const text = await file.text();
      if (mine !== latestRead.current) return;
      setChosen({ text, header: readHeader(text) });
    } catch (err) {
      if (mine !== latestRead.current) return;
      if (err instanceof BackupError) setProblem(err.message);
      else reportError(err);
    } finally {
      // The browser only reports a file that is chosen again (say, saved over and picked a second time) when it was forgotten.
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function open(event: Event): Promise<void> {
    event.preventDefault();
    if (working.current || !chosen) return;
    working.current = true;
    setPhase('opening');
    setProblem('');
    try {
      setPrepared(await prepareImport(db, chosen.text, password));
      setPassword('');
    } catch (err) {
      if (err instanceof BackupError) setProblem(err.message);
      else reportError(err);
    } finally {
      working.current = false;
      setPhase('idle');
    }
  }

  async function apply(): Promise<void> {
    if (working.current || !prepared || unresolved > 0) return;
    working.current = true;
    setPhase('applying');
    try {
      await applyImport(db, prepared, { conflicts: choices, applyDeletions });
      setFlash('Import complete.');
      navigate('/');
      return; // stays busy until the screen is replaced, so that a second tap cannot import again
    } catch (err) {
      if (err instanceof BackupError) {
        // The data here changed since the review (the file is not the cause), so the review is not true any more: it is
        // thrown away, and the file is opened again for a new one.
        setProblem(err.message);
        setPrepared(undefined);
        setChoices({});
        setApplyDeletions(false);
        reopen.current = true;
      } else reportError(err);
    }
    working.current = false;
    setPhase('idle');
  }

  const Heading = activeShip ? 'h2' : 'h1'; // with no ship there is no header above, so this is the page's heading
  return (
    <section class="screen">
      <Heading>Import backup</Heading>
      <div class="import-form">
        <div class="field">
          <label for={fileId}>Backup file</label>
          {/* The input is emptied once the file is read, so the name of the file is said by the text under it. */}
          <input
            id={fileId} ref={fileInput} type="file" disabled={busy} aria-describedby={fileName === undefined ? helpId : `${nameId} ${helpId}`}
            onChange={(event) => void choose(event.currentTarget.files?.[0])}
          />
          {fileName !== undefined && <p id={nameId} class="import-file">{fileName}</p>}
          <p id={helpId} class="helper-text">A Masterpiece backup or handover file. It is opened on this device and goes nowhere else.</p>
        </div>

        {chosen && <p class="import-from">{fromLine(chosen.header)}</p>}

        {chosen && !prepared && (
          <form class="import-open" onSubmit={open} noValidate>
            <Field
              label="Password" type="password" autoComplete="current-password" value={password} inputRef={passwordInput}
              onInput={(value) => {
                setPassword(value);
                setProblem('');
              }}
            />
            <div class="form-actions">
              <button type="submit" class="btn btn-primary" aria-disabled={busy ? 'true' : undefined}>Open</button>
            </div>
          </form>
        )}

        {/* Always on the page, with its text set after it is there, so that it is announced. */}
        <p class="field-error" role="alert">{problem}</p>
        <p class="live" role="status">{phase === 'opening' ? 'Opening the file…' : phase === 'applying' ? 'Importing…' : ''}</p>

        {prepared && (
          <div class="import-section">
            <h3 ref={reviewHeading} tabIndex={-1}>Review</h3>
            <p class="import-summary">{summaryLine(prepared.plan.summary)}</p>
            {Object.values(prepared.plan.summary).every((count) => count === 0) && (
              <p class="helper-text">Nothing in this file needs to change on this device.</p>
            )}

            {conflicts.length > 0 && (
              <>
                <p class="helper-text">Both this device and the file changed these. Choose the version to keep for each.</p>
                {conflicts.map((view) => (
                  <Conflict
                    key={view.key} view={view} choice={choices[view.key]}
                    onChoose={(choice) => setChoices((current) => ({ ...current, [view.key]: choice }))}
                  />
                ))}
              </>
            )}

            {deletions.length > 0 && (
              <div class="import-section">
                <label class="check">
                  <input type="checkbox" checked={applyDeletions} onChange={(event) => setApplyDeletions(event.currentTarget.checked)} />
                  <span>{deletionsLabel(deletions.length)}</span>
                </label>
                <p class="helper-text">The file says these were deleted. Left unticked, they stay on this device.</p>
                <ul class="import-deletions" role="list" aria-label="Deletions">
                  {deletions.map((title, index) => <li key={index}>{title}</li>)}
                </ul>
              </div>
            )}

            {unresolved > 0 && <p class="helper-text">Choose a version for every conflict to continue.</p>}
            <div class="form-actions">
              <button
                type="button" class="btn btn-primary" disabled={unresolved > 0} aria-disabled={busy ? 'true' : undefined}
                onClick={() => void apply()}
              >
                Apply import
              </button>
            </div>
          </div>
        )}
      </div>
      <p>
        {activeShip ? <a href="#/settings">Back to Settings</a> : <a href="#/">Back to the welcome screen</a>}
      </p>
    </section>
  );
}

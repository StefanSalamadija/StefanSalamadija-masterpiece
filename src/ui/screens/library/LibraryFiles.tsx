import { useEffect, useRef, useState } from 'preact/hooks';
import { useAppState } from '../../../app/AppState';
import { describeError, reportError } from '../../../app/errors';
import { shareOrDownload } from '../../../backup/share';
import { getFile, hasFiles, listDocuments, listFolders } from '../../../db/library';
import { takeSnapshot } from '../../../db/snapshots';
import type { LibraryDoc, LibraryFolder } from '../../../domain/types';
import {
  checkLibraryHeader, importLibraryPart, LIBRARY_HEADER_BYTES, LIBRARY_PART_BYTES, packLibraryPart, PartialImportError, planLibraryParts, readLibraryPart,
} from '../../../library/mplib';
import type { LibraryPlan } from '../../../library/mplib';
import { Field } from '../../components/Field';
import { PasswordDialog } from '../../components/PasswordDialog';

/** Tests lower the size of a part through this key; it is read only when it is there. */
const TEST_PART_BYTES_KEY = 'masterpiece.test.partBytes';

function partBytes(): number {
  try {
    const value = Number(localStorage.getItem(TEST_PART_BYTES_KEY));
    if (Number.isInteger(value) && value > 0) return value;
  } catch {
    // no storage: the real size
  }
  return LIBRARY_PART_BYTES;
}

/** Export the library's files as encrypted parts, and import such parts, in any order. */
export function LibraryFiles() {
  const { db } = useAppState();
  const [exporting, setExporting] = useState(false);
  /** An export being saved: the plan and the password, kept only until the last part is saved or the screen is left. Parts are made one at a time, when saved. */
  const session = useRef<{ plan: LibraryPlan; password: string; docs: LibraryDoc[]; folders: LibraryFolder[] } | undefined>(undefined);
  const [partCount, setPartCount] = useState(0);
  const [making, setMaking] = useState(false);
  const [saved, setSaved] = useState<Set<number>>(new Set());
  const [status, setStatus] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [password, setPassword] = useState('');
  const [importing, setImporting] = useState(false);
  const [problem, setProblem] = useState('');
  const [report, setReport] = useState<string[]>([]);
  const snapshotted = useRef(false);
  const exportButton = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => () => { session.current = undefined; }, []);

  async function exportParts(pw: string): Promise<void> {
    const [docs, have, folders] = await Promise.all([listDocuments(db), hasFiles(db), listFolders(db)]);
    const plan = planLibraryParts(docs, have, { partBytes: partBytes() });
    if (!docs.some((d) => have.has(d.id))) throw new Error('There are no library files on this device to export.');
    session.current = { plan, password: pw, docs, folders };
    setPartCount(plan.parts.length);
    setSaved(new Set());
    setStatus(`Library ready in ${plan.parts.length} ${plan.parts.length === 1 ? 'part' : 'parts'}. Save each one.`);
    setExporting(false);
  }

  async function savePart(index: number): Promise<void> {
    const current = session.current;
    if (!current || making) return;
    setMaking(true);
    try {
      // Only this part is made, and it is let go of once it is handed over.
      const part = await packLibraryPart(current.plan, index + 1, { docs: current.docs, folders: current.folders, getFile: (id) => getFile(db, id) }, current.password, { now: new Date() });
      const outcome = await shareOrDownload(part.fileName, part.blob);
      if (outcome === 'cancelled') return;
      const next = new Set(saved).add(index);
      setSaved(next);
      setStatus(`Part ${index + 1} of ${partCount} saved.`);
      if (next.size === partCount) {
        session.current = undefined;
        setPartCount(0);
        setStatus(`All ${partCount} parts saved.`);
      }
    } catch (err) {
      reportError(err);
    } finally {
      setMaking(false);
    }
  }

  async function importAll(): Promise<void> {
    if (importing) return;
    if (files.length === 0) { setProblem('Choose the library files to import.'); return; }
    if (password === '') { setProblem('Enter the password.'); return; }
    setImporting(true);
    setProblem('');
    setReport([]);
    const lines: string[] = [];
    try {
      for (const file of files) {
        let part;
        try {
          // The first bytes say whether this is a library file at all, before the rest is read.
          checkLibraryHeader(new Uint8Array(await file.slice(0, LIBRARY_HEADER_BYTES).arrayBuffer()));
          part = await readLibraryPart(new Uint8Array(await file.arrayBuffer()), password);
        } catch (err) {
          const message = describeError(err).message;
          // Parts imported before this one stay imported: do not say that nothing changed.
          setProblem(`${file.name}: ${lines.length > 0 ? message.replace(' Nothing was changed.', '') + ' Parts imported before it stay imported.' : message}`);
          break;
        }
        if (!snapshotted.current) {
          await takeSnapshot(db, 'before-import', 'Before importing library files');
          snapshotted.current = true;
        }
        const done = await importLibraryPart(db, part, setStatus);
        lines.push(`Part ${part.part} of ${part.parts}: ${done.added} added, ${done.attached} attached, ${done.skipped} already here.`);
        setReport([...lines]);
      }
      setStatus(lines.length > 0 ? 'Library import finished.' : '');
    } catch (err) {
      setStatus('');
      if (err instanceof PartialImportError) {
        const { added, attached, skipped } = err.counts;
        lines.push(`Stopped part: ${added} added, ${attached} attached, ${skipped} already here before it failed. Import the file again to finish it.`);
        setReport([...lines]);
      }
      reportError(err);
    } finally {
      setImporting(false);
    }
  }

  return (
    <section class="screen">
      <h2>Library files</h2>
      <p class="helper-text">A library file holds your documents themselves, encrypted with a password. A large library comes in several parts; import them in any order.</p>

      <div class="settings-section">
        <h3>Export</h3>
        <div class="form-actions">
          <button ref={exportButton} type="button" class="btn btn-primary" onClick={() => { setStatus(''); setExporting(true); }}>Export library</button>
        </div>
        {partCount > 0 && (
          <ul class="plain-list" aria-label="Parts to save">
            {Array.from({ length: partCount }, (_, i) => (
              <li key={i}>
                <button type="button" class="btn btn-outline" disabled={making} onClick={() => void savePart(i)}>
                  {saved.has(i) ? `Save part ${i + 1} of ${partCount} again` : `Save part ${i + 1} of ${partCount}`}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div class="settings-section">
        <h3>Import</h3>
        <div class="field">
          <label for="mplib-files">Library file</label>
          <input
            id="mplib-files" ref={fileInput} type="file" multiple accept=".mplib"
            onChange={(event) => { setFiles([...(event.currentTarget.files ?? [])]); setProblem(''); }}
          />
        </div>
        <Field
          label="Password" type="password" autoComplete="current-password" value={password}
          onInput={(value) => { setPassword(value); setProblem(''); }}
        />
        <div class="form-actions">
          <button type="button" class="btn btn-primary" disabled={importing} onClick={() => void importAll()}>Import library</button>
        </div>
        {problem !== '' && <p class="field-error" role="alert">{problem}</p>}
        {report.length > 0 && <ul aria-label="Imported parts">{report.map((line) => <li key={line}>{line}</li>)}</ul>}
      </div>

      <p class="live" role="status">{status}</p>
      <p><a href="#/library">Back to Library</a></p>
      {exporting && (
        <PasswordDialog
          title="Export library" showWarning offerRemember={false}
          intro={<p>Your library files go into encrypted parts, each part with the same password.</p>}
          focusFallback={exportButton} onCancel={() => setExporting(false)} onSubmit={exportParts}
        />
      )}
    </section>
  );
}

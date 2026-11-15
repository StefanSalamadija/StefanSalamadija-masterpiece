import { useRef, useState } from 'preact/hooks';
import { useAppState } from '../../../app/AppState';
import { describeError, reportError } from '../../../app/errors';
import { shareOrDownload } from '../../../backup/share';
import { getFile, listDocuments, listFolders } from '../../../db/library';
import { takeSnapshot } from '../../../db/snapshots';
import { importLibraryPart, LIBRARY_PART_BYTES, packLibrary, readLibraryPart } from '../../../library/mplib';
import type { LibraryPart } from '../../../library/mplib';
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
  const [parts, setParts] = useState<LibraryPart[]>([]);
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

  async function exportParts(pw: string): Promise<void> {
    const docs = await listDocuments(db);
    const withFiles = new Map<string, Blob>();
    for (const doc of docs) {
      const blob = await getFile(db, doc.id);
      if (blob) withFiles.set(doc.id, blob);
    }
    if (withFiles.size === 0) throw new Error('There are no library files on this device to export.');
    const made = await packLibrary({ docs, folders: await listFolders(db), files: withFiles }, pw, { now: new Date(), partBytes: partBytes() });
    setParts(made);
    setSaved(new Set());
    setStatus(`Library ready in ${made.length} ${made.length === 1 ? 'part' : 'parts'}. Save each one.`);
    setExporting(false);
  }

  async function savePart(index: number): Promise<void> {
    const part = parts[index]!;
    try {
      const outcome = await shareOrDownload(part.fileName, new Blob([part.bytes as Uint8Array<ArrayBuffer>]));
      if (outcome === 'cancelled') return;
      setSaved((prev) => new Set(prev).add(index));
      setStatus(`Part ${index + 1} of ${parts.length} saved.`);
    } catch (err) {
      reportError(err);
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
          part = await readLibraryPart(new Uint8Array(await file.arrayBuffer()), password);
        } catch (err) {
          setProblem(`${file.name}: ${describeError(err).message}`);
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
        {parts.length > 0 && (
          <ul class="plain-list" aria-label="Parts to save">
            {parts.map((part, i) => (
              <li key={part.fileName}>
                <button type="button" class="btn btn-outline" onClick={() => void savePart(i)}>
                  {saved.has(i) ? `Save part ${i + 1} of ${parts.length} again` : `Save part ${i + 1} of ${parts.length}`}
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

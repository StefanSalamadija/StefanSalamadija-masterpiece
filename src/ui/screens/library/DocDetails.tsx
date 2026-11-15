import { useEffect, useRef, useState } from 'preact/hooks';
import { useAppState } from '../../../app/AppState';
import { reportError } from '../../../app/errors';
import { useRoute } from '../../../app/router';
import {
  deleteDocument, getFile, hasFiles, listFolders, restoreDocument, updateDocument,
} from '../../../db/library';
import type { LibraryDoc as Doc } from '../../../domain/types';
import { attachChosenFile } from '../../../library/importFiles';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Field } from '../../components/Field';
import { metaText, parseTags, statusLabel } from '../../libraryView';
import { useLive } from '../../useLive';
import './library.css';

/** Gives the file to the person: the share sheet where it takes files, else a download. */
async function openWith(blob: Blob, doc: Doc): Promise<void> {
  const file = new File([blob], doc.fileName, { type: doc.mimeType || blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: doc.title });
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) throw err;
    }
    return;
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = doc.fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function Details({ doc, hasFile, folders, onDeleted }: { doc: Doc; hasFile: boolean; folders: { id: string; name: string }[]; onDeleted: () => void }) {
  const { db } = useAppState();
  const [title, setTitle] = useState(doc.title);
  const [folderId, setFolderId] = useState(doc.folderId ?? '');
  const [tags, setTags] = useState(doc.tags.join(', '));
  const [titleError, setTitleError] = useState(false);
  const [status, setStatus] = useState('');
  const [different, setDifferent] = useState<{ answer: (use: boolean) => void }>();
  const attachInput = useRef<HTMLInputElement>(null);
  // Leaving the screen with the question open answers it No, so that the import does not wait for ever.
  const pending = useRef(different);
  pending.current = different;
  useEffect(() => () => pending.current?.answer(false), []);
  const flag = statusLabel(doc, hasFile);

  async function save(event: Event): Promise<void> {
    event.preventDefault();
    if (title.trim() === '') {
      setTitleError(true);
      return;
    }
    setTitleError(false);
    try {
      await updateDocument(db, doc.id, { title: title.trim(), folderId: folderId || undefined, tags: parseTags(tags) });
      setStatus('Saved.');
    } catch (err) {
      reportError(err);
    }
  }

  async function chooseAttach(file: File | undefined): Promise<void> {
    const input = attachInput.current;
    if (!file) return;
    try {
      const result = await attachChosenFile(db, doc, file, {
        progress: setStatus,
        confirmDifferent: () => new Promise<boolean>((resolve) => setDifferent({ answer: (use) => { setDifferent(undefined); resolve(use); } })),
      });
      if (result.status === 'duplicate') setStatus(`Already in the library as ${result.title}.`);
      else setStatus(result.status === 'attached' ? 'File attached.' : '');
    } catch (err) {
      setStatus('');
      reportError(err);
    } finally {
      if (input) input.value = '';
    }
  }

  async function remove(): Promise<void> {
    try {
      await deleteDocument(db, doc.id, new Date());
      onDeleted();
    } catch (err) {
      reportError(err);
    }
  }

  async function share(): Promise<void> {
    try {
      const blob = await getFile(db, doc.id);
      if (!blob) {
        setStatus('File not on this device.');
        return;
      }
      await openWith(blob, doc);
    } catch (err) {
      reportError(err);
    }
  }

  return (
    <>
      <p class="lib-meta">{metaText(doc)}</p>
      {flag && <p class="lib-flag">{flag}</p>}
      <form onSubmit={(event) => void save(event)} noValidate>
        <Field label="Title" value={title} onInput={setTitle} error={titleError ? { field: 'title', severity: 'error', message: 'A document needs a title.' } : undefined} />
        <div class="field">
          <label for="doc-folder">Folder</label>
          <select id="doc-folder" value={folderId} onChange={(event) => setFolderId(event.currentTarget.value)}>
            <option value="">No folder</option>
            {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
        <Field label="Tags" value={tags} onInput={setTags} hint="Separate tags with commas." />
        <div class="lib-actions">
          <button type="submit" class="btn btn-primary">Save</button>
        </div>
      </form>
      <div class="lib-actions">
        {hasFile && <button type="button" class="btn btn-outline" onClick={() => void share()}>Open with…</button>}
        {!hasFile && (
          <>
            <input id="doc-attach" ref={attachInput} type="file" class="file-input" onChange={(event) => void chooseAttach(event.currentTarget.files?.[0])} />
            <label for="doc-attach" class="btn btn-primary">Attach file</label>
          </>
        )}
        <button type="button" class="btn btn-outline" onClick={() => void remove()}>Delete</button>
      </div>
      <p class="live" role="status">{status}</p>
      {different && (
        <ConfirmDialog
          title="This is a different file. Use it anyway?" confirmLabel="Use it anyway" focusFallback={attachInput}
          body={<p>It does not match the file this document was made from.</p>}
          onCancel={() => different.answer(false)} onConfirm={() => different.answer(true)}
        />
      )}
    </>
  );
}

/** One document: rename, folder, tags, Open with…, Delete (with Undo), and Attach file when the file is not on this device. */
export function LibraryDoc() {
  const { db } = useAppState();
  const id = useRoute().params.id ?? '';
  const data = useLive(async () => {
    const [doc, folders, withFile] = await Promise.all([db.libraryDocs.get(id), listFolders(db), hasFiles(db)]);
    return { doc, folders, withFile };
  }, [db, id]);
  const [justDeleted, setJustDeleted] = useState(false);
  const [problem, setProblem] = useState<string>();
  useEffect(() => setJustDeleted(false), [id]);

  const doc = data?.doc;
  return (
    <section class="screen">
      <p><a href="#/library">Library</a></p>
      <h2>{doc && !doc.deleted ? doc.title : 'Document'}</h2>
      {data && !doc && <p class="empty">This document is not in the library.</p>}
      {doc?.deleted && (
        <div>
          <p role="status">{justDeleted ? 'Deleted.' : 'This document is in Recently deleted.'}</p>
          <div class="lib-actions">
            <button type="button" class="btn btn-primary" onClick={() => {
              restoreDocument(db, doc.id).then(() => setJustDeleted(false), (err: unknown) => setProblem(String(err)));
            }}>{justDeleted ? 'Undo' : 'Restore'}</button>
            <a class="btn btn-outline" href="#/library/deleted">Recently deleted</a>
          </div>
          {problem && <p class="field-error" role="alert">{problem}</p>}
        </div>
      )}
      {doc && !doc.deleted && (
        <Details key={doc.id} doc={doc} hasFile={data.withFile.has(doc.id)} folders={data.folders} onDeleted={() => setJustDeleted(true)} />
      )}
    </section>
  );
}

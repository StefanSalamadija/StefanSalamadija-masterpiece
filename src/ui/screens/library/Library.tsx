import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useAppState } from '../../../app/AppState';
import { reportError } from '../../../app/errors';
import { hasFiles, listDocuments, listFolders, purgeDeleted, saveFolder } from '../../../db/library';
import { importFiles } from '../../../library/importFiles';
import type { ImportResult } from '../../../library/importFiles';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Field } from '../../components/Field';
import {
  inFolder, LIBRARY_FILE_TYPES, metaText, recentlyOpened, SORT_OPTIONS, sortDocs, statusLabel, storageText,
} from '../../libraryView';
import type { SortKey } from '../../libraryView';
import { useDialogAction } from '../../useDialogAction';
import { useLive } from '../../useLive';
import './library.css';

function NewFolderDialog({ onClose }: { onClose: () => void }) {
  const { db } = useAppState();
  const { busy, failure, run } = useDialogAction();
  const [name, setName] = useState('');
  return (
    <ConfirmDialog
      title="New folder" confirmLabel="Create folder" busy={busy} error={failure} confirmDisabled={name.trim() === ''} onCancel={onClose}
      body={<Field label="Folder name" value={name} onInput={setName} maxLength={60} />}
      onConfirm={() => void run(async () => { await saveFolder(db, name); onClose(); })}
    />
  );
}

/** The knowledge library: import, folders, sort, recently opened, storage. Search is added by the next step. */
export function Library() {
  const { db } = useAppState();
  const [folderId, setFolderId] = useState<string>();
  const [sort, setSort] = useState<SortKey>('added');
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<ImportResult>();
  const [duplicate, setDuplicate] = useState<{ title: string; answer: (add: boolean) => void }>();
  const [newFolder, setNewFolder] = useState(false);
  const [storage, setStorage] = useState<string>();
  const [query, setQuery] = useState('');
  const busy = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const data = useLive(async () => {
    const [docs, folders, withFile] = await Promise.all([listDocuments(db), listFolders(db), hasFiles(db)]);
    return { docs, folders, withFile };
  }, [db]);

  // Once, when the library opens: drop the files of what was deleted more than 30 days ago.
  useEffect(() => { purgeDeleted(db, new Date()).catch(reportError); }, [db]);
  const docCount = data?.docs.length;
  useEffect(() => {
    navigator.storage?.estimate?.().then(
      ({ usage, quota }) => setStorage(usage !== undefined && quota ? storageText(usage, quota) : undefined),
      () => setStorage(undefined),
    );
  }, [docCount]);

  async function choose(files: File[]): Promise<void> {
    const input = fileInput.current;
    if (files.length === 0 || busy.current) return;
    busy.current = true;
    setResult(undefined);
    try {
      const done = await importFiles(db, files, {
        progress: setStatus,
        confirmDuplicate: (title) => new Promise<boolean>((resolve) => {
          setDuplicate({ title, answer: (add) => { setDuplicate(undefined); resolve(add); } });
        }),
      });
      setResult(done);
      setStatus(done.added.length > 0 ? `Added ${done.added.length} ${done.added.length === 1 ? 'document' : 'documents'}.` : '');
    } catch (err) {
      setStatus('');
      reportError(err);
    } finally {
      busy.current = false;
      if (input) input.value = '';
    }
  }

  const docs = useMemo(
    () => (data ? sortDocs(inFolder(data.docs, folderId, data.folders), sort) : []),
    [data, folderId, sort],
  );
  const recent = useMemo(() => (data ? recentlyOpened(data.docs) : []), [data]);

  return (
    <section class="screen">
      <div class="screen-head">
        <h2>Library</h2>
        <div class="head-actions">
          <input id="library-import" ref={fileInput} type="file" multiple class="file-input" accept={LIBRARY_FILE_TYPES}
            onChange={(event) => void choose([...(event.currentTarget.files ?? [])])} />
          <label for="library-import" class="btn btn-primary">Import documents</label>
        </div>
      </div>
      <p class="live" role="status">{status}</p>
      {result && result.failed.length > 0 && (
        <ul class="field-error" role="alert" aria-label="Files not imported">
          {result.failed.map((f) => <li key={f.name}>{f.message}</li>)}
        </ul>
      )}

      {/* The search box is wired to the search results by the next step; until then it only holds the text. */}
      <Field label="Search library" value={query} onInput={setQuery} />

      <div class="lib-chips" role="group" aria-label="Folders">
        <button type="button" class="chip" aria-current={folderId === undefined ? 'page' : undefined} onClick={() => setFolderId(undefined)}>All</button>
        {data?.folders.map((f) => (
          <button key={f.id} type="button" class="chip" aria-current={folderId === f.id ? 'page' : undefined} onClick={() => setFolderId(f.id)}>{f.name}</button>
        ))}
        <button type="button" class="chip" onClick={() => setNewFolder(true)}>+ Folder</button>
      </div>

      <div class="field">
        <label for="library-sort">Sort by</label>
        <select id="library-sort" value={sort} onChange={(event) => setSort(event.currentTarget.value as SortKey)}>
          {SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      </div>

      {data && data.docs.length === 0 && <p class="empty">No documents yet. Import manuals and documents to read and search them offline.</p>}
      {data && data.docs.length > 0 && docs.length === 0 && <p class="empty">No documents in this folder.</p>}
      {docs.length > 0 && data && (
        <ul class="lib-list" role="list" aria-label="Documents">
          {docs.map((doc) => {
            const flag = statusLabel(doc, data.withFile.has(doc.id));
            return (
              <li key={doc.id} class="card lib-row">
                <a class="lib-link" href={`#/library/doc/${doc.id}`}>{doc.title}</a>
                <span class="lib-meta">{metaText(doc)}</span>
                {flag && <span class="lib-flag">{flag}</span>}
              </li>
            );
          })}
        </ul>
      )}

      {recent.length > 0 && (
        <section class="lib-section" aria-label="Recently opened">
          <h3>Recently opened</h3>
          <ul class="lib-list" role="list">
            {recent.map((doc) => (
              <li key={doc.id} class="card lib-row"><a class="lib-link" href={`#/library/doc/${doc.id}`}>{doc.title}</a></li>
            ))}
          </ul>
        </section>
      )}

      {storage && <p class="helper-text">Storage: {storage}</p>}
      <div class="lib-links">
        <a href="#/library/deleted">Recently deleted</a>
        <a href="#/library/files">Library files</a>
      </div>

      {duplicate && (
        <ConfirmDialog
          title={`Already in the library as ${duplicate.title}. Import again?`} confirmLabel="Import again" focusFallback={fileInput}
          body={<p>This file has the same content as a document already in the library. Import it again?</p>}
          onCancel={() => duplicate.answer(false)} onConfirm={() => duplicate.answer(true)}
        />
      )}
      {newFolder && <NewFolderDialog onClose={() => setNewFolder(false)} />}
    </section>
  );
}

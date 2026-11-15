import { useState } from 'preact/hooks';
import { useAppState } from '../../../app/AppState';
import { reportError } from '../../../app/errors';
import { purgeDocument, restoreDocument } from '../../../db/library';
import { listDocuments } from '../../../db/library';
import type { LibraryDoc } from '../../../domain/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { deletedText, restorable } from '../../libraryView';
import { useDialogAction } from '../../useDialogAction';
import { useLive } from '../../useLive';
import './library.css';

function DeleteNowDialog({ doc, onClose }: { doc: LibraryDoc; onClose: () => void }) {
  const { db } = useAppState();
  const { busy, failure, run } = useDialogAction();
  return (
    <ConfirmDialog
      title={`Delete ${doc.title} now?`} confirmLabel="Delete now" danger busy={busy} error={failure} onCancel={onClose}
      body={<p>Its file and text are removed from this device at once, and it cannot be restored.</p>}
      onConfirm={() => void run(async () => { await purgeDocument(db, doc.id, new Date()); onClose(); })}
    />
  );
}

/** The documents deleted in the last 30 days, each with Restore and Delete now. */
export function LibraryDeleted() {
  const { db } = useAppState();
  const docs = useLive(async () => restorable(await listDocuments(db, { deleted: true }), new Date()), [db]);
  const [purging, setPurging] = useState<LibraryDoc>();
  return (
    <section class="screen">
      <div class="screen-head"><h2>Recently deleted</h2></div>
      <p class="helper-text">Deleted documents can be restored for 30 days; then their files and text are removed from this device.</p>
      {docs?.length === 0 && <p class="empty">Nothing deleted.</p>}
      {docs && docs.length > 0 && (
        <ul class="lib-list" role="list" aria-label="Deleted documents">
          {docs.map((doc) => (
            <li key={doc.id} class="card lib-row">
              <span class="lib-link">{doc.title}</span>
              <span class="lib-meta">{doc.deletedAt ? deletedText(doc.deletedAt) : 'Deleted'}</span>
              <div class="lib-row-actions">
                <button type="button" class="btn btn-outline btn-small" onClick={() => restoreDocument(db, doc.id).catch(reportError)}>Restore</button>
                <button type="button" class="btn btn-outline btn-small" onClick={() => setPurging(doc)}>Delete now</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p><a href="#/library">Back to Library</a></p>
      {purging && <DeleteNowDialog doc={purging} onClose={() => setPurging(undefined)} />}
    </section>
  );
}

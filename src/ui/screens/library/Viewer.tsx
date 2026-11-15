import { useEffect, useState } from 'preact/hooks';
import { useAppState } from '../../../app/AppState';
import { reportError } from '../../../app/errors';
import { getFile } from '../../../db/library';
import type { LibraryDoc } from '../../../domain/types';
import { parseDocParams } from '../../../library/highlight';
import { queryWords } from '../../../library/search';
import { DocxView } from './DocxView';
import { ImageView } from './ImageView';
import { openWith } from './openWith';
import { PdfView } from './PdfView';
import { XlsxView } from './XlsxView';

/** The `page` and `q` of the hash (the router ignores the query string, so the viewer reads it itself). */
function useDocParams() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const update = (): void => setHash(window.location.hash);
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return parseDocParams(hash);
}

/** Shows the document's file by its kind. Renders nothing while the file is not on this device (the details offer to attach it). */
export function Viewer({ doc }: { doc: LibraryDoc }) {
  const { db } = useAppState();
  const { page, q } = useDocParams();
  const [blob, setBlob] = useState<Blob>();
  useEffect(() => {
    let live = true;
    setBlob(undefined);
    getFile(db, doc.id).then((file) => { if (live) setBlob(file); }, reportError);
    return () => { live = false; };
  }, [db, doc.id, doc.sha256]);
  if (!blob) return null;

  const share = (): void => { openWith(blob, doc).catch(reportError); };
  const words = queryWords(q);
  const openButton = <div class="lib-actions"><button type="button" class="btn btn-outline" onClick={share}>Open with…</button></div>;
  switch (doc.kind) {
    case 'pdf':
      return <PdfView key={`${page}|${q}`} blob={blob} docId={doc.id} page={page} q={q} onOpenWith={share} />;
    case 'docx':
      return <><DocxView key={q} blob={blob} words={words} />{openButton}</>;
    case 'xlsx':
      return <><XlsxView key={`${page}|${q}`} blob={blob} words={words} initial={page} />{openButton}</>;
    case 'image':
      return <><ImageView blob={blob} title={doc.title} />{openButton}</>;
    default:
      return <><p class="helper-text">This file opens in another app.</p>{openButton}</>;
  }
}

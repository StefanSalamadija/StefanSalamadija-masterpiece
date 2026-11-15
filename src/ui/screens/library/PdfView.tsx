import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useAppState } from '../../../app/AppState';
import { reportError } from '../../../app/errors';
import { navigate } from '../../../app/router';
import { partsWithWords } from '../../../library/highlight';
import { loadPdf } from '../../../library/pdfjs';
import { queryWords } from '../../../library/search';
import { PdfPage } from './PdfPage';

const WINDOW = 2;
const ZOOM_STEP = 1.25;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const PAD = 8;

interface Props {
  blob: Blob;
  docId: string;
  /** The page to open on, and the query whose words are marked, from the hash. */
  page?: number;
  q: string;
  onOpenWith: () => void;
}

/** A PDF: pages drawn only near the one on view, a toolbar (page, zoom, fit width) and Find across the stored text. */
export function PdfView({ blob, docId, page, q, onOpenWith }: Props) {
  const { db } = useAppState();
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [sizes, setSizes] = useState<{ w: number; h: number }[]>();
  const [failed, setFailed] = useState(false);
  const [current, setCurrent] = useState(page ?? 1);
  const [pageText, setPageText] = useState(String(page ?? 1));
  const [zoom, setZoom] = useState(1);
  const [boxWidth, setBoxWidth] = useState(0);
  const [find, setFind] = useState('');
  const [found, setFound] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const visible = useRef(new Map<number, number>());
  const count = pdf?.numPages ?? 0;

  useEffect(() => {
    let live = true;
    let loaded: PDFDocumentProxy | undefined;
    (async () => {
      loaded = await loadPdf(await blob.arrayBuffer());
      const doc = loaded;
      // Every page's own size, so that the room held for a page not drawn yet is right and a jump lands on the page.
      const all = await Promise.all(Array.from({ length: doc.numPages }, async (_, i) => {
        const view = (await doc.getPage(i + 1)).getViewport({ scale: 1 });
        return { w: view.width, h: view.height };
      }));
      if (!live) {
        void doc.loadingTask.destroy(); // the screen was left while it loaded
        return;
      }
      setSizes(all);
      setPdf(doc);
    })().catch((err: unknown) => {
      if (!live) void loaded?.loadingTask.destroy();
      else {
        setFailed(true);
        reportError(err);
      }
    });
    // Also when it is still loading: the document is destroyed as soon as it exists.
    return () => { live = false; void loaded?.loadingTask.destroy(); };
  }, [blob]);

  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const watch = new ResizeObserver(() => setBoxWidth(el.clientWidth));
    watch.observe(el);
    setBoxWidth(el.clientWidth);
    return () => watch.disconnect();
  }, []);

  const fit = sizes && boxWidth > 0 ? (boxWidth - 2 * PAD) / Math.max(...sizes.map((z) => z.w)) : 0;
  const scale = fit * zoom;

  const goto = (n: number): void => {
    const target = Math.min(Math.max(1, Math.round(n)), Math.max(1, count));
    setCurrent(target);
    const el = box.current?.querySelector<HTMLElement>(`.pdf-page[data-page="${target}"]`);
    if (el && box.current) box.current.scrollTop = el.offsetTop - PAD;
  };
  const gotoRef = useRef(goto);
  gotoRef.current = goto;

  // Open on the page asked for, and keep the page on view when the zoom or the width changes the page heights.
  useLayoutEffect(() => {
    if (scale > 0 && count > 0) gotoRef.current(current);
  }, [scale > 0, count, scale]);

  // The page on view is the one that most of the box shows.
  useEffect(() => {
    const root = box.current;
    if (!root || count === 0) return undefined;
    const seen = visible.current;
    const watch = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const n = Number((e.target as HTMLElement).dataset.page);
        if (e.isIntersecting) seen.set(n, e.intersectionRect.height); else seen.delete(n);
      }
      let best = 0;
      let most = -1;
      for (const [n, h] of seen) if (h > most || (h === most && n < best)) { best = n; most = h; }
      if (best > 0) setCurrent(best);
    }, { root, threshold: [0, 0.25, 0.5, 0.75, 1] });
    root.querySelectorAll('.pdf-page').forEach((el) => watch.observe(el));
    return () => { watch.disconnect(); seen.clear(); };
  }, [count, scale > 0]);

  // The page number follows the page on view, but not while a number is being typed.
  const pageInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (document.activeElement !== pageInput.current) setPageText(String(current));
  }, [current]);

  const [rows, setRows] = useState<{ part: number; text: string }[]>([]);
  useEffect(() => {
    let live = true;
    void db.libraryText.where('docId').equals(docId).toArray().then((r) => { if (live) setRows(r); });
    return () => { live = false; };
  }, [db, docId]);

  const findWords = useMemo(() => queryWords(find), [find]);
  const words = useMemo(() => (findWords.length > 0 ? findWords : queryWords(q)), [findWords, q]);

  function step(direction: 1 | -1): void {
    const pages = partsWithWords(rows, words);
    if (pages.length === 0) {
      setFound('No matches.');
      return;
    }
    const next = direction === 1 ? pages.find((p) => p > current) ?? pages[0] : [...pages].reverse().find((p) => p < current) ?? pages[pages.length - 1];
    setFound(`Match ${pages.indexOf(next) + 1} of ${pages.length}, on page ${next}.`);
    goto(next);
  }

  const zoomBy = (factor: number): void => setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor)));

  return (
    <div class="viewer">
      <div class="viewer-bar" role="toolbar" aria-label="Document">
        <button type="button" class="btn btn-outline" onClick={() => (window.history.length > 1 ? window.history.back() : navigate('/library'))}>Back</button>
        <button type="button" class="btn btn-outline" aria-label="Previous page" disabled={current <= 1} onClick={() => goto(current - 1)}>‹</button>
        <form class="viewer-page" onSubmit={(event) => { event.preventDefault(); goto(Number(pageText) || current); event.currentTarget.querySelector('input')?.blur(); }}>
          <input ref={pageInput} aria-label="Go to page" inputMode="numeric" value={pageText} disabled={count === 0}
            onInput={(event) => setPageText(event.currentTarget.value)} onBlur={() => setPageText(String(current))} />
          <span>/ {count || '…'}</span>
        </form>
        <button type="button" class="btn btn-outline" aria-label="Next page" disabled={current >= count} onClick={() => goto(current + 1)}>›</button>
        <button type="button" class="btn btn-outline" aria-label="Zoom out" disabled={zoom <= MIN_ZOOM} onClick={() => zoomBy(1 / ZOOM_STEP)}>−</button>
        <button type="button" class="btn btn-outline" aria-label="Zoom in" disabled={zoom >= MAX_ZOOM} onClick={() => zoomBy(ZOOM_STEP)}>+</button>
        <button type="button" class="btn btn-outline" onClick={() => setZoom(1)}>Fit width</button>
        <button type="button" class="btn btn-outline" onClick={onOpenWith}>Open with…</button>
      </div>
      <form class="viewer-bar viewer-find" onSubmit={(event) => { event.preventDefault(); step(1); }}>
        <input type="search" aria-label="Find in document" placeholder="Find in document" value={find} onInput={(event) => { setFind(event.currentTarget.value); setFound(''); }} />
        <button type="button" class="btn btn-outline" aria-label="Previous match" disabled={words.length === 0} onClick={() => step(-1)}>↑</button>
        <button type="submit" class="btn btn-outline" aria-label="Next match" disabled={words.length === 0}>↓</button>
      </form>
      <p class="helper-text" aria-live="polite">{found}</p>
      {failed && <p class="field-error" role="alert">This PDF could not be displayed.</p>}
      <div class="viewer-box pdf-view" ref={box}>
        {!pdf && !failed && <p class="helper-text">Loading…</p>}
        {pdf && sizes && scale > 0 && (
          <div class="pdf-pages">
            {Array.from({ length: count }, (_, i) => i + 1).map((n) => (
              <PdfPage key={n} pdf={pdf} n={n} scale={scale} size={sizes[n - 1]} words={words} active={Math.abs(n - current) <= WINDOW} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

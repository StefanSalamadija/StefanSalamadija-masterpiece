import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useEffect, useRef, useState } from 'preact/hooks';
import { reportError } from '../../../app/errors';
import { clearMarks, markWords } from './markDom';

interface Props {
  pdf: PDFDocumentProxy;
  n: number;
  scale: number;
  /** The size of page 1 at scale 1, which holds the place of a page that has not been drawn yet. */
  base: { w: number; h: number };
  /** Drawn only while near the page on view; otherwise its canvas and text layer are dropped. */
  active: boolean;
  words: string[];
}

/** One page: a canvas at the device pixel ratio, and pdf.js's text layer over it with the words marked. */
export function PdfPage({ pdf, n, scale, base, active, words }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>();
  const latest = useRef(words);
  latest.current = words;

  useEffect(() => {
    const el = host.current;
    if (!el) return undefined;
    if (!active) {
      el.replaceChildren();
      return undefined;
    }
    let cancelled = false;
    let cleanup = (): void => undefined;
    (async () => {
      const [{ TextLayer }, page] = await Promise.all([import('pdfjs-dist'), pdf.getPage(n)]);
      if (cancelled) return;
      const natural = page.getViewport({ scale: 1 });
      setSize({ w: natural.width, h: natural.height });
      const viewport = page.getViewport({ scale });
      const ratio = window.devicePixelRatio || 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const task = page.render({ canvas, viewport, ...(ratio !== 1 ? { transform: [ratio, 0, 0, ratio, 0, 0] } : {}) });
      const textDiv = document.createElement('div');
      textDiv.className = 'textLayer';
      const layer = new TextLayer({ textContentSource: page.streamTextContent(), container: textDiv, viewport });
      cleanup = () => { task.cancel(); layer.cancel(); page.cleanup(); };
      await task.promise;
      if (cancelled) return;
      el.replaceChildren(canvas, textDiv);
      await layer.render();
      if (!cancelled) markWords(textDiv, latest.current);
    })().catch((err: unknown) => {
      // A render that was cancelled by scrolling away or zooming ends in an exception of its own: that is not a failure.
      if (!cancelled) reportError(err);
    });
    return () => { cancelled = true; cleanup(); };
  }, [pdf, n, scale, active]);

  useEffect(() => {
    const layer = host.current?.querySelector('.textLayer');
    if (!layer) return;
    clearMarks(layer);
    markWords(layer, words);
  }, [words]);

  const w = (size?.w ?? base.w) * scale;
  const h = (size?.h ?? base.h) * scale;
  return (
    <div class="pdf-page" data-page={n} style={{ width: `${w}px`, height: `${h}px`, '--total-scale-factor': scale }}>
      <div class="pdf-page-body" ref={host} />
    </div>
  );
}

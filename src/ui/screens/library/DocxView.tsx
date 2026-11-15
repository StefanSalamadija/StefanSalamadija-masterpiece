import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { docxBlocks } from '../../../library/docxBlocks';
import type { DocxBlock } from '../../../library/docxBlocks';
import { Marked } from './Marked';

/** A Word document as headings, paragraphs and tables, with the words marked; scrolled to the first one. */
export function DocxView({ blob, words }: { blob: Blob; words: string[] }) {
  const [blocks, setBlocks] = useState<DocxBlock[]>();
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    blob.arrayBuffer().then((data) => { if (live) setBlocks(docxBlocks(data)); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [blob]);
  const key = useMemo(() => words.join(' '), [words]);
  useEffect(() => {
    const first = box.current?.querySelector('mark');
    const root = box.current;
    if (!first || !root) return;
    const top = first.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
    root.scrollTo({ top: Math.max(0, top - root.clientHeight / 3) });
  }, [blocks, key]);
  if (failed) return <p class="field-error" role="alert">This document could not be displayed.</p>;
  return (
    <div class="viewer">
      <div class="viewer-box docx-view" ref={box}>
        {!blocks && <p class="helper-text">Loading…</p>}
        {blocks?.map((b, i) => {
          if (b.type === 'table') {
            return (
              <table key={i}>
                <tbody>
                  {b.rows.map((row, r) => (
                    <tr key={r}>{row.map((cell, c) => <td key={c}>{cell.split('\n').map((line, l) => <p key={l}><Marked text={line} words={words} /></p>)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            );
          }
          const Tag = b.level ? (`h${b.level}` as 'h2' | 'h3' | 'h4') : 'p';
          return <Tag key={i}><Marked text={b.text} words={words} /></Tag>;
        })}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'preact/hooks';
import * as XLSX from 'xlsx';
import { matchRanges } from '../../../library/highlight';
import { Marked } from './Marked';

const MAX_ROWS = 1000;

interface Sheet { name: string; rows: string[][]; cut: boolean }

/** The sheets of a workbook, as rows of cell text (the displayed values), so that the table is built from data and not from HTML. */
function readSheets(data: ArrayBuffer): Sheet[] {
  const book = XLSX.read(new Uint8Array(data), { type: 'array', cellDates: false });
  return book.SheetNames.map((name) => {
    const all = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, raw: false, defval: '', blankrows: false })
      .map((r) => r.map((c) => String(c)));
    return { name, rows: all.slice(0, MAX_ROWS), cut: all.length > MAX_ROWS };
  });
}

/** Sheet tabs, each sheet a table, with the words marked. Opens on `initial` (a sheet number from 1), else the first sheet that has a word. */
export function XlsxView({ blob, words, initial }: { blob: Blob; words: string[]; initial?: number }) {
  const [sheets, setSheets] = useState<Sheet[]>();
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState<number>();
  useEffect(() => {
    let live = true;
    blob.arrayBuffer().then(readSheets).then((read) => {
      if (!live) return;
      setSheets(read);
      const wanted = initial !== undefined && initial >= 1 && initial <= read.length ? initial - 1
        : read.findIndex((s) => s.rows.some((r) => r.some((c) => matchRanges(c, words).length > 0)));
      setActive(Math.max(0, wanted));
    }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [blob]);
  if (failed) return <p class="field-error" role="alert">This workbook could not be displayed.</p>;
  const sheet = sheets && active !== undefined ? sheets[active] : undefined;
  return (
    <div class="viewer">
      {sheets && (
        <div class="viewer-tabs" role="tablist" aria-label="Sheets">
          {sheets.map((s, i) => (
            <button key={i} type="button" role="tab" class="chip" aria-selected={i === active} onClick={() => setActive(i)}>{s.name}</button>
          ))}
        </div>
      )}
      <div class="viewer-box xlsx-view" role="tabpanel">
        {!sheet && <p class="helper-text">Loading…</p>}
        {sheet && (
          <table>
            <tbody>
              {sheet.rows.map((row, r) => (
                <tr key={r}>{row.map((cell, c) => <td key={c}><Marked text={cell} words={words} /></td>)}</tr>
              ))}
            </tbody>
          </table>
        )}
        {sheet?.cut && <p class="helper-text">Showing the first {MAX_ROWS} rows.</p>}
      </div>
    </div>
  );
}

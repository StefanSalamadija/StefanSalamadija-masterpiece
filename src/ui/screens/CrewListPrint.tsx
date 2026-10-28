import { useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useAppState } from '../../app/AppState';
import { reportError } from '../../app/errors';
import { shareOrDownload } from '../../backup/share';
import { listForShip, updateRecord } from '../../db/records';
import { buildCrewList, CREW_LIST_COLUMNS, crewListColumnsOf, crewListFileName, masterName, shownColumns } from '../../domain/crewList';
import { formatDisplayDate } from '../../domain/dates';
import type { CrewDocument, CrewListColumn, CrewMember, ShipProfile, Voyage } from '../../domain/types';
import { currentVoyage } from '../../domain/voyage';
import { Field } from '../components/Field';
import { LogoMark } from '../components/LogoMark';
import { crewListView, resolveAsAt } from '../crewListView';
import { useLive } from '../useLive';

const EXCEL_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const LAST_COLUMN = 'Choose at least one column.';
const EXPORTED = 'Crew list exported.';
const EXPORT_CANCELLED = 'Export cancelled.';
/** More columns than this are printed in a smaller type, to fit the width of an A4 page in landscape. */
const MAX_COLUMNS_AT_FULL_SIZE = 11;
/** On <html> while the sheet is open: what print.css keys the page of the sheet on (see there). */
const PRINTING_CLASS = 'printing-crew-list';

/** One detail of the sheet's heading, such as `Vessel MV OCEAN STAR`. */
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <span class="sheet-detail">
      <span class="sheet-key">{label}</span>{' '}
      <strong class="sheet-value">{value}</strong>
    </span>
  );
}

/**
 * The crew list as a sheet for the Master to sign and stamp, with the options above it that are not printed: the port, the
 * date, the columns, and the buttons that print it or export it to Excel. The crew list screen's filter (onboard or all)
 * and As-at date are carried over from where that screen was left; the date can be changed here.
 *
 * The columns are saved with the ship at once. They are kept here too, so that a second tap never works from a ship record
 * that has not yet been read back, and a failed save does not stop the sheet from printing.
 */
function CrewListSheet({ ship }: { ship: ShipProfile }) {
  const { db, shipToday } = useAppState();
  const data = useLive(
    async () => {
      const [crew, docs, voyages] = await Promise.all([
        listForShip<CrewMember>(db, 'crew', ship.id),
        listForShip<CrewDocument>(db, 'crewDocuments', ship.id),
        listForShip<Voyage>(db, 'voyages', ship.id),
      ]);
      return { crew, docs, nextPort: currentVoyage(voyages)?.nextPort ?? '' };
    },
    [db, ship.id],
  );
  // What the crew list screen was left showing, taken once when this opens.
  const [{ view, asAt }] = useState(crewListView);
  const [dateText, setDateText] = useState(() => resolveAsAt(asAt, shipToday));
  /** `undefined` until the port is typed in: the field then shows the next port of the ship's voyage. */
  const [portText, setPortText] = useState<string>();
  const [columns, setColumns] = useState(() => crewListColumnsOf(ship));
  const [columnProblem, setColumnProblem] = useState('');
  const [status, setStatus] = useState('');
  const exporting = useRef(false);
  /** The saves of the columns, one after the other, so that the last choice is the one that stays. */
  const saves = useRef<Promise<unknown>>(Promise.resolve());
  const titleId = useId();

  // A layout effect, so that the class is in place before the first paint and gone as soon as the sheet is (an ordinary
  // effect is cleaned up after the next paint).
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.add(PRINTING_CLASS);
    return () => root.classList.remove(PRINTING_CLASS);
  }, []);

  /** An option changed, so the file that was exported before is not the one the sheet shows now. */
  const edited = (): void => setStatus('');

  if (!data) return null;
  const date = resolveAsAt(dateText, shipToday);
  const port = (portText ?? data.nextPort).trim();
  const table = buildCrewList({ crew: data.crew, docs: data.docs, columns, asAt: date, filter: view });
  const shown = shownColumns(columns); // the columns of `table`, whose kinds say how the cells may be broken
  const master = masterName(data.crew, date);

  function choose(key: CrewListColumn, on: boolean, box: HTMLInputElement): void {
    const next = CREW_LIST_COLUMNS.filter((c) => (c.key === key ? on : columns.includes(c.key))).map((c) => c.key);
    if (next.length === 0) {
      box.checked = true; // the box is only taken off when the choice is kept
      setColumnProblem(LAST_COLUMN);
      return;
    }
    edited();
    setColumnProblem('');
    setColumns(next);
    saves.current = saves.current
      .then(() => updateRecord<ShipProfile>(db, 'ships', ship.id, { crewListColumns: next }))
      .then(() => undefined, reportError);
  }

  async function exportToExcel(): Promise<void> {
    if (exporting.current) return;
    exporting.current = true;
    setStatus('');
    try {
      // SheetJS is most of the app's size and only the export needs it, so it is loaded now and not with the app. The
      // service worker keeps it for offline use.
      const writer = await import('../../domain/crewListWorkbook').catch((cause: unknown) => {
        throw new Error("The Excel writer couldn't be loaded. Reload the app and try again.", { cause });
      });
      const workbook = writer.crewListWorkbook({ ship, port, date, table });
      const outcome = await shareOrDownload(crewListFileName(ship.particulars.name, date), new Blob([workbook], { type: EXCEL_TYPE }));
      setStatus(outcome === 'cancelled' ? EXPORT_CANCELLED : EXPORTED);
    } catch (err) {
      reportError(err);
    } finally {
      exporting.current = false;
    }
  }

  const { name, imo, callSign, flag } = ship.particulars;
  return (
    <section class="screen">
      <div class="crew-list-options no-print">
        <h2>Print crew list</h2>
        <div class="form-grid">
          <Field label="Port" value={portText ?? data.nextPort} onInput={(text) => { edited(); setPortText(text); }} />
          <Field label="Date" type="date" value={dateText} onInput={(text) => { edited(); setDateText(text); }} />
        </div>
        <fieldset class="column-picker">
          <legend>Columns</legend>
          <div class="column-grid">
            {CREW_LIST_COLUMNS.map((column) => (
              <label key={column.key} class="check">
                <input
                  type="checkbox" checked={columns.includes(column.key)}
                  onChange={(event) => choose(column.key, event.currentTarget.checked, event.currentTarget)}
                />
                <span>{column.label}</span>
              </label>
            ))}
          </div>
          {columnProblem && <p class="field-error" role="alert">{columnProblem}</p>}
        </fieldset>
        <div class="form-actions">
          <button type="button" class="btn btn-primary" onClick={() => window.print()}>Print</button>
          <button type="button" class="btn btn-outline" onClick={() => void exportToExcel()}>Export to Excel</button>
        </div>
        {/* Always on the page, with its text set after it is there, so that it is announced. */}
        <p class="live" role="status">{status}</p>
      </div>

      <article class="crew-list-sheet" data-testid="crew-list-sheet" aria-labelledby={titleId}>
        <h2 id={titleId} class="sheet-title">CREW LIST</h2>
        <p class="sheet-details">
          <Detail label="Vessel" value={name} />{' '}
          <Detail label="IMO" value={imo} />{' '}
          <Detail label="Call sign" value={callSign} />{' '}
          <Detail label="Flag" value={flag} />
        </p>
        <p class="sheet-details">
          <Detail label="Port" value={port} />{' '}
          <Detail label="Date" value={formatDisplayDate(date)} />
        </p>
        <div class="sheet-table-wrap" role="region" aria-label="Crew list table" tabIndex={0}>
          <table class={shown.length > MAX_COLUMNS_AT_FULL_SIZE ? 'sheet-table sheet-table-dense' : 'sheet-table'} aria-labelledby={titleId}>
            <thead>
              <tr>{table.headers.map((header) => <th key={header} scope="col">{header}</th>)}</tr>
            </thead>
            <tbody>
              {table.rows.map((row, i) => (
                <tr key={i}>{row.map((text, j) => <td key={shown[j].key} class={`col-${shown[j].kind}`}>{text}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
        <div class="sheet-sign">
          <div class="sheet-master">
            <p class="sheet-master-line">Master: <strong class="sheet-value">{master}</strong></p>
            <p class="sheet-signature">Signature</p>
          </div>
          <div class="sheet-stamp">Ship's stamp</div>
        </div>
        <p class="sheet-footer">
          <LogoMark size={16} mode="mono" />
          <span>Printed with Masterpiece</span>
        </p>
      </article>
    </section>
  );
}

/** The active ship's crew list as a printable sheet and an Excel file. */
export function CrewListPrint() {
  const { activeShip } = useAppState();
  if (!activeShip) return null;
  // Keyed by ship, so that switching ships does not carry the choices across.
  return <CrewListSheet key={activeShip.id} ship={activeShip} />;
}

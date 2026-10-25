import type { ComponentChildren } from 'preact';
import { useEffect, useId, useMemo, useRef, useState } from 'preact/hooks';
import { useAppState } from '../../app/AppState';
import { reportError } from '../../app/errors';
import { setFlash } from '../../app/flash';
import { navigate } from '../../app/router';
import { importCrew } from '../../db/crewImport';
import { listForShip } from '../../db/records';
import { applySavedMapping, toSavedMapping } from '../../domain/crewImport/mapping';
import type { ColumnMapping } from '../../domain/crewImport/mapping';
import { importPlan } from '../../domain/crewImport/plan';
import { buildPreview } from '../../domain/crewImport/preview';
// Types only: SheetJS comes with `readSpreadsheet`, which is loaded when a file is chosen (see `readFile`).
import type { SheetGrid } from '../../domain/crewImport/readSpreadsheet';
import { recheckRows } from '../../domain/crewImport/recheck';
import type { CrewField, CrewMember, DateFormat, ShipProfile } from '../../domain/types';
import { Field } from '../components/Field';
import { FixRow, PreviewItem } from '../components/ImportRows';
import {
  applyEdits, columnLabel, firstSheetWithData, fullNameIgnored, headerRowMessage, importCount, MAPPING_FIELDS, parseHeaderRow,
  previewSummary, shownColumns, sheetSettings, withColumnField,
} from '../crewImportView';
import type { RowEdit, RowEdits } from '../crewImportView';
import { useLive } from '../useLive';

const FILE_TYPES = '.xlsx,.xls,.csv';

/** What the wizard knows once a file is read. Changing any of it starts the preview again. */
interface Loaded {
  fileName: string;
  sheets: SheetGrid[];
  sheetIndex: number;
  /** The header row as typed, 1-based. */
  headerText: string;
  mapping: ColumnMapping;
  dateFormat: DateFormat;
  defaultSignOn: string;
}

type ReadResult = { sheets: SheetGrid[] } | { problem: string };

/**
 * Reads the file with SheetJS, which is loaded now and not with the app: it is most of the app's size, and only this
 * screen needs it. The service worker keeps it for offline use. A file that cannot be read gives the reason to show.
 */
async function readFile(file: File): Promise<ReadResult> {
  const reader = await import('../../domain/crewImport/readSpreadsheet').catch(() => {
    throw new Error("The spreadsheet reader couldn't be loaded. Reload the app and try again.");
  });
  try {
    return { sheets: await reader.readSpreadsheet(file.name, await file.arrayBuffer()) };
  } catch (err) {
    if (err instanceof reader.SpreadsheetError) return { problem: err.message };
    throw err;
  }
}

function SelectField({ label, value, onChange, children }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ComponentChildren;
}) {
  const id = useId();
  return (
    <div class="field">
      <label for={id}>{label}</label>
      <select id={id} value={value} onChange={(event) => onChange(event.currentTarget.value)}>{children}</select>
    </div>
  );
}

function ImportWizard({ ship }: { ship: ShipProfile }) {
  const { db, shipToday } = useAppState();
  const existing = useLive(() => listForShip<CrewMember>(db, 'crew', ship.id), [db, ship.id]);
  const [loaded, setLoaded] = useState<Loaded>();
  const [edits, setEdits] = useState<RowEdits>({});
  const [fixing, setFixing] = useState<number>();
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState<string>();
  /** How many crew are being imported, while that is going on. */
  const [importing, setImporting] = useState<number>();
  const latestRead = useRef(0);
  const lastFixed = useRef<number | undefined>(undefined);
  const fileId = useId();

  const grid = loaded?.sheets[loaded.sheetIndex];
  const rowCount = grid?.rows.length ?? 0;
  const headerNumber = loaded && parseHeaderRow(loaded.headerText, rowCount);
  const headerRow = headerNumber === undefined ? undefined : headerNumber - 1;
  const today = shipToday;

  // What the file says, and then with what the user did to it, so that every fix and every skip is checked against the other rows.
  const built = useMemo(() => {
    if (!loaded || !grid || headerRow === undefined || !existing) return [];
    return buildPreview({
      rows: grid.rows, headerRow, mapping: loaded.mapping, dateFormat: loaded.dateFormat, existing,
      currentYear: Number(today.slice(0, 4)), today, defaultSignOnDate: loaded.defaultSignOn,
    });
  }, [grid, headerRow, loaded?.mapping, loaded?.dateFormat, loaded?.defaultSignOn, existing, today]);
  const rows = useMemo(
    () => (existing ? recheckRows(applyEdits(built, edits), existing, today) : []),
    [built, edits, existing, today],
  );
  const columns = useMemo(() => (grid && headerRow !== undefined ? shownColumns(grid.rows, headerRow) : []), [grid, headerRow]);

  // Back from the fix form, the focus returns to the row that was fixed.
  useEffect(() => {
    if (fixing !== undefined || lastFixed.current === undefined) return;
    document.getElementById(`import-row-${lastFixed.current}`)?.focus();
    lastFixed.current = undefined;
  }, [fixing]);

  if (!existing) return null;

  /** Changes what the preview is made from; whatever was fixed or skipped is dropped with it. */
  function change(patch: Partial<Loaded>): void {
    setLoaded((current) => current && { ...current, ...patch });
    setEdits({});
  }

  async function choose(file: File | undefined): Promise<void> {
    const mine = ++latestRead.current;
    setLoaded(undefined);
    setEdits({});
    setFixing(undefined);
    setProblem(undefined);
    setReading(file !== undefined);
    if (!file) return;
    try {
      const result = await readFile(file);
      if (mine !== latestRead.current) return;
      if ('problem' in result) {
        setProblem(result.problem);
        return;
      }
      const sheetIndex = firstSheetWithData(result.sheets);
      setLoaded({
        fileName: file.name, sheets: result.sheets, sheetIndex, ...sheetSettings(result.sheets[sheetIndex].rows, ship.crewImportMapping),
        dateFormat: ship.crewImportMapping?.dateFormat ?? 'day-first', defaultSignOn: shipToday,
      });
    } catch (err) {
      if (mine === latestRead.current) reportError(err);
    } finally {
      if (mine === latestRead.current) setReading(false);
    }
  }

  function typeHeaderRow(text: string): void {
    const number = parseHeaderRow(text, rowCount);
    change(number === undefined || !grid ? { headerText: text } : { headerText: text, mapping: applySavedMapping(grid.rows[number - 1], ship.crewImportMapping) });
  }

  function edit(rowNumber: number, what: RowEdit): void {
    setEdits((current) => ({ ...current, [rowNumber]: { ...current[rowNumber], ...what } }));
  }

  async function runImport(): Promise<void> {
    if (importing !== undefined || !loaded || !grid || headerRow === undefined || !existing) return;
    const plan = importPlan(rows, existing);
    setImporting(plan.creates.length + plan.updates.length);
    try {
      const mapping = toSavedMapping(grid.rows[headerRow], loaded.mapping, loaded.dateFormat);
      const count = await importCrew(db, ship, plan, mapping, loaded.fileName);
      setFlash(`Imported ${count} crew.`);
      navigate('/ship/crew');
    } catch (err) {
      reportError(err);
      setImporting(undefined);
    }
  }

  const fixRow = fixing === undefined ? undefined : rows.find((row) => row.rowNumber === fixing);

  const fieldOfColumn = new Map((Object.entries(loaded?.mapping ?? {}) as [string, number][]).map(([field, column]) => [column, field]));
  const header = grid && headerRow !== undefined ? grid.rows[headerRow] : undefined;
  const count = importCount(rows);
  const summary = previewSummary(rows);

  // While a row is fixed only its form is shown. The file input stays (hidden), so that it still names the file that is loaded.
  return (
    <>
      <section class="screen" hidden={fixRow !== undefined}>
        <h2>Import crew from Excel</h2>
        <div class="import-form">
          <div class="field">
            <label for={fileId}>Crew list file</label>
            <input
              id={fileId} type="file" accept={FILE_TYPES} aria-invalid={problem ? 'true' : undefined}
              onChange={(event) => void choose(event.currentTarget.files?.[0])}
            />
            <p class="helper-text">An Excel (.xlsx, .xls) or CSV file. It is read on this device and goes nowhere else.</p>
            {reading && <p class="helper-text" role="status">Reading file…</p>}
            {problem && <p class="field-error" role="alert">{problem}</p>}
          </div>

          {!fixRow && loaded && grid && (
            <>
              <SelectField
                label="Sheet" value={String(loaded.sheetIndex)}
                onChange={(value) => {
                  const sheetIndex = Number(value);
                  change({ sheetIndex, ...sheetSettings(loaded.sheets[sheetIndex].rows, ship.crewImportMapping) });
                }}
              >
                {loaded.sheets.map((sheet, index) => <option key={index} value={index}>{sheet.name}</option>)}
              </SelectField>

              {rowCount === 0 && <p class="empty">This sheet is empty.</p>}
              {rowCount > 0 && (
                <Field
                  label="Header row" inputMode="numeric" value={loaded.headerText} onInput={typeHeaderRow}
                  error={headerNumber === undefined ? { field: 'headerRow', message: headerRowMessage(rowCount), severity: 'error' } : undefined}
                />
              )}

              {header && (
                <>
                  <div class="import-section" role="group" aria-labelledby={`${fileId}-columns`}>
                    <h3 id={`${fileId}-columns`}>Columns</h3>
                    <p class="helper-text">Choose what each column of the sheet holds.</p>
                    <div class="mapping-grid">
                      {columns.map((column) => (
                        <SelectField
                          key={column} label={columnLabel(header, column)} value={fieldOfColumn.get(column) ?? ''}
                          onChange={(value) => change({ mapping: withColumnField(loaded.mapping, column, value === '' ? undefined : (value as CrewField)) })}
                        >
                          <option value="">— ignore —</option>
                          {MAPPING_FIELDS.map(({ field, label }) => <option key={field} value={field}>{label}</option>)}
                        </SelectField>
                      ))}
                    </div>
                    {fullNameIgnored(loaded.mapping) && (
                      <p class="helper-text">Full name is ignored because Surname or Given names are mapped.</p>
                    )}
                  </div>

                  <SelectField label="Date format" value={loaded.dateFormat} onChange={(value) => change({ dateFormat: value as DateFormat })}>
                    <option value="day-first">Day first (DD.MM.YYYY)</option>
                    <option value="year-first">Year first (YYYY-MM-DD)</option>
                  </SelectField>
                  <div class="import-section">
                    <Field
                      label="Sign-on date for rows without one" type="date" value={loaded.defaultSignOn}
                      onInput={(value) => change({ defaultSignOn: value })}
                    />
                    <p class="helper-text">Given to new crew whose row has no sign-on date.</p>
                  </div>

                  <div class="import-section">
                    <h3>Preview</h3>
                    {rows.length === 0 && <p class="empty">No crew found below the header row. Check the header row and the columns.</p>}
                    {rows.length > 0 && (
                      <>
                        <p class="helper-text" aria-live="polite">{summary}</p>
                        <ul class="import-list" role="list" aria-label="Preview">
                          {rows.map((row) => (
                            <PreviewItem
                              key={row.rowNumber} row={row}
                              onFix={() => setFixing(row.rowNumber)} onSkip={(skip) => edit(row.rowNumber, { skip })}
                            />
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                  <div class="form-actions">
                    <button type="button" class="btn btn-primary" disabled={importing !== undefined || count === 0} onClick={() => void runImport()}>
                      {`Import ${importing ?? count} crew`}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </section>
      {fixRow && (
        <FixRow
          key={fixRow.rowNumber} row={fixRow} crew={existing} today={today}
          onDone={(draft) => {
            edit(fixRow.rowNumber, { draft });
            lastFixed.current = fixRow.rowNumber;
            setFixing(undefined);
          }}
          onCancel={() => {
            lastFixed.current = fixRow.rowNumber;
            setFixing(undefined);
          }}
        />
      )}
    </>
  );
}

/** Imports crew into the active ship from an Excel or CSV crew list: choose the columns, check the preview, fix or skip rows. */
export function CrewImport() {
  const { activeShip } = useAppState();
  if (!activeShip) return null;
  // Keyed by ship, so switching ships does not carry a file across.
  return <ImportWizard key={activeShip.id} ship={activeShip} />;
}

import { useId, useState } from 'preact/hooks';
import { useAppState } from '../../../app/AppState';
import { reportError } from '../../../app/errors';
import { saveSurveyImport, saveSurveyShip } from '../../../db/survey';
import type { SurveyShipFields } from '../../../db/survey';
import { looksLikeThousands, parseDecimal } from '../../../domain/numbers';
import type { DraftSurveyShip, FieldError, HydroRow, LcfSource, SheetRanges } from '../../../domain/types';
// Types only: the reader comes with SheetJS, which is loaded when a file is chosen (see `readFile`).
import type { ImportedWorkbook } from '../../../survey/workbook/read';
import { Field } from '../../components/Field';
import { fixed, tableSummary } from './surveyView';
import { useSurveyData } from './useSurveyData';

interface Loaded { fileName: string; bytes: Uint8Array; book: ImportedWorkbook }

/**
 * Reads the company workbook. SheetJS is most of the app's size and only the import needs it, so it is loaded now and
 * not with the app; the service worker keeps it for offline use.
 */
async function readFile(file: File): Promise<Loaded | { problem: string }> {
  const reader = await import('../../../survey/workbook/read').catch((cause: unknown) => {
    throw new Error("The spreadsheet reader couldn't be loaded. Reload the app and try again.", { cause });
  });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const book = reader.readSurveyWorkbook(bytes);
  return 'error' in book ? { problem: book.error } : { fileName: file.name, bytes, book };
}

type NumberKey = 'lbp' | 'dF' | 'dM' | 'dA' | 'beam' | 'keelPlateCorr' | 'lightShip' | 'summerDraught' | 'summerDwt' | 'depth' | 'gt';
/** `tonnes`: "6,850" would be read as 6.85 t, so a thousands-like entry is refused, as the ship's particulars refuse it. */
const PARTICULARS: { key: NumberKey; label: string; unit: string; required?: boolean; positive?: boolean; tonnes?: boolean }[] = [
  { key: 'lbp', label: 'LBP', unit: 'm', required: true, positive: true },
  { key: 'dF', label: 'dF', unit: 'm', required: true },
  { key: 'dM', label: 'dM', unit: 'm', required: true },
  { key: 'dA', label: 'dA', unit: 'm', required: true },
  { key: 'beam', label: 'Beam', unit: 'm', required: true, positive: true },
  { key: 'keelPlateCorr', label: 'Keel plate correction', unit: 'm', required: true },
  { key: 'lightShip', label: 'Light ship', unit: 't', required: true, tonnes: true },
  { key: 'summerDraught', label: 'Summer draught', unit: 'm' },
  { key: 'summerDwt', label: 'Summer deadweight', unit: 't', tonnes: true },
  { key: 'depth', label: 'Depth moulded', unit: 'm' },
  { key: 'gt', label: 'GT', unit: '' },
];

const withUnit = (value: number | undefined, unit: string) => (value === undefined ? '—' : unit ? `${value} ${unit}` : String(value));
const rangeLine = (sheet: string, r: SheetRanges) => `${sheet} look-ups from ${fixed(r.dispTpcMtcFrom, 3)} m (LCF from ${fixed(r.lcfFrom, 3)} m)`;
const hasTabled = (rows: readonly HydroRow[]) => rows.length > 0 && rows.every((r) => r.lcfTabledMid !== undefined);

const LCF_EXPLAINED = 'The workbook’s HYDRO sheet works its “LCF from midship” column out from the column headed “LCB Tabled”, '
  + 'and the other way round, so the two look swapped. “Workbook” uses the sheet’s own column, so the results match the company '
  + 'sheet. “Tabled” uses the LCF from the “LCF Tabled” column. Until you confirm which is right against the stability booklet, '
  + 'each survey shows the other one’s first trim correction as a check line.';

/** `/ship/survey/data`: import the ship's data from the company workbook, and edit it. */
export function ShipData() {
  const { db, activeShip } = useAppState();
  const data = useSurveyData();
  const fileId = useId();
  const [loaded, setLoaded] = useState<Loaded>();
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const choose = (file: File | undefined): void => {
    if (!file) return;
    setProblem(''); setNotice(''); setLoaded(undefined); setBusy(true);
    readFile(file).then((r) => ('problem' in r ? setProblem(r.problem) : setLoaded(r)), reportError).finally(() => setBusy(false));
  };

  const save = async (l: Loaded): Promise<void> => {
    const shipId = activeShip!.id;
    const before = data?.ship;
    // A re-import replaces the table and the particulars; the user's LCF choice stays, if the new table still allows it.
    const lcfSource: LcfSource = before?.lcfSource === 'tabled' && hasTabled(l.book.hydro) ? 'tabled' : 'workbook';
    await saveSurveyImport(db, shipId, {
      hydro: l.book.hydro,
      ship: {
        ...l.book.ship, lcfSource, lcfConfirmed: lcfSource === before?.lcfSource ? before.lcfConfirmed : undefined,
        sourceName: l.fileName, importedAt: new Date().toISOString(),
      },
      template: { fileName: l.fileName, bytes: l.bytes, cellMap: l.book.cellMap },
    });
  };

  const confirm = (l: Loaded): void => {
    setBusy(true);
    save(l).then(() => { setLoaded(undefined); setNotice('Ship data saved.'); }, reportError).finally(() => setBusy(false));
  };

  const ship = data?.ship;
  const rows = data?.hydro?.rows ?? [];
  return (
    <section class="screen survey">
      <p class="no-print"><a href="#/ship/survey">← Draft survey</a></p>
      <h2>Ship data</h2>
      {notice && <p class="save-status" role="status">{notice}</p>}

      <div class="field">
        <label for={fileId}>Import ship data from workbook</label>
        <input id={fileId} type="file" accept=".xlsx,.xlsm" disabled={busy} aria-invalid={problem ? 'true' : undefined}
          onChange={(e) => { choose(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
        <p class="helper-text">
          The company’s draft survey workbook (.xlsx). Its HYDRO table and the INITIAL sheet’s particulars are read on this device; the
          file is kept to be filled in later.{ship && ' Importing again replaces the table.'}
        </p>
        {problem && <p class="field-error" role="alert">{problem}</p>}
      </div>

      {loaded && (
        <section class="card survey-preview" aria-label="Found in the workbook">
          <h3>Found in the workbook</h3>
          <p class="helper-text">{loaded.fileName}</p>
          <table class="survey-table survey-lines">
            <tbody>
              {PARTICULARS.map((p) => <tr key={p.key}><th scope="row">{p.label}</th><td>{withUnit(loaded.book.ship[p.key], p.unit)}</td></tr>)}
            </tbody>
          </table>
          <p>{tableSummary(loaded.book.hydro)}</p>
          <p>{rangeLine('INITIAL', loaded.book.ship.ranges.initial)}</p>
          <p>{rangeLine('FINAL', loaded.book.ship.ranges.final)}</p>
          {loaded.book.warnings.length > 0 && (
            <ul class="survey-warnings">{loaded.book.warnings.map((w) => <li key={w} class="field-warning warning">{w}</li>)}</ul>
          )}
          <p class="form-actions">
            <button type="button" class="btn btn-primary" disabled={busy} onClick={() => confirm(loaded)}>Save ship data</button>
            <button type="button" class="btn btn-outline" disabled={busy} onClick={() => setLoaded(undefined)}>Cancel</button>
          </p>
        </section>
      )}

      {data && ship && (
        <>
          <p class="helper-text">
            {tableSummary(rows)}.{ship.sourceName && ` From ${ship.sourceName}`}{ship.importedAt && `, imported ${ship.importedAt.slice(0, 10)}`}.
          </p>
          {/* A new key fills the form afresh after an import. */}
          <ParticularsForm key={ship.updatedAt} ship={ship} tabled={hasTabled(rows)} onSaved={() => setNotice('Changes saved.')} />
        </>
      )}
    </section>
  );
}

type Draft = Record<NumberKey, string> & { lcfSource: LcfSource; lcfConfirmed: boolean };

function ParticularsForm({ ship, tabled, onSaved }: { ship: DraftSurveyShip; tabled: boolean; onSaved: () => void }) {
  const { db } = useAppState();
  const selectId = useId();
  const [draft, setDraft] = useState<Draft>(() => {
    const d = { lcfSource: ship.lcfSource, lcfConfirmed: ship.lcfConfirmed === true } as Draft;
    for (const p of PARTICULARS) d[p.key] = ship[p.key] === undefined ? '' : String(ship[p.key]);
    return d;
  });
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);

  const values: Partial<Record<NumberKey, number>> = {};
  const errors: Partial<Record<NumberKey, FieldError>> = {};
  for (const p of PARTICULARS) {
    const value = parseDecimal(draft[p.key], { signed: true, rejectThousandsLike: p.tonnes });
    if (value === 'invalid') {
      const message = p.tonnes && looksLikeThousands(draft[p.key]) ? 'Enter the number without thousands separators, e.g. 6850.4.' : 'Enter a number, e.g. 12,5.';
      errors[p.key] = { field: p.key, severity: 'error', message };
    }
    else if (value === undefined && p.required) errors[p.key] = { field: p.key, severity: 'error', message: 'Required.' };
    else if (value !== undefined && p.positive && value <= 0) errors[p.key] = { field: p.key, severity: 'error', message: 'Must be above 0.' };
    if (typeof value === 'number') values[p.key] = value;
  }
  const ok = Object.keys(errors).length === 0;

  const submit = (e: Event): void => {
    e.preventDefault();
    setTried(true);
    if (!ok) return;
    const { id: _i, shipId: _s, scope: _c, createdAt: _a, updatedAt: _u, updatedBy: _b, deleted: _d, ...kept } = ship;
    const fields = { ...kept, ...values, lcfSource: draft.lcfSource, lcfConfirmed: draft.lcfConfirmed || undefined } as SurveyShipFields;
    for (const p of PARTICULARS) if (values[p.key] === undefined) delete (fields as Partial<SurveyShipFields>)[p.key];
    setBusy(true);
    saveSurveyShip(db, ship.shipId, fields).then(onSaved, reportError).finally(() => setBusy(false));
  };

  return (
    <form class="survey-form" onSubmit={submit} noValidate>
      <h3>Particulars</h3>
      <div class="survey-pairs">
        {PARTICULARS.map((p) => (
          <Field key={p.key} label={p.unit ? `${p.label} (${p.unit})` : p.label} value={draft[p.key]} inputMode="decimal"
            onInput={(v) => setDraft({ ...draft, [p.key]: v })} error={tried || draft[p.key] !== '' ? errors[p.key] : undefined} />
        ))}
      </div>
      <p class="helper-text">dF, dM and dA are the draft marks’ distances from the perpendiculars, signed as in the workbook.</p>

      <h3>LCF source</h3>
      <div class="field">
        <label for={selectId}>LCF source</label>
        <select id={selectId} value={draft.lcfSource} onChange={(e) => setDraft({ ...draft, lcfSource: e.currentTarget.value as LcfSource, lcfConfirmed: false })}>
          <option value="workbook">Workbook: “LCF from midship”</option>
          <option value="tabled" disabled={!tabled}>Tabled: “LCF Tabled”{tabled ? '' : ' (not in this table)'}</option>
        </select>
        <p class="helper-text">{LCF_EXPLAINED}</p>
      </div>
      <label class="check">
        <input type="checkbox" checked={draft.lcfConfirmed} onChange={(e) => setDraft({ ...draft, lcfConfirmed: e.currentTarget.checked })} />
        Checked against the stability booklet: stop showing the check line
      </label>
      <p class="form-actions">
        <button type="submit" class="btn btn-primary" disabled={busy}>Save changes</button>
      </p>
    </form>
  );
}

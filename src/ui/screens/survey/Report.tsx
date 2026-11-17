import { useId, useRef, useState } from 'preact/hooks';
import { useAppState } from '../../../app/AppState';
import { reportError } from '../../../app/errors';
import { fromBase64 } from '../../../backup/crypto';
import { shareOrDownload } from '../../../backup/share';
import { getTemplate } from '../../../db/survey';
import type { DraftSurvey, DraftSurveyShip, HydroTable } from '../../../domain/types';
import { reportFigures } from '../../../survey/report';
import type { ReportColumn, ReportFigures } from '../../../survey/report';
import { comparedName, fixed, INITIAL_MISSING, KIND_TITLES, signed, WRONG_WAY } from './surveyView';

const EXCEL_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const EXPORTED = 'Company workbook exported.';
const CANCELLED = 'Export cancelled.';
const NO_TEMPLATE = 'Import the company workbook under Ship data first: it is the file that is filled in.';

/** A column's heading: "Initial", "Final", "Interim" or "Constant check". */
const COLUMN_TITLES: Record<DraftSurvey['kind'], string> = { initial: 'Initial', final: 'Final', interim: 'Interim', constant: 'Constant check' };

const m4 = (x: number) => fixed(x, 4);
const t3 = (x: number) => fixed(x, 3);
const pair = (p: number | undefined, s: number | undefined) => `${p ?? '—'} / ${s ?? '—'}`;
const when = (s: DraftSurvey) => [s.date, [s.timeFrom, s.timeTill].filter(Boolean).join('–')].filter(Boolean).join(' ');

/** The report's rows: a label, and the value of each column (the initial survey's, then the other one's). */
function rows(surveys: DraftSurvey[], columns: ReportColumn[]): [string, string[]][] {
  const each = (f: (c: ReportColumn, s: DraftSurvey) => string) => columns.map((c, i) => f(c, surveys[i]!));
  return [
    ['Date and time', each((_, s) => when(s) || '—')],
    ['Draft forward P / S (m)', each((_, s) => pair(s.drafts.fP, s.drafts.fS))],
    ['Draft midships P / S (m)', each((_, s) => pair(s.drafts.mP, s.drafts.mS))],
    ['Draft aft P / S (m)', each((_, s) => pair(s.drafts.aP, s.drafts.aS))],
    ['Corrected forward (m)', each((c) => m4(c.sheet.corrected.F))],
    ['Corrected midships (m)', each((c) => m4(c.sheet.corrected.M))],
    ['Corrected aft (m)', each((c) => m4(c.sheet.corrected.A))],
    ['Quarter mean (m)', each((c) => m4(c.quarterMean))],
    ['Trim (m)', each((c) => m4(c.sheet.trim))],
    ['TPC (t)', each((c) => t3(c.sheet.tpc))],
    ['LCF (m)', each((c) => t3(c.sheet.lcf))],
    ['MTC +0.5 (t·m)', each((c) => t3(c.sheet.mtcPlus))],
    ['MTC −0.5 (t·m)', each((c) => t3(c.sheet.mtcMinus))],
    ['Displacement at QM (t)', each((c) => t3(c.sheet.qmDisplacement))],
    ['1st trim correction (t)', each((c) => t3(c.trimCorr1))],
    ['2nd trim correction (t)', each((c) => t3(c.trimCorr2))],
    ['Displacement corrected for trim (t)', each((c) => t3(c.displCorrected))],
    ['Density (t/m³)', each((c) => fixed(c.density, 4))],
    ['Displacement corrected for density (t)', each((c) => t3(c.gross))],
    ['VLSFO + LSMGO (t)', each((c) => t3(c.deductibles.fuel))],
    ['Fresh water (t)', each((c) => t3(c.deductibles.freshWater))],
    ['Ballast (t)', each((c) => t3(c.deductibles.ballast))],
    ['Lub oil + other (t)', each((c) => t3(c.deductibles.lubOther))],
    ['Total deductibles (t)', each((c) => t3(c.deductibles.total))],
    ['Nett displacement (t)', each((c) => t3(c.nett))],
  ];
}

/**
 * `/ship/survey/:id/report`: the survey in the company workbook's "DS Report" layout, worked with the report's own
 * formulas (`reportFigures`), to print or save as PDF; and the company workbook filled in with it. An interim or final
 * survey is reported (and written) with its initial survey, and follows the initial survey's operation, as FINAL does.
 */
export function Report({ survey, initial, ship, hydro }: { survey: DraftSurvey; initial?: DraftSurvey; ship: DraftSurveyShip; hydro: HydroTable }) {
  const { db, activeShip, shipToday } = useAppState();
  const titleId = useId();
  const [status, setStatus] = useState('');
  const [problem, setProblem] = useState('');
  const exporting = useRef(false);

  const own = survey.kind === 'initial' || survey.kind === 'constant';
  const first = own ? survey : initial;
  // FINAL takes the operation from INITIAL: the final's stored one may be stale.
  const other = own || !initial ? undefined : { ...survey, operation: initial.operation };
  const figures: ReportFigures | { error: string } = first ? reportFigures(ship, hydro.rows, first, other) : { error: INITIAL_MISSING };
  const back = <p class="no-print"><a href={`#/ship/survey/${survey.id}`}>← {KIND_TITLES[survey.kind]}</a></p>;

  if ('error' in figures) {
    return (
      <section class="screen survey">
        {back}
        <h2>Draft survey report</h2>
        <p class="empty" role="status">No report yet: {figures.error}</p>
      </section>
    );
  }

  async function exportWorkbook(): Promise<void> {
    if (exporting.current) return;
    exporting.current = true;
    setStatus(''); setProblem('');
    try {
      const template = await getTemplate(db, ship.shipId);
      if (!template?.fileBase64) { setProblem(NO_TEMPLATE); return; }
      const fill = await import('../../../survey/workbook/fill').catch((cause: unknown) => {
        throw new Error("The workbook writer couldn't be loaded. Reload the app and try again.", { cause });
      });
      const made = fill.fillSurveyWorkbook({
        bytes: fromBase64(template.fileBase64), cellMap: template.cellMap, ship, shipName: activeShip?.particulars.name ?? '',
        initial: first, other, today: shipToday,
      });
      if ('error' in made) { setProblem(made.error); return; }
      const outcome = await shareOrDownload(made.fileName, new Blob([made.bytes as Uint8Array<ArrayBuffer>], { type: EXCEL_TYPE }));
      setStatus(outcome === 'cancelled' ? CANCELLED : EXPORTED);
    } catch (err) {
      reportError(err);
    } finally {
      exporting.current = false;
    }
  }

  const surveys = [first!, ...(other ? [other] : [])];
  const columns = [figures.initial, ...(figures.other ? [figures.other] : [])];
  const last = other ?? first!;
  const compared = comparedName(first!.operation);
  const totals: [string, string][] = [
    ['LBP', `${figures.lbp} m`],
    ['Light ship', `${t3(figures.lightShip)} t`],
    [`${figures.constantLabel} (initial)`, `${t3(figures.constant)} t`],
  ];
  if (figures.cargo !== undefined) {
    totals.push([`Cargo ${figures.cargoLabel}`, `${t3(figures.cargo)} t`]);
    if (figures.comparedQty !== undefined) totals.push([compared, `${t3(figures.comparedQty)} t`]);
    if (figures.differenceT !== undefined) {
      totals.push([`Difference (ship − ${compared.toLowerCase().replace('b/l', 'B/L')})`, `${signed(figures.differenceT, 3)} t · ${signed(figures.differencePct ?? 0, 3)} %`]);
    }
  }
  const details: [string, string | undefined][] = [
    ['Vessel', activeShip?.particulars.name], ['Port', first!.port], ['Terminal', first!.terminal], ['Cargo', first!.cargo],
    ['Holds', first!.holds], ['Operation', first!.kind === 'constant' ? 'Constant check' : first!.operation === 'loading' ? 'Loading' : 'Discharging'],
  ];

  return (
    <section class="screen survey">
      <div class="no-print">
        {back}
        <h2>Draft survey report</h2>
        <p class="form-actions">
          <button type="button" class="btn btn-primary" onClick={() => window.print()}>Print / Save PDF</button>
          <button type="button" class="btn btn-outline" onClick={() => void exportWorkbook()}>Export company workbook</button>
        </p>
        <p class="helper-text">
          {other ? `The workbook is filled in with the initial survey on INITIAL and the ${other.kind} survey on FINAL.` : 'The workbook is filled in with this survey on INITIAL.'}
          {' '}Excel works its formulas out again when the file is opened.
        </p>
        {problem && <p class="field-error" role="alert">{problem}</p>}
        <p class="live" role="status">{status}</p>
        {(figures.cargo ?? 0) < 0 && <p class="field-warning warning">{WRONG_WAY}</p>}
      </div>

      <article class="survey-report" aria-labelledby={titleId}>
        <h2 id={titleId} class="sheet-title">DRAFT SURVEY REPORT</h2>
        <p class="sheet-details">
          {details.filter(([, v]) => v).map(([label, value]) => <span key={label}><span class="sheet-key">{label}</span> <strong>{value}</strong></span>)}
        </p>
        <div class="sheet-table-wrap" role="region" aria-label="Report table" tabIndex={0}>
          <table class="sheet-table survey-report-table">
            <thead>
              <tr><th scope="col"><span class="visually-hidden">Line</span></th>{surveys.map((s) => <th key={s.id} scope="col">{COLUMN_TITLES[s.kind]}</th>)}</tr>
            </thead>
            <tbody>
              {rows(surveys, columns).map(([label, values]) => (
                <tr key={label}><th scope="row">{label}</th>{values.map((v, i) => <td key={i}>{v}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
        <table class="sheet-table survey-report-table survey-report-totals" aria-label="Result">
          <tbody>
            {totals.map(([label, value]) => <tr key={label}><th scope="row">{label}</th><td>{value}</td></tr>)}
          </tbody>
        </table>
        {last.remarks && <p class="survey-report-remarks"><span class="sheet-key">Remarks</span> {last.remarks}</p>}
        <div class="sheet-sign">
          <div class="sheet-master">
            <p class="sheet-master-line">Surveyor: <strong>{last.surveyor ?? ''}</strong></p>
            <p class="sheet-signature">Signature</p>
          </div>
          <div class="sheet-master">
            <p class="sheet-master-line">Chief Officer: <strong>{last.chiefOfficer ?? ''}</strong></p>
            <p class="sheet-signature">Signature</p>
          </div>
        </div>
      </article>
    </section>
  );
}

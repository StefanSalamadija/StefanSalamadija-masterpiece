import { useId, useMemo, useRef, useState } from 'preact/hooks';
import { useAppState } from '../../../app/AppState';
import { reportError } from '../../../app/errors';
import { navigate, useRoute } from '../../../app/router';
import { deleteSurvey, saveSurvey } from '../../../db/survey';
import type { DraftSurvey, DraftSurveyShip, FieldError, HydroTable, SurveyOperation } from '../../../domain/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Field } from '../../components/Field';
import { useDraftSaver } from '../../useDraftSaver';
import { calculationLines, comparedName, fixed, fromDraft, KIND_TITLES, NUMBER_KEYS, signed, toDraft, workOut, WRONG_WAY } from './surveyView';
import type { NumberKey, Problem, SurveyDraft, TextKey, Worked } from './surveyView';
import { surveyWhere } from './Surveys';
import { useSurveyData } from './useSurveyData';

const MARKS = [
  ['Forward', 'fP', 'fS'], ['Midships', 'mP', 'mS'], ['Aft', 'aP', 'aS'],
] as const;
const DEDUCTIBLES: [NumberKey, string][] = [
  ['ballast', 'Ballast'], ['freshWater', 'Fresh water'], ['vlsfo', 'VLSFO'], ['lsmgo', 'LSMGO'], ['lubOil', 'Lub oil'], ['other', 'Other'],
];
const DETAILS: [TextKey | NumberKey, string, ('date' | 'time')?][] = [
  ['port', 'Port'], ['terminal', 'Terminal'], ['cargo', 'Cargo'], ['holds', 'Holds'], ['date', 'Date', 'date'],
  ['timeFrom', 'Time from', 'time'], ['timeTill', 'Time till', 'time'], ['windBft', 'Wind (Bft)'], ['swell', 'Swell (m)'],
];

const fieldError = (problem: Problem | undefined, field: string): FieldError | undefined =>
  problem && { field, severity: problem.severity, message: problem.message };

/** `/ship/survey/:id`: one survey's inputs, as they are read at the marks, and its figures worked out live. */
export function SurveyForm() {
  const { params } = useRoute();
  const data = useSurveyData();
  if (!data) return <section class="screen"><p class="live" role="status">Loading…</p></section>;
  const survey = data.surveys.find((s) => s.id === params.id);
  if (!survey || !data.ship || !data.hydro) {
    return (
      <section class="screen">
        <p class="no-print"><a href="#/ship/survey">← Draft survey</a></p>
        <h2>Survey not found</h2>
        <p class="empty">{!survey ? 'This survey has been deleted, or it is not on this ship.' : "Import the ship's data from the company workbook first."}</p>
      </section>
    );
  }
  const initial = survey.initialId === undefined ? undefined : data.surveys.find((s) => s.id === survey.initialId);
  // A new key starts the form afresh for another survey; edits elsewhere to this one don't overwrite what is being typed.
  return <Editor key={survey.id} survey={survey} initial={initial} ship={data.ship} hydro={data.hydro} />;
}

function Editor({ survey, initial, ship, hydro }: { survey: DraftSurvey; initial?: DraftSurvey; ship: DraftSurveyShip; hydro: HydroTable }) {
  const { db, activeShip } = useAppState();
  const [draft, setDraft] = useState<SurveyDraft>(() => toDraft(survey));
  const [status, setStatus] = useState<'saved' | 'saving' | undefined>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const closed = useRef(false);
  const operationId = useId();

  const { fields, problems } = useMemo(() => fromDraft(survey, draft), [draft]);
  const current: DraftSurvey = { ...survey, ...fields };
  const worked = workOut(ship, hydro.rows, current, initial);
  const ownOperation = survey.kind === 'initial' || survey.kind === 'constant';
  const operation: SurveyOperation = ownOperation ? draft.operation : (initial?.operation ?? draft.operation);

  const saver = useDraftSaver<SurveyDraft>(async (state) => {
    await saveSurvey(db, activeShip!.id, fromDraft(survey, state).fields, survey.id);
    setStatus('saved');
  }, () => !closed.current);

  const set = (key: keyof SurveyDraft, value: string): void => {
    const next = { ...draft, [key]: value } as SurveyDraft;
    setDraft(next);
    setStatus('saving');
    saver.schedule(next);
  };

  const input = (key: NumberKey | TextKey, label: string, type?: 'date' | 'time', hint?: string) => (
    <Field key={key} label={label} value={draft[key]} onInput={(v) => set(key, v)} type={type}
      inputMode={(NUMBER_KEYS as readonly string[]).includes(key) ? 'decimal' : undefined}
      error={fieldError(problems[key as NumberKey], key)} hint={hint} />
  );

  const remove = (): void => {
    closed.current = true;
    saver.cancel();
    deleteSurvey(db, survey.id).then(() => navigate('/ship/survey'), (err: unknown) => {
      closed.current = false;
      reportError(err);
    });
  };

  return (
    <section class="screen survey">
      <p class="no-print"><a href="#/ship/survey">← Draft survey</a></p>
      <div class="screen-head">
        <h2>{KIND_TITLES[survey.kind]}</h2>
        <span class="save-status" role="status">{status === 'saved' ? 'Saved' : status === 'saving' ? 'Saving…' : ''}</span>
      </div>
      {!ownOperation && (
        <p class="helper-text">
          {initial ? `Worked against the initial survey${surveyWhere(initial) && ` of ${surveyWhere(initial)}`}, ${initial.operation}.` : 'Its initial survey has been deleted.'}
        </p>
      )}

      {survey.kind === 'initial' && (
        <div class="field">
          <label for={operationId}>Operation</label>
          <select id={operationId} value={draft.operation} onChange={(e) => set('operation', e.currentTarget.value)}>
            <option value="loading">Loading</option>
            <option value="discharging">Discharging</option>
          </select>
        </div>
      )}

      <fieldset class="survey-group">
        <legend>Drafts (m)</legend>
        <div class="survey-drafts">
          {MARKS.flatMap(([mark, port, stbd]) => [input(port, `${mark} port`), input(stbd, `${mark} starboard`)])}
        </div>
      </fieldset>
      {input('density', 'Density (t/m³)', undefined, 'The dock water’s, e.g. 1,018.')}

      <fieldset class="survey-group">
        <legend>Deductibles (t)</legend>
        <div class="survey-pairs">{DEDUCTIBLES.map(([key, label]) => input(key, label))}</div>
      </fieldset>

      {!ownOperation && input('comparedQty', `${comparedName(operation)} (t)`, undefined, 'What the ship’s figure is compared with.')}

      <Results worked={worked} ship={ship} operation={operation} />

      <fieldset class="survey-group">
        <legend>Details</legend>
        <div class="survey-pairs">{DETAILS.map(([key, label, type]) => input(key, label, type))}</div>
        {input('blQty', 'B/L quantity (t)')}
        {input('surveyor', 'Surveyor')}
        {input('chiefOfficer', 'Chief Officer')}
        <Field label="Remarks" value={draft.remarks} onInput={(v) => set('remarks', v)} multiline />
      </fieldset>

      <p class="form-actions">
        <button type="button" class="btn btn-outline btn-danger" onClick={() => setConfirmDelete(true)}>Delete survey</button>
      </p>
      {confirmDelete && (
        <ConfirmDialog title="Delete this survey?" body={`The ${KIND_TITLES[survey.kind].toLowerCase()} and its figures are deleted.`}
          confirmLabel="Delete" danger onConfirm={remove} onCancel={() => setConfirmDelete(false)} />
      )}
    </section>
  );
}

function Results({ worked, ship, operation }: { worked: Worked | { error: string }; ship: DraftSurveyShip; operation: SurveyOperation }) {
  if ('error' in worked) {
    return (
      <section class="survey-result card" aria-label="Result">
        <p class="survey-result-error" role="status">{worked.error}</p>
      </section>
    );
  }
  const { outcome, sheet } = worked;
  const { marks, lines } = calculationLines(ship, worked);
  const compared = comparedName(operation).toLowerCase().replace('b/l', 'B/L');
  return (
    <>
      <section class="survey-result card" aria-label="Result">
        {outcome.constant !== undefined ? (
          <>
            <p class="survey-result-label">{outcome.constantLabel}</p>
            <p class="survey-result-value">{fixed(outcome.constant, 3)} t</p>
          </>
        ) : (
          <>
            <p class="survey-result-label">Cargo {outcome.cargoLabel}</p>
            <p class="survey-result-value">{fixed(outcome.cargo ?? 0, 3)} t</p>
            {worked.wrongWay && <p class="field-warning warning" role="alert">{WRONG_WAY}</p>}
            {outcome.differenceT !== undefined && (
              <p class="survey-difference">
                <span>Difference (ship − {compared})</span>{' '}
                <strong>{signed(outcome.differenceT, 3)} t · {signed(outcome.differencePct ?? 0, 3)} %</strong>
              </p>
            )}
          </>
        )}
      </section>

      {(sheet.list.deg > 0 || sheet.deflection.cm > 0) && (
        <p class="helper-text survey-shown">
          List {sheet.list.side} {fixed(sheet.list.deg, 2)}°, deflection {sheet.deflection.kind} {fixed(sheet.deflection.cm, 1)} cm: shown only, as in the workbook; no correction is made for them.
        </p>
      )}
      {sheet.lcfCheck && !ship.lcfConfirmed && (
        <p class="field-warning warning survey-lcf">
          LCF check ({ship.lcfSource === 'workbook' ? 'LCF Tabled' : 'workbook’s LCF from midship'}): LCF {fixed(sheet.lcfCheck.lcf, 3)} m,
          1st trim correction {fixed(sheet.lcfCheck.trimCorr1, 3)} t (used: {fixed(sheet.trimCorr1, 3)} t). Confirm the LCF source against the
          stability booklet under <a href="#/ship/survey/data">Ship data</a>.
        </p>
      )}

      <section class="survey-calc" aria-label="Calculation">
        <h3>Calculation</h3>
        <div class="table-scroll">
          <table class="survey-table">
            <thead><tr><th scope="col">Drafts (m)</th><th scope="col">Forward</th><th scope="col">Midships</th><th scope="col">Aft</th></tr></thead>
            <tbody>
              {marks.map((m) => <tr key={m.label}><th scope="row">{m.label}</th>{m.values.map((v, i) => <td key={i}>{v}</td>)}</tr>)}
            </tbody>
          </table>
        </div>
        <table class="survey-table survey-lines">
          <tbody>
            {lines.map((line) => <tr key={line.label}><th scope="row">{line.label}</th><td>{line.value}</td></tr>)}
          </tbody>
        </table>
      </section>
    </>
  );
}

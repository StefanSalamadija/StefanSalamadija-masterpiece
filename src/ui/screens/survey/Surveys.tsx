import { useState } from 'preact/hooks';
import { useAppState } from '../../../app/AppState';
import { reportError } from '../../../app/errors';
import { navigate } from '../../../app/router';
import { saveSurvey } from '../../../db/survey';
import type { SurveyFields } from '../../../db/survey';
import type { DraftSurvey, SurveyKind } from '../../../domain/types';
import { KIND_TITLES, resultLine, workOut } from './surveyView';
import { useSurveyData } from './useSurveyData';

/** "Portville · 2026-10-25": where and when, as far as they are entered. */
export function surveyWhere(s: Pick<DraftSurvey, 'port' | 'date'>): string {
  return [s.port, s.date].filter(Boolean).join(' · ');
}

/** `/ship/survey`: the ship's draft surveys, newest first, and the buttons that start a new one. */
export function Surveys() {
  const { db, activeShip, shipToday } = useAppState();
  const data = useSurveyData();
  const [busy, setBusy] = useState(false);
  if (!activeShip || !data) return <section class="screen"><h2>Draft survey</h2><p class="live" role="status">Loading…</p></section>;
  const { ship, hydro, surveys } = data;
  const byId = new Map(surveys.map((s) => [s.id, s]));

  const start = (kind: SurveyKind, initial?: DraftSurvey): void => {
    // A final or interim survey starts with its initial survey's voyage details, as FINAL takes them from INITIAL.
    const fields: SurveyFields = {
      kind, operation: initial?.operation ?? 'loading', drafts: {}, deductibles: {}, date: shipToday,
      ...(initial && { initialId: initial.id, port: initial.port, terminal: initial.terminal, cargo: initial.cargo, holds: initial.holds,
        surveyor: initial.surveyor, chiefOfficer: initial.chiefOfficer }),
    };
    setBusy(true);
    saveSurvey(db, activeShip.id, fields).then((saved) => navigate(`/ship/survey/${saved.id}`), reportError).finally(() => setBusy(false));
  };

  return (
    <section class="screen survey">
      <div class="screen-head">
        <h2>Draft survey</h2>
        <a href="#/ship/survey/data" class="btn btn-small btn-outline">Ship data</a>
      </div>
      {!ship || !hydro ? (
        <p class="empty">Import the ship's data from the company workbook first.</p>
      ) : (
        <>
          <p class="survey-actions">
            <button type="button" class="btn btn-primary" disabled={busy} onClick={() => start('initial')}>New initial survey</button>
            <button type="button" class="btn btn-outline" disabled={busy} onClick={() => start('constant')}>New constant check</button>
          </p>
          {surveys.length === 0 ? <p class="empty">No surveys yet.</p> : (
            <ul class="survey-list" role="list" aria-label="Surveys">
              {surveys.map((s) => {
                const initial = s.initialId === undefined ? undefined : byId.get(s.initialId);
                const where = surveyWhere(s);
                return (
                  <li key={s.id} class="card survey-row">
                    <a href={`#/ship/survey/${s.id}`} class="survey-link">
                      <span class="survey-kind">{KIND_TITLES[s.kind]}</span>
                      {where && <span class="survey-where">{where}</span>}
                      {initial && <span class="survey-where">Against the initial survey{surveyWhere(initial) && ` of ${surveyWhere(initial)}`}</span>}
                      <span class="survey-figure">{resultLine(workOut(ship, hydro.rows, s, initial))}</span>
                    </a>
                    {s.kind === 'initial' && (
                      <p class="survey-row-actions">
                        <button type="button" class="btn btn-small btn-outline" disabled={busy} onClick={() => start('final', s)}>New final</button>
                        <button type="button" class="btn btn-small btn-outline" disabled={busy} onClick={() => start('interim', s)}>New interim</button>
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

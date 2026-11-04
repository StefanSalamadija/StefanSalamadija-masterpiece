import { useEffect, useMemo, useState } from 'preact/hooks';
import { useAppState } from '../../app/AppState';
import { takeFlash } from '../../app/flash';
import { listTemplates } from '../../db/forms';
import { listForShip } from '../../db/records';
import { collectAlerts } from '../../domain/alerts';
import { maxMonthsOnboardOf } from '../../domain/contracts';
import type { Certificate, CrewDocument, CrewMember, FormDraft } from '../../domain/types';
import { loadFormsEngine } from '../../forms/load';
import { BandBadge } from '../components/BandBadge';
import { alertBadgeKind, backupReminder, clockChangeText, formsInProgress, PERSISTENCE_DENIED_NOTICE } from '../homeView';
import { useLive } from '../useLive';

/**
 * What needs looking at on the ship's date: crew documents (passports, books, certificates) and ship certificates that are about to run out or have, and
 * contracts that are about to end or have, and crew who are near the limit of months onboard or past it. The status is a
 * badge in words as well as colour, so that a printout, which has no colour, carries it too.
 */
function Alerts({ shipId, maxMonthsOnboard }: { shipId: string; maxMonthsOnboard: number }) {
  const { db, shipToday } = useAppState();
  const records = useLive(
    async () => {
      const [crew, certificates, crewDocuments] = await Promise.all([
        listForShip<CrewMember>(db, 'crew', shipId),
        listForShip<Certificate>(db, 'certificates', shipId),
        listForShip<CrewDocument>(db, 'crewDocuments', shipId),
      ]);
      return { crew, certificates, crewDocuments };
    },
    [db, shipId],
  );
  // Worked out when the records or the ship's date change, not on every render.
  const alerts = useMemo(
    () => records && collectAlerts({ ...records, today: shipToday, maxMonthsOnboard }),
    [records, shipToday, maxMonthsOnboard],
  );

  return (
    <section class="alerts" aria-label="Alerts">
      <h2>Alerts</h2>
      {alerts?.length === 0 && <p class="empty">No alerts.</p>}
      {alerts && alerts.length > 0 && (
        <ul class="alert-list" role="list">
          {alerts.map((alert) => (
            <li key={alert.key} class="card alert-row">
              <a class="alert-link" href={alert.href}>
                <span class="alert-head">
                  <span class="alert-title">{alert.title}</span>
                  <BandBadge band={alert.band} kind={alertBadgeKind(alert.kind)} />
                </span>
                <span class="alert-detail">{alert.detail}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The forms the ship has started and not finished, each linking to its fill screen. Nothing is shown while there are
 * none. The period is worded by the forms engine, which is loaded only when there is a draft to word.
 */
function FormsInProgress({ shipId }: { shipId: string }) {
  const { db, shipToday } = useAppState();
  const data = useLive(async () => {
    const [templates, drafts] = await Promise.all([listTemplates(db), listForShip<FormDraft>(db, 'formDrafts', shipId)]);
    return { templates, drafts };
  }, [db, shipId]);
  const hasDrafts = data !== undefined && data.drafts.some((d) => !d.deleted);
  // `null` when the engine could not be loaded: the periods are then shown as kept.
  const [periodLabel, setPeriodLabel] = useState<((period: string) => string) | null>();
  useEffect(() => {
    if (hasDrafts) loadFormsEngine().then((engine) => setPeriodLabel(() => engine.periodLabel), () => setPeriodLabel(null));
  }, [hasDrafts]);
  const rows = useMemo(
    () => (data && hasDrafts && periodLabel !== undefined
      ? formsInProgress(data.drafts, data.templates, shipToday, periodLabel ?? ((period) => period))
      : []),
    [data, hasDrafts, periodLabel, shipToday],
  );
  if (rows.length === 0) return null;
  return (
    <section class="alerts" aria-label="Forms in progress">
      <h2>Forms in progress</h2>
      <ul class="alert-list" role="list">
        {rows.map((row) => (
          <li key={row.key} class="card alert-row">
            {row.href ? <a class="alert-link" href={row.href}><span class="alert-title">{row.text}</span></a> : <span class="alert-title">{row.text}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The first screen: a backup reminder when one is due, the alerts of the ship, its forms in progress and the next clock change. */
export function Home() {
  const { settings, activeShip, nowUtc, persistence, clockChanges } = useAppState();
  // Taken once, when this screen opens. The status stays on the page and only its text changes, so that it is announced.
  const [flash, setFlashText] = useState('');
  useEffect(() => setFlashText(takeFlash() ?? ''), []);

  const reminder = backupReminder(settings, activeShip !== undefined, nowUtc);
  const clockChange = clockChangeText(clockChanges, nowUtc);

  return (
    <section class="screen">
      <h2>Home</h2>
      <p class="live" role="status">{flash}</p>
      {reminder && (
        <div class="home-notice no-print">
          <p>{reminder}</p>
          <a class="btn btn-primary" href="#/settings">Export full backup</a>
        </div>
      )}
      {persistence === 'denied' && (
        <div class="home-notice no-print">
          <p>{PERSISTENCE_DENIED_NOTICE}</p>
        </div>
      )}
      {activeShip && <Alerts key={activeShip.id} shipId={activeShip.id} maxMonthsOnboard={maxMonthsOnboardOf(activeShip)} />}
      {activeShip && <FormsInProgress key={activeShip.id} shipId={activeShip.id} />}
      {clockChange && <p class="clock-change">{clockChange}</p>}
      <p>
        <a href="#/ship/particulars">Ship's data</a>
      </p>
    </section>
  );
}

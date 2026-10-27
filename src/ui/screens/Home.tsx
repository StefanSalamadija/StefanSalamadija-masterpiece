import { useEffect, useMemo, useState } from 'preact/hooks';
import { useAppState } from '../../app/AppState';
import { takeFlash } from '../../app/flash';
import { listForShip } from '../../db/records';
import { collectAlerts } from '../../domain/alerts';
import { maxMonthsOnboardOf } from '../../domain/contracts';
import type { Certificate, CrewMember } from '../../domain/types';
import { BandBadge } from '../components/BandBadge';
import { alertBadgeKind, backupReminder, clockChangeText, PERSISTENCE_DENIED_NOTICE } from '../homeView';
import { useLive } from '../useLive';

/**
 * What needs looking at on the ship's date: crew documents and certificates that are about to run out or have, and
 * contracts that are about to end or have, and crew who are near the limit of months onboard or past it. The status is a
 * badge in words as well as colour, so that a printout, which has no colour, carries it too.
 */
function Alerts({ shipId, maxMonthsOnboard }: { shipId: string; maxMonthsOnboard: number }) {
  const { db, shipToday } = useAppState();
  const records = useLive(
    async () => {
      const [crew, certificates] = await Promise.all([
        listForShip<CrewMember>(db, 'crew', shipId),
        listForShip<Certificate>(db, 'certificates', shipId),
      ]);
      return { crew, certificates };
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
            // Contracts and limits all link to the reliefs, so the link does not tell two people's alerts apart.
            <li key={`${alert.kind}:${alert.href}:${alert.title}:${alert.detail}`} class="card alert-row">
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

/** The first screen: a backup reminder when one is due, the alerts of the ship, and the next clock change. */
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
      {clockChange && <p class="clock-change">{clockChange}</p>}
      <p>
        <a href="#/ship/particulars">Ship's data</a>
      </p>
    </section>
  );
}

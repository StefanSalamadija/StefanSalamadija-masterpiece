import { useMemo } from 'preact/hooks';
import { useAppState } from '../../app/AppState';
import { useRoute } from '../../app/router';
import type { MasterpieceDB } from '../../db/schema';
import { listForShip } from '../../db/records';
import { collectAlerts } from '../../domain/alerts';
import type { Alert } from '../../domain/alerts';
import { maxMonthsOnboardOf } from '../../domain/contracts';
import { expiringBefore } from '../../domain/crewDocs';
import type { Band, Certificate, CrewDocument, CrewMember, ShipProfile, Voyage } from '../../domain/types';
import { currentVoyage } from '../../domain/voyage';
import { BandBadge } from '../components/BandBadge';
import { DueRow } from '../components/DueRow';
import { expiringDetail, expiringWindow } from '../crewDocsView';
import { CREW_DOC_KINDS, dueRow, groupDue, NOTHING_DUE } from '../dueView';
import { useLive } from '../useLive';

/** The tint of a Before next port row: overdue and due soon only. A valid paper (one the ETA reaches) is a plain row. */
const PAPER_TONE: Partial<Record<Band, 'warn' | 'danger'>> = { amber: 'warn', red: 'danger' };

interface DueRecords {
  crew: CrewMember[];
  certificates: Certificate[];
  crewDocuments: CrewDocument[];
  voyages: Voyage[];
}

/** The records the Due screen reads, live. One read, in one place, so that it can move onto the shared ship records hook. */
function useDueRecords(db: MasterpieceDB, shipId: string): DueRecords | undefined {
  return useLive(async () => {
    const [crew, certificates, crewDocuments, voyages] = await Promise.all([
      listForShip<CrewMember>(db, 'crew', shipId),
      listForShip<Certificate>(db, 'certificates', shipId),
      listForShip<CrewDocument>(db, 'crewDocuments', shipId),
      listForShip<Voyage>(db, 'voyages', shipId),
    ]);
    return { crew, certificates, crewDocuments, voyages };
  }, [db, shipId]);
}

/** A group of the Due list (`Overdue`, `Due soon`), named by its heading; nothing when it is empty. */
function DueGroup({ id, name, alerts, today }: { id: string; name: string; alerts: Alert[]; today: string }) {
  if (alerts.length === 0) return null;
  return (
    <section class="due-group" aria-labelledby={id}>
      <h3 id={id}>{name}</h3>
      <ul class="row-list" role="list">
        {alerts.map((alert) => <DueRow key={alert.key} row={dueRow(alert, today)} />)}
      </ul>
    </section>
  );
}

/** Every alert of the ship, the overdue ones first; `✓ Nothing due` when there is none. */
function AllDue({ alerts, today }: { alerts: Alert[]; today: string }) {
  const { overdue, soon } = groupDue(alerts);
  if (overdue.length === 0 && soon.length === 0) return <p class="due-none">{NOTHING_DUE}</p>;
  return (
    <>
      <DueGroup id="due-overdue" name="Overdue" alerts={overdue} today={today} />
      <DueGroup id="due-soon" name="Due soon" alerts={soon} today={today} />
    </>
  );
}

/**
 * What the crew onboard have that runs out before the next port (the ETA of the current voyage), or in the next 90 days
 * when there is none: passports, seaman's books and documents, the earliest first. A row opens the crew member. This is
 * the Expiring screen of before piece 7, with its logic unchanged.
 */
function BeforeNextPort({ records, today }: { records: DueRecords; today: string }) {
  // Worked out when the records or the ship's date change, not on every render.
  const view = useMemo(() => {
    const window = expiringWindow(currentVoyage(records.voyages), today);
    return { text: window.text, items: expiringBefore({ crew: records.crew, docs: records.crewDocuments, today, until: window.until }) };
  }, [records, today]);

  return (
    <>
      <p class="expiring-window">{view.text}</p>
      {view.items.length === 0 && <p class="empty">Nothing expires in that time.</p>}
      {view.items.length > 0 && (
        <ul class="row-list" role="list" aria-label="Expiring">
          {view.items.map((item, index) => (
            // The list is made again whole, never reordered by hand, so the position is part of what tells two alike rows apart.
            <li key={`${item.crewId}:${item.what}:${item.expiryDate}:${index}`}>
              <a class="list-row" data-tone={PAPER_TONE[item.band]} href={`#/ship/crew/${encodeURIComponent(item.crewId)}`}>
                <span class="list-row-text">
                  <span class="list-row-overline">{item.rank}</span>
                  <span class="list-row-title">{item.name}</span>
                  <span class="list-row-meta">{expiringDetail(item)}</span>
                </span>
                <BandBadge band={item.band} kind="crew" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function DueScreen({ ship, path }: { ship: ShipProfile; path: string }) {
  const { db, shipToday } = useAppState();
  const records = useDueRecords(db, ship.id);
  const crewOnly = path === '/ship/crew-documents';
  const port = path === '/due/port';
  const maxMonthsOnboard = maxMonthsOnboardOf(ship);
  // Worked out when the records or the ship's date change, not on every render.
  const alerts = useMemo(() => {
    if (!records || port) return undefined;
    const all = collectAlerts({ ...records, today: shipToday, maxMonthsOnboard });
    return crewOnly ? all.filter((a) => CREW_DOC_KINDS.includes(a.kind)) : all;
  }, [records, shipToday, maxMonthsOnboard, port, crewOnly]);

  return (
    <section class="screen due">
      <h2>{crewOnly ? 'Crew documents' : 'Due'}</h2>
      {crewOnly ? (
        <p class="due-views no-print"><a class="btn btn-outline" href="#/due/port">Before next port</a></p>
      ) : (
        <nav class="view-switch no-print" aria-label="Due views">
          <a href="#/due" aria-current={port ? undefined : 'page'}>All due</a>
          <a href="#/due/port" aria-current={port ? 'page' : undefined}>Before next port</a>
        </nav>
      )}
      {records && (port ? <BeforeNextPort records={records} today={shipToday} /> : alerts && <AllDue alerts={alerts} today={shipToday} />)}
    </section>
  );
}

/**
 * The Due screen. `/due` lists every alert of the ship, grouped as overdue and due soon; `/due/port` (where the old
 * `/ship/expiring` goes) lists the crew papers that run out before the next port; `/ship/crew-documents` is All due with
 * the crew's papers only. It prints, the rows as text and the chips in words.
 */
export function Due() {
  const { activeShip } = useAppState();
  const { path } = useRoute();
  if (!activeShip) return null;
  // Keyed by ship, so that switching ships does not carry the old list across.
  return <DueScreen key={activeShip.id} ship={activeShip} path={path} />;
}

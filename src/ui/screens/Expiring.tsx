import { useMemo } from 'preact/hooks';
import { useAppState } from '../../app/AppState';
import { listForShip } from '../../db/records';
import { expiringBefore } from '../../domain/crewDocs';
import type { CrewDocument, CrewMember, Voyage } from '../../domain/types';
import { currentVoyage } from '../../domain/voyage';
import { BandBadge } from '../components/BandBadge';
import { expiringDetail, expiringWindow } from '../crewDocsView';
import { useLive } from '../useLive';

function ExpiringList({ shipId }: { shipId: string }) {
  const { db, shipToday } = useAppState();
  const records = useLive(
    async () => {
      const [crew, docs, voyages] = await Promise.all([
        listForShip<CrewMember>(db, 'crew', shipId),
        listForShip<CrewDocument>(db, 'crewDocuments', shipId),
        listForShip<Voyage>(db, 'voyages', shipId),
      ]);
      return { crew, docs, voyages };
    },
    [db, shipId],
  );
  // Worked out when the records or the ship's date change, not on every render.
  const view = useMemo(() => {
    if (!records) return undefined;
    const window = expiringWindow(currentVoyage(records.voyages), shipToday);
    return { text: window.text, items: expiringBefore({ crew: records.crew, docs: records.docs, today: shipToday, until: window.until }) };
  }, [records, shipToday]);

  return (
    <section class="screen">
      <h2>Expiring before next port</h2>
      {view && <p class="expiring-window">{view.text}</p>}
      {view?.items.length === 0 && <p class="empty">Nothing expires in that time.</p>}
      {view && view.items.length > 0 && (
        <ul class="expiring-list" role="list" aria-label="Expiring">
          {view.items.map((item, index) => (
            // The list is made again whole, never reordered by hand, so the position is part of what tells two alike rows apart.
            <li key={`${item.crewId}:${item.what}:${item.expiryDate}:${index}`} class="card expiring-row">
              <a class="expiring-link" href={`#/ship/crew/${encodeURIComponent(item.crewId)}`}>
                <span class="expiring-head">
                  <span class="crew-row-who">
                    <span class="crew-rank">{item.rank}</span>
                    <span class="crew-name">{item.name}</span>
                  </span>
                  <BandBadge band={item.band} kind="crew" />
                </span>
                <span class="expiring-details"><span>{expiringDetail(item)}</span></span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * What the crew onboard have that runs out before the next port (the ETA of the current voyage), or in the next 90 days
 * when there is none: passports, seaman's books and documents, the earliest first. A row opens the crew member.
 */
export function Expiring() {
  const { activeShip } = useAppState();
  if (!activeShip) return null;
  // Keyed by ship, so that switching ships does not carry the old list across.
  return <ExpiringList key={activeShip.id} shipId={activeShip.id} />;
}

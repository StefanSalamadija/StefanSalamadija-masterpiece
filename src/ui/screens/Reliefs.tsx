import { useMemo } from 'preact/hooks';
import { useAppState } from '../../app/AppState';
import { listForShip } from '../../db/records';
import { rankLabel } from '../../domain/catalogues';
import { maxMonthsOnboardOf } from '../../domain/contracts';
import { fullName } from '../../domain/crew';
import type { CrewMember } from '../../domain/types';
import { BandBadge } from '../components/BandBadge';
import { reliefDetails, reliefRows } from '../reliefsView';
import { useLive } from '../useLive';

function ReliefList({ shipId, maxMonths }: { shipId: string; maxMonths: number }) {
  const { db, shipToday } = useAppState();
  const crew = useLive(() => listForShip<CrewMember>(db, 'crew', shipId), [db, shipId]);
  // Worked out when the crew, the ship's date or the ship's limit changes, not on every render.
  const rows = useMemo(() => crew && reliefRows(crew, shipToday, maxMonths), [crew, shipToday, maxMonths]);

  return (
    <section class="screen">
      <h2>Reliefs</h2>
      {rows?.length === 0 && <p class="empty">Nobody is onboard on {shipToday}.</p>}
      {rows && rows.length > 0 && (
        <ul class="relief-list" role="list" aria-label="Reliefs">
          {rows.map((row) => (
            <li key={row.member.id} class="card relief-row">
              <a class="relief-link" href={`#/ship/crew/${encodeURIComponent(row.member.id)}`}>
                <span class="relief-head">
                  <span class="crew-row-who">
                    <span class="crew-rank">{rankLabel(row.member)}</span>
                    <span class="crew-name">{fullName(row.member)}</span>
                  </span>
                  <span class="relief-badges">
                    <BandBadge band={row.contractBand} kind="contract" />
                    <BandBadge band={row.limitBand} kind="limit" />
                  </span>
                </span>
                <span class="relief-details">
                  {reliefDetails(row).map((detail) => <span key={detail}>{detail}</span>)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The crew onboard today, by the day the contract ends: the days onboard, the contract end, the relief planned, and a
 * warning when the contract is near its end or past it, or the months onboard near the ship's limit or at it. A row
 * opens the crew member to edit.
 */
export function Reliefs() {
  const { activeShip } = useAppState();
  if (!activeShip) return null;
  // Keyed by ship, so that switching ships does not carry the old list across.
  return <ReliefList key={activeShip.id} shipId={activeShip.id} maxMonths={maxMonthsOnboardOf(activeShip)} />;
}

import { useMemo } from 'preact/hooks';
import { useAppState } from '../../app/AppState';
import { listForShip } from '../../db/records';
import { rankLabel } from '../../domain/catalogues';
import { maxMonthsOnboardOf } from '../../domain/contracts';
import { fullName } from '../../domain/crew';
import { worstBand } from '../../domain/expiry';
import type { CrewMember } from '../../domain/types';
import { BandBadge, ROW_TONE } from '../components/BandBadge';
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
        <ul class="row-list" role="list" aria-label="Reliefs">
          {rows.map((row) => (
            <li key={row.member.id}>
              <a
                class="list-row relief-row" data-tone={ROW_TONE[worstBand(row.contractBand, row.limitBand)]}
                href={`#/ship/crew/${encodeURIComponent(row.member.id)}`}
              >
                <span class="list-row-text">
                  <span class="list-row-overline">{rankLabel(row.member)}</span>
                  <span class="list-row-title">{fullName(row.member)}</span>
                  <span class="list-row-meta">{reliefDetails(row).map((detail) => <span key={detail}>{detail}</span>)}</span>
                </span>
                <span class="relief-badges">
                  <BandBadge band={row.contractBand} kind="contract" />
                  <BandBadge band={row.limitBand} kind="limit" />
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

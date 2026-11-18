import { useMemo } from 'preact/hooks';
import { useAppState } from '../app/AppState';
import { listForShip } from '../db/records';
import { collectAlerts } from '../domain/alerts';
import type { Alert } from '../domain/alerts';
import { maxMonthsOnboardOf } from '../domain/contracts';
// Type-only: the survey's own code stays in its chunk.
import type { Certificate, CrewDocument, CrewMember, DraftSurvey, ShipProfile, Voyage } from '../domain/types';
import { useLive } from './useLive';

/** The records of a ship that Home, the Ship hub and the Due screen read. Deleted records are left out. */
export interface ShipRecords {
  crew: CrewMember[];
  certificates: Certificate[];
  crewDocuments: CrewDocument[];
  voyages: Voyage[];
  surveys: DraftSurvey[];
}

/**
 * The ship's records, live: one read of the five tables, kept up to date. `undefined` while they load. A screen that shows
 * them is keyed by the ship, so that a switch of ship never shows the last ship's records under the new one's name.
 */
export function useShipRecords(shipId: string): ShipRecords | undefined {
  const { db } = useAppState();
  return useLive(async () => {
    const [crew, certificates, crewDocuments, voyages, surveys] = await Promise.all([
      listForShip<CrewMember>(db, 'crew', shipId),
      listForShip<Certificate>(db, 'certificates', shipId),
      listForShip<CrewDocument>(db, 'crewDocuments', shipId),
      listForShip<Voyage>(db, 'voyages', shipId),
      listForShip<DraftSurvey>(db, 'draftSurveys', shipId),
    ]);
    return { crew, certificates, crewDocuments, voyages, surveys };
  }, [db, shipId]);
}

/** The alerts of `collectAlerts` on the ship's today, worked out when the records, the date or the ship change. */
export function useShipAlerts(records: ShipRecords | undefined, ship: ShipProfile): Alert[] | undefined {
  const { shipToday } = useAppState();
  const maxMonthsOnboard = maxMonthsOnboardOf(ship);
  return useMemo(
    () => records && collectAlerts({ ...records, today: shipToday, maxMonthsOnboard }),
    [records, shipToday, maxMonthsOnboard],
  );
}

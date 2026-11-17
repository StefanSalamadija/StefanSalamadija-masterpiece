import { useAppState } from '../../../app/AppState';
import { getHydro, getSurveyShip, listSurveys } from '../../../db/survey';
import type { DraftSurvey, DraftSurveyShip, HydroTable } from '../../../domain/types';
import { useLive } from '../../useLive';

export interface SurveyData {
  ship?: DraftSurveyShip;
  hydro?: HydroTable;
  /** The ship's live surveys, newest first. */
  surveys: DraftSurvey[];
}

/** The active ship's draft survey data, kept up to date; `undefined` while it loads. */
export function useSurveyData(): SurveyData | undefined {
  const { db, activeShip } = useAppState();
  const shipId = activeShip?.id ?? '';
  return useLive(async () => {
    // Not the template: its file is large, and only the workbook export reads it (when it is made).
    const [ship, hydro, surveys] = await Promise.all([getSurveyShip(db, shipId), getHydro(db, shipId), listSurveys(db, shipId)]);
    return { ship, hydro, surveys };
  }, [db, shipId]);
}

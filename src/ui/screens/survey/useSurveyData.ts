import { useAppState } from '../../../app/AppState';
import { getHydro, getSurveyShip, getTemplate, listSurveys } from '../../../db/survey';
import type { DraftSurvey, DraftSurveyShip, HydroTable, SurveyTemplate } from '../../../domain/types';
import { useLive } from '../../useLive';

export interface SurveyData {
  ship?: DraftSurveyShip;
  hydro?: HydroTable;
  template?: SurveyTemplate;
  /** The ship's live surveys, newest first. */
  surveys: DraftSurvey[];
}

/** The active ship's draft survey data, kept up to date; `undefined` while it loads. */
export function useSurveyData(): SurveyData | undefined {
  const { db, activeShip } = useAppState();
  const shipId = activeShip?.id ?? '';
  return useLive(async () => {
    const [ship, hydro, template, surveys] = await Promise.all([
      getSurveyShip(db, shipId), getHydro(db, shipId), getTemplate(db, shipId), listSurveys(db, shipId),
    ]);
    return { ship, hydro, template, surveys };
  }, [db, shipId]);
}

import { isValidIsoDate } from '../domain/dates';
import type { CrewView } from '../domain/crew';

/** How the crew list is looking at the crew. */
export interface CrewListView {
  view: CrewView;
  /**
   * The text of the As-at date input: `undefined` while it was never touched (it then shows the ship's today), and
   * `''` once it was emptied. It is kept as typed so that the input is never refilled while someone is still typing.
   */
  asAt: string | undefined;
}

const START: CrewListView = { view: 'onboard', asAt: undefined };

let current: CrewListView = START;

/**
 * The view the user left the crew list in. It lives as long as the page does, not longer, so that going to a crew
 * member and back finds the list as it was, and a reload starts afresh.
 */
export function crewListView(): CrewListView {
  return current;
}

/** Changes the view (the parts given) and returns the new one. */
export function setCrewListView(change: Partial<CrewListView>): CrewListView {
  current = { ...current, ...change };
  return current;
}

/** Back to the start: Onboard, as at today. For tests. */
export function resetCrewListView(): void {
  current = START;
}

/** The date the list is as at: what was typed if it is a real date, else the ship's today (never an empty or broken date). */
export function resolveAsAt(text: string | undefined, shipToday: string): string {
  return text !== undefined && isValidIsoDate(text) ? text : shipToday;
}

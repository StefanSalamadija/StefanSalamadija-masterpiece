import type { RowGroupDef } from '../forms/types';
import { isValidIsoDate } from './dates';

/** The part of a row group that `todayRowIndex` reads. */
type DayGridGroup = Pick<RowGroupDef, 'rowLabels' | 'capacity'>;

/**
 * The index of the row for the ship's today in a day grid: the day of the month minus one. When the grid names its
 * rows (`rowLabels`), the row whose label starts with that number (`5`, `05`, `5th`), else `-1`; without labels, day minus
 * one while the grid has that many rows. `-1` when the grid has no such row.
 */
export function todayRowIndex(group: DayGridGroup, shipToday: string): number {
  if (!isValidIsoDate(shipToday)) return -1;
  const day = Number(shipToday.slice(8, 10));
  if (group.rowLabels !== undefined) return group.rowLabels.findIndex((l) => Number.parseInt(l, 10) === day);
  return day - 1 < group.capacity ? day - 1 : -1;
}

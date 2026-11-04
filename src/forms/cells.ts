import type { RowGroupDef } from './types';

/**
 * Whether row `index` (from 0) of a group has a cell to fill under the column `columnId` (R22): not one that continues
 * a vertical merge (`RowGroupDef.closed`). A row past the template's own is a clone of its last row, and has its cells.
 */
export function isOpenCell(group: RowGroupDef, index: number, columnId: string): boolean {
  const closed = group.closed?.[columnId];
  return closed === undefined || !closed.includes(Math.min(index, group.capacity - 1));
}

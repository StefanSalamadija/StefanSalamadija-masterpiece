/** A number the survey sums can use: not text, not `NaN`, not infinite. */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** A number, or nothing: an optional survey figure. */
export function isOptionalFinite(value: unknown): boolean {
  return value === undefined || isFiniteNumber(value);
}

const HYDRO_REQUIRED = ['draft', 'displacement', 'tpc', 'mtc', 'lcbMid', 'lcfMid'] as const;

/**
 * Hydrostatic rows the look-ups can rely on: a list of rows whose figures are all finite numbers (`lcfTabledMid` may be
 * absent), in strictly increasing draft order, as the workbook's approximate VLOOKUP needs them.
 */
export function hydroRowsOk(rows: unknown): boolean {
  if (!Array.isArray(rows)) return false;
  let previous = -Infinity;
  for (const row of rows as unknown[]) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) return false;
    const r = row as Record<string, unknown>;
    if (!HYDRO_REQUIRED.every((key) => isFiniteNumber(r[key])) || !isOptionalFinite(r.lcfTabledMid)) return false;
    if ((r.draft as number) <= previous) return false;
    previous = r.draft as number;
  }
  return true;
}

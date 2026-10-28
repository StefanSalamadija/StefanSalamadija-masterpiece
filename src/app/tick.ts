/** Milliseconds from `nowMs` to the next multiple of `stepMs` on the wall clock; a whole step when `nowMs` is on one. */
export function msUntilNextTick(nowMs: number, stepMs: number): number {
  return stepMs - (nowMs % stepMs);
}

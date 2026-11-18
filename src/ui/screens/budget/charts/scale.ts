import { MONTH_NAMES } from '../../../../domain/dates';
import type { Cents, Ym } from '../../../../domain/types';

/* The arithmetic of the hand-made SVG charts: round axis ticks, linear scales, line paths and short labels. Pure. */

const NICE = [1, 2, 2.5, 5, 10];
const tidy = (v: number) => Math.round(v * 1e9) / 1e9;

/**
 * Round ticks over [min, max], about `count` steps: the step is the smallest of 1, 2, 2.5, 5 × a power of ten at or
 * above (max − min) ÷ count, and the domain is rounded out to whole steps. `zero` takes 0 into the domain (a bar
 * starts at 0). A flat series runs from 0 to its value (0 to 1 for nothing at all).
 */
export function niceTicks(min: number, max: number, count: number, opts: { zero?: boolean } = {}): { min: number; max: number; ticks: number[] } {
  let lo = Math.min(min, max);
  let hi = Math.max(min, max);
  if (opts.zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (lo === hi) {
    if (lo === 0) hi = 1;
    else { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  }
  const raw = (hi - lo) / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = NICE.find((n) => n * magnitude >= raw - 1e-12)! * magnitude;
  const start = tidy(Math.floor(tidy(lo / step)) * step);
  const end = tidy(Math.ceil(tidy(hi / step)) * step);
  const ticks: number[] = [];
  for (let v = start, i = 0; v <= end + step / 1e6; i += 1, v = tidy(start + i * step)) ticks.push(v);
  return { min: start, max: end, ticks };
}

/** A linear map from `domain` to `range`; a domain of one value maps to the middle of the range. */
export function scaleLinear([d0, d1]: [number, number], [r0, r1]: [number, number]): (v: number) => number {
  if (d0 === d1) return () => (r0 + r1) / 2;
  return (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** An SVG path through the points. */
export function linePath(points: [number, number][]): string {
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${r1(x)} ${r1(y)}`).join('');
}

/**
 * At most `max` indexes of `n` items for axis labels, evenly from the first to the last. A last label drawn from its end
 * (`endAnchored`, the line charts) takes a whole step of room to its left, a centred one half a step.
 */
export function tickIndexes(n: number, max: number, endAnchored = false): number[] {
  if (n <= 0) return [];
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const step = Math.ceil((n - 1) / (max - 1));
  const out: number[] = [];
  for (let i = 0; i < n - 1; i += step) out.push(i);
  if (n - 1 - out[out.length - 1] < (endAnchored ? step : step / 2)) out.pop();
  out.push(n - 1);
  return out;
}

const MINUS = '−';

/** An axis amount, short: `€500`, `€1.2k`, `€18k`, `€1.5M`, `−€3.5k`. */
export function compactMoney(c: Cents): string {
  const euros = Math.abs(c) / 100;
  const short = (v: number) => (v >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10));
  const text = euros >= 1e6 ? `${short(euros / 1e6)}M` : euros >= 1000 ? `${short(euros / 1000)}k` : String(Math.round(euros));
  return `${c < 0 ? MINUS : ''}€${text}`;
}

/** `2026-10` → `Oct 26`. */
export function shortMonth(ym: Ym): string {
  return `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;
}

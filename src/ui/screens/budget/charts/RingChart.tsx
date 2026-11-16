import { formatMoney } from '../../../../budget/money';
import type { Cents } from '../../../../domain/types';
import { ChartFrame } from './ChartFrame';

const R = 26;
const C = 2 * Math.PI * R;

/** Spent as a whole % of target; none without a target. */
export function ofTarget(spent: Cents, target: Cents): number | undefined {
  return target > 0 ? Math.round((spent * 100) / target) : undefined;
}

/**
 * Rings of spent against target, one per item (a pot): the ring fills with the share of the target spent, and an item
 * over its target is drawn in the warning colour and says so in words.
 */
export function RingChart({ name, items }: { name: string; items: { label: string; spent: Cents; target: Cents }[] }) {
  const table = {
    columns: ['', 'Target', 'Spent', 'Of target'],
    rows: items.map((it) => {
      const pct = ofTarget(it.spent, it.target);
      return [it.label, formatMoney(it.target), formatMoney(it.spent), pct === undefined ? 'No target' : `${pct}%`];
    }),
  };
  return (
    <ChartFrame name={name} table={table}>
      <div class="rings" role="img" aria-label={name}>
        {items.map((it) => {
          const pct = ofTarget(it.spent, it.target);
          const over = pct !== undefined && it.spent > it.target;
          const fill = pct === undefined ? 0 : Math.min(100, pct);
          return (
            <div key={it.label} class="ring">
              <svg viewBox="0 0 64 64" aria-hidden="true">
                <circle class="ring-track" cx="32" cy="32" r={R} />
                <circle class={over ? 'ring-value ring-over' : 'ring-value'} cx="32" cy="32" r={R}
                  stroke-dasharray={`${(fill / 100) * C} ${C}`} transform="rotate(-90 32 32)" />
                <text class="ring-pct" x="32" y="36" text-anchor="middle">{pct === undefined ? '—' : `${pct}%`}</text>
              </svg>
              <span class="ring-label">{it.label}</span>
              <span class="ring-detail">{formatMoney(it.spent)}{it.target > 0 ? ` of ${formatMoney(it.target)}` : ''}{over ? ' · over' : ''}</span>
            </div>
          );
        })}
      </div>
    </ChartFrame>
  );
}

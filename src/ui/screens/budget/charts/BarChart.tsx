import { formatMoney } from '../../../../budget/money';
import { ChartFrame, Legend } from './ChartFrame';
import type { Series } from './LineChart';
import { compactMoney, niceTicks, scaleLinear, tickIndexes } from './scale';

const W = 320;
const H = 170;
const PAD = { left: 46, right: 8, top: 8, bottom: 22 };

/**
 * A bar chart, plan against actual: for each label a group of bars, one per series (the plan an outline, the actual
 * solid, so that they print apart), from 0 up.
 */
export function BarChart({ name, labels, short, series }: { name: string; labels: string[]; short?: string[]; series: Series[] }) {
  const all = series.flatMap((s) => s.values);
  const { min, max, ticks } = niceTicks(Math.min(0, ...all), Math.max(0, ...all), 4, { zero: true });
  const y = scaleLinear([min, max], [H - PAD.bottom, PAD.top]);
  const n = Math.max(1, labels.length);
  const group = (W - PAD.left - PAD.right) / n;
  const bar = Math.max(1, (group * 0.8) / Math.max(1, series.length));
  const table = { columns: ['', ...series.map((s) => s.label)], rows: labels.map((l, i) => [l, ...series.map((s) => formatMoney(s.values[i] ?? 0))]) };
  return (
    <ChartFrame name={name} table={table} legend={<Legend items={series.map((s, i) => ({ label: s.label, kind: 'bar' as const, index: i }))} />}>
      <svg class="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={name}>
        {ticks.map((t) => (
          <g key={t}>
            <line class={t === 0 ? 'chart-zero' : 'chart-grid'} x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
            <text class="chart-label" x={PAD.left - 4} y={y(t) + 3} text-anchor="end">{compactMoney(t)}</text>
          </g>
        ))}
        {labels.map((_, i) => series.map((s, k) => {
          const v = s.values[i] ?? 0;
          const top = y(Math.max(0, v));
          const left = PAD.left + i * group + group * 0.1 + k * bar;
          return <rect key={`${i}-${k}`} class={`chart-bar bar-${k}`} x={left} y={top} width={Math.max(0.5, bar - 1)} height={Math.max(0, y(Math.min(0, v)) - top)} />;
        }))}
        {tickIndexes(labels.length, 6).map((i) => (
          <text key={i} class="chart-label" x={PAD.left + (i + 0.5) * group} y={H - 6} text-anchor="middle">{(short ?? labels)[i]}</text>
        ))}
      </svg>
    </ChartFrame>
  );
}

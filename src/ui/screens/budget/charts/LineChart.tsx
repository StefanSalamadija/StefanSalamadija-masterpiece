import { formatMoney } from '../../../../budget/money';
import { monthLabel } from '../../../../budget/months';
import type { Cents, Ym } from '../../../../domain/types';
import { ChartFrame, Legend } from './ChartFrame';
import { compactMoney, linePath, niceTicks, scaleLinear, shortMonth, tickIndexes } from './scale';

export interface Series { label: string; values: Cents[] }

const W = 320;
const H = 180;
const PAD = { left: 46, right: 8, top: 8, bottom: 22 };

/**
 * A line chart of amounts by month: each series a line of its own (told apart by dash as well as colour, so that it
 * prints), the months flagged in `shade` (home months) shaded, round ticks on the left and a few month labels below.
 */
export function LineChart({ name, months, series, shade, shadeLabel = 'Home months' }: {
  name: string; months: Ym[]; series: Series[]; shade?: boolean[]; shadeLabel?: string;
}) {
  const all = series.flatMap((s) => s.values);
  const { min, max, ticks } = niceTicks(Math.min(0, ...all), Math.max(0, ...all), 4);
  const n = months.length;
  const x = scaleLinear([0, Math.max(1, n - 1)], [PAD.left, W - PAD.right]);
  const y = scaleLinear([min, max], [H - PAD.bottom, PAD.top]);
  const step = n > 1 ? (W - PAD.left - PAD.right) / (n - 1) : W - PAD.left - PAD.right;
  const table = {
    columns: ['Month', ...series.map((s) => s.label), ...(shade ? ['Home'] : [])],
    rows: months.map((ym, i) => [monthLabel(ym), ...series.map((s) => formatMoney(s.values[i] ?? 0)), ...(shade ? [shade[i] ? 'Home' : ''] : [])]),
  };
  const legend = (
    <Legend items={[...series.map((s, i) => ({ label: s.label, kind: 'line' as const, index: i })),
      ...(shade?.some(Boolean) ? [{ label: shadeLabel, kind: 'shade' as const, index: 0 }] : [])]} />
  );
  return (
    <ChartFrame name={name} table={table} legend={legend}>
      <svg class="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={name}>
        {shade?.map((on, i) => on && (
          <rect key={i} class="chart-shade" x={Math.max(PAD.left, x(i) - step / 2)} y={PAD.top}
            width={Math.min(x(i) + step / 2, W - PAD.right) - Math.max(PAD.left, x(i) - step / 2)} height={H - PAD.top - PAD.bottom} />
        ))}
        {ticks.map((t) => (
          <g key={t}>
            <line class={t === 0 ? 'chart-zero' : 'chart-grid'} x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
            <text class="chart-label" x={PAD.left - 4} y={y(t) + 3} text-anchor="end">{compactMoney(t)}</text>
          </g>
        ))}
        {tickIndexes(n, 5).map((i) => (
          <text key={i} class="chart-label" x={x(i)} y={H - 6} text-anchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>{shortMonth(months[i])}</text>
        ))}
        {series.map((s, k) => (
          <path key={s.label} class={`chart-line series-${k}`} d={linePath(s.values.map((v, i) => [x(i), y(v)]))} />
        ))}
      </svg>
    </ChartFrame>
  );
}

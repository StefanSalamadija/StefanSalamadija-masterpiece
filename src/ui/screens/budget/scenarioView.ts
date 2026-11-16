import { POTS } from '../../../budget/catalog';
import { formatMoney } from '../../../budget/money';
import { monthLabel } from '../../../budget/months';
import type { CompareRow } from '../../../budget/scenarios';
import type { ScenarioChange } from '../../../budget/scenarioTypes';
import type { BudgetDebt, PotId } from '../../../domain/types';
import { dayLabel } from './planKit';

/* What the scenario screens say: a change in one line, and the compare table's rows. Pure. */

/** Up to 5 scenarios are kept, and up to 3 compared with the base plan (v2 §3.5). */
export const MAX_SCENARIOS = 5;
export const MAX_COMPARED = 3;

const potLabel = (pot: PotId) => POTS.find((p) => p.id === pot)!.label;

/** A change in one line, as the scenario's list of changes shows it. */
export function describeChange(c: ScenarioChange, debts: BudgetDebt[]): string {
  switch (c.kind) {
    case 'oneOff':
      return `${c.label}: ${formatMoney(c.amount)} in ${monthLabel(c.ym)} (${c.income ? 'income' : c.pot !== undefined ? potLabel(c.pot) : 'no pot'})`;
    case 'investment':
      return `Investments: ${formatMoney(c.monthly)} a month from ${monthLabel(c.fromYm)} on`;
    case 'salary':
      return `Salary: ${formatMoney(c.amount)} a month from ${monthLabel(c.fromYm)} on`;
    case 'potTarget':
      return `${potLabel(c.pot)} target: ${formatMoney(c.amount)} a month from ${monthLabel(c.fromYm)} on`;
    case 'extraDebt': {
      const name = debts.find((d) => d.id === c.debtId)?.name ?? 'A debt no longer there';
      const parts = [
        ...(c.monthly !== undefined && c.monthly > 0 ? [`extra ${formatMoney(c.monthly)} a month`] : []),
        ...(c.lump !== undefined && c.lump > 0 && c.lumpYm !== undefined ? [`${formatMoney(c.lump)} in ${monthLabel(c.lumpYm)}`] : []),
      ];
      return `${name}: ${parts.join(', ') || 'nothing extra'}`;
    }
    case 'rates': {
      const parts = [
        ...(c.yearlyReturnPct !== undefined ? [`expected return ${c.yearlyReturnPct}%`] : []),
        ...(c.withdrawalRatePct !== undefined ? [`withdrawal rate ${c.withdrawalRatePct}%`] : []),
        ...(c.inflationPct !== undefined ? [`inflation ${c.inflationPct}%`] : []),
      ];
      return `Rates: ${parts.join(', ') || 'unchanged'}`;
    }
    case 'rotation': {
      const parts = [
        ...(c.patternOn !== undefined || c.patternOff !== undefined ? [`${c.patternOn ?? '–'} months on, ${c.patternOff ?? '–'} off`] : []),
        ...(c.periods !== undefined && c.periods.length > 0
          ? [`last contract ${dayLabel(c.periods[c.periods.length - 1].signOn)} – ${dayLabel(c.periods[c.periods.length - 1].signOff)}`] : []),
      ];
      return `Rotation: ${parts.join('; ') || 'unchanged'}`;
    }
  }
}

/** The compare table: a row per figure, a column per plan (v2 §3.5). */
export function compareTable(rows: CompareRow[], opts: { hasDebts: boolean; freedomKnown: boolean }): { label: string; cells: string[] }[] {
  const ym = (v: string | undefined, none: string) => (v === undefined ? none : monthLabel(v));
  return [
    { label: 'Debt-free', cells: rows.map((r) => (opts.hasDebts ? ym(r.debtFree, 'Not within 10 years') : 'No debts')) },
    { label: 'Lowest bank', cells: rows.map((r) => (r.lowest ? `${formatMoney(r.lowest.amount)} in ${monthLabel(r.lowest.ym)}` : '—')) },
    { label: 'Net worth in 1 year', cells: rows.map((r) => formatMoney(r.netWorth1y)) },
    { label: 'Net worth in 5 years', cells: rows.map((r) => formatMoney(r.netWorth5y)) },
    { label: 'Net worth in 10 years', cells: rows.map((r) => formatMoney(r.netWorth10y)) },
    { label: 'Freedom date', cells: rows.map((r) => (!opts.freedomKnown ? 'Needs assumptions' : ym(r.freedom, 'Not within 60 years'))) },
    { label: 'Total interest (10 years)', cells: rows.map((r) => formatMoney(r.totalInterest)) },
  ];
}

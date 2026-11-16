import { forecast } from '../../../budget/forecast';
import type { ForecastResult } from '../../../budget/forecast';
import { freedom } from '../../../budget/freedom';
import type { FreedomResult } from '../../../budget/freedom';
import { formatMoney } from '../../../budget/money';
import { monthLabel, ymOf } from '../../../budget/months';
import { yearlySpending } from '../../../budget/yearlySpending';
import type { YearlySpending } from '../../../budget/yearlySpending';
import type { Ym } from '../../../domain/types';
import { budgetDataOf } from './planKit';
import type { PlanData } from './planKit';

/* What the dashboard, net worth and scenario screens work out from the plan, the same way on each. */

/** The months the freedom date and the scenarios look ahead: 10 years, as `compareScenarios` does. */
export const LONG_MONTHS = 120;

export interface Outlook { yearly: YearlySpending; long: ForecastResult; freedom: FreedomResult }

/** The yearly spending, the 10-year forecast and the freedom date from it. */
export function outlookOf(data: PlanData, today: string): Outlook {
  const yearly = yearlySpending({ entries: data.entries, categories: data.categories, assumptions: data.settings.assumptions, currentYm: ymOf(today) });
  const long = forecast({ today, data: budgetDataOf(data), settings: data.settings, months: LONG_MONTHS });
  return { yearly, long, freedom: freedom({ forecast: long, yearlySpending: yearly.amount, assumptions: data.settings.assumptions, today }) };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The freedom date as the screens say it, or what it still needs. */
export function freedomText(o: Outlook): { text: string; ym?: Ym; missing?: boolean } {
  const f = o.freedom;
  if (f.status === 'needsBankStart') return { text: 'Enter your bank balance to see the forecast', missing: true };
  if (f.status === 'needsAssumptions') {
    const names = f.missing.map((m) => (m === 'yearlyReturnPct' ? 'an expected return' : m === 'inflationPct' ? 'inflation' : 'a withdrawal rate'));
    return { text: `Enter ${names.join(' and ')} in Assumptions to see the freedom date`, missing: true };
  }
  if (o.yearly.amount <= 0) return { text: 'Enter your yearly spending in Assumptions, or track a month, to see the freedom date', missing: true };
  if (f.ym === undefined) return { text: 'Not within 60 years at this plan.' };
  return { text: `At this plan: ${monthLabel(f.ym)} (in ${plural(f.years!, 'year')} ${plural(f.months!, 'month')})`, ym: f.ym };
}

/** The forecast's status words: Onboard, Home, Part onboard. */
export function statusText(status: string): string {
  return status === 'onboard' ? 'Onboard' : status === 'home' ? 'Home' : 'Part onboard';
}

/** Each run of warning months once, at its first month: "Free to spend drops below €… in …", "Bank goes negative in …". */
export function warningLines(r: ForecastResult): string[] {
  const out: { ym: Ym; text: string }[] = [];
  const seen = new Set<string>();
  for (const kind of ['belowBuffer', 'negativeBank'] as const) {
    const months = r.warnings.filter((w) => w.kind === kind).map((w) => w.ym);
    for (const [i, ym] of months.entries()) {
      const prevYm = i > 0 ? months[i - 1] : undefined;
      if (prevYm !== undefined && r.months.findIndex((m) => m.ym === prevYm) === r.months.findIndex((m) => m.ym === ym) - 1) continue;
      const text = kind === 'belowBuffer' ? `Free to spend drops below ${formatMoney(r.buffer)} in ${monthLabel(ym)}` : `Bank goes negative in ${monthLabel(ym)}`;
      if (!seen.has(text)) { seen.add(text); out.push({ ym, text }); }
    }
  }
  return out.sort((a, b) => (a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : 0)).map((w) => w.text);
}


export const DISCLAIMER = 'Projection — not a forecast or financial advice.';

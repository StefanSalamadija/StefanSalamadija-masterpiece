import type { Cents, PotId, Ym } from '../domain/types';

/**
 * One change a "what if" scenario makes to the forecast. Scenarios change the forecast only, until "Apply to plan"
 * writes each change to its real place. Declared here, apart from the scenario code, so that the forecast can take
 * them as overrides.
 */
export type ScenarioChange =
  | { kind: 'rotation'; periods?: { signOn: string; signOff: string }[]; patternOn?: number; patternOff?: number }
  | { kind: 'salary'; fromYm: Ym; amount: Cents }
  | { kind: 'oneOff'; ym: Ym; amount: Cents; pot?: PotId; income?: boolean; label: string }
  | { kind: 'extraDebt'; debtId: string; monthly?: Cents; lumpYm?: Ym; lump?: Cents }
  | { kind: 'investment'; fromYm: Ym; monthly: Cents }
  | { kind: 'rates'; yearlyReturnPct?: number; withdrawalRatePct?: number; inflationPct?: number }
  | { kind: 'potTarget'; pot: PotId; fromYm: Ym; amount: Cents };

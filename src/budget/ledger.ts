import type {
  BudgetAsset, BudgetCategory, BudgetCorrection, BudgetDebt, BudgetEntry, BudgetFund, BudgetFundMove, BudgetRecurring, Cents, Ym,
} from '../domain/types';
import { laterCorrection } from './corrections';
import { monthlyInterest } from './debts';
import { fundLedger } from './funds';
import { addMonths, ymOf } from './months';

/*
 * The balance of each account at each month end (base §3.6, v2 §3.1 and §3.9.1–§3.9.3, §3.9.7), from the actual
 * entries, the fund records and the user's corrections. Nothing here is stored: only the corrections are.
 *
 *  - Bank & cash: income raises it; every expense lowers it, transfers included.
 *  - A transfer is an expense in a Savings & investments, Emergency fund or Debts category. It lowers the bank and
 *    raises investments or the emergency fund (a separate account), or lowers a debt: the net worth does not change.
 *    The "Savings goals" category is the exception: money saved for a goal stays in the bank, earmarked, so its
 *    entries move nothing.
 *  - A debt starts at its start balance in its start month. Each month from then on it is charged a month of interest
 *    on the balance at the start of the month (yearly rate ÷ 12, rounded to the cent), whether or not a payment is
 *    made, and every payment lowers it in full. So a month with one instalment lowers the debt by the principal
 *    (instalment − interest), as in `amortise`. A payment goes to:
 *      - the debt the entry names (`debtId`);
 *      - else the debt its recurring template pays off (`untilDebtId`);
 *      - else the only debt, when there is exactly one.
 *    Otherwise it lowers no debt (the bank still pays it). With no debts at all, that is all. With two or more, or
 *    when the debt it names is not there (deleted), it is listed in `unassignedDebtPayments`, so that the user can be
 *    asked which debt it paid.
 *  - An income entry that names an asset it sold lowers that asset by its amount, never below zero. An asset's value
 *    is otherwise its corrections.
 *  - Sinking funds sit inside the bank: a set-aside moves no bank money; a bill paid from a fund is an ordinary expense
 *    that lowers the bank, and its fund record lowers the fund. A fund's balance is `fundLedger`'s, corrections
 *    included.
 *  - A correction sets the account's balance at the end of its month; later months continue from it. Of several
 *    corrections of one account in one month, the last one saved counts.
 *  - Planned (unconfirmed) and deleted entries move nothing.
 */

export type Account = BudgetCorrection['account'];

/** The default "Savings goals" category (its seeded id): money saved for a goal stays in the bank. */
export const SAVINGS_GOALS_CATEGORY_ID = 'budget-cat:savings:savings-goals';

/** A payment in a Debts category that `balancesByMonth` could not put against a debt. */
export interface UnassignedDebtPayment { entryId: string; ym: Ym; amount: Cents }

export function balancesByMonth(input: {
  entries: BudgetEntry[]; corrections: BudgetCorrection[]; debts: BudgetDebt[]; assets: BudgetAsset[];
  categories: BudgetCategory[]; fundMoves: BudgetFundMove[]; funds: BudgetFund[]; fromYm: Ym; toYm: Ym;
  /** The recurring templates, to know which debt a payment made from one pays. */
  recurring?: BudgetRecurring[];
}): {
  /** Each month end from `fromYm` to `toYm`, in order. */
  balances: Map<Ym, Record<Account, Cents>>;
  /** The actual Debts payments up to `toYm` that lowered no debt though there are debts, in date order. */
  unassignedDebtPayments: UnassignedDebtPayment[];
} {
  const out = new Map<Ym, Record<Account, Cents>>();
  const unassignedDebtPayments: UnassignedDebtPayment[] = [];
  if (input.toYm < input.fromYm) return { balances: out, unassignedDebtPayments };

  const debts = input.debts.filter((d) => !d.deleted);
  const assets = input.assets.filter((a) => !a.deleted);
  const funds = input.funds.filter((f) => !f.deleted);
  const entries = input.entries.filter((e) => !e.deleted && e.status === 'actual');
  const potOf = new Map(input.categories.map((c) => [c.id, c.pot]));
  const debtIds = new Set(debts.map((d) => d.id));
  const assetIds = new Set(assets.map((a) => a.id));
  const debtOfTemplate = new Map((input.recurring ?? []).filter((t) => !t.deleted && t.untilDebtId !== undefined).map((t) => [t.id, t.untilDebtId!]));

  /** Which debt a payment pays, if any. */
  const debtPaidBy = (e: BudgetEntry): string | undefined => {
    if (e.debtId !== undefined) return debtIds.has(e.debtId) ? e.debtId : undefined;
    const viaTemplate = e.recurringId !== undefined ? debtOfTemplate.get(e.recurringId) : undefined;
    if (viaTemplate !== undefined && debtIds.has(viaTemplate)) return viaTemplate;
    return debts.length === 1 ? debts[0].id : undefined;
  };

  // What the entries move, by month and account.
  const flows = new Map<Ym, Map<Account, Cents>>();
  const flow = (ym: Ym, account: Account, amount: Cents) => {
    const month = flows.get(ym) ?? new Map<Account, Cents>();
    month.set(account, (month.get(account) ?? 0) + amount);
    flows.set(ym, month);
  };
  const byDate = [...entries].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const e of byDate) {
    const ym = ymOf(e.date);
    if (e.kind === 'income') {
      flow(ym, 'bank', e.amount);
      if (e.soldAssetId !== undefined && assetIds.has(e.soldAssetId)) flow(ym, `asset:${e.soldAssetId}`, -e.amount);
      continue;
    }
    if (e.categoryId === SAVINGS_GOALS_CATEGORY_ID) continue;
    flow(ym, 'bank', -e.amount);
    const pot = e.categoryId !== undefined ? potOf.get(e.categoryId) : undefined;
    if (pot === 'savings') flow(ym, 'investments', e.amount);
    else if (pot === 'emergency') flow(ym, 'emergency', e.amount);
    else if (pot === 'debts') {
      const debtId = debtPaidBy(e);
      if (debtId !== undefined) flow(ym, `debt:${debtId}`, -e.amount);
      else if ((debts.length > 0 || e.debtId !== undefined) && ym <= input.toYm) unassignedDebtPayments.push({ entryId: e.id, ym, amount: e.amount });
    }
  }

  // The correction that counts for each account and month.
  const corrections = new Map<string, BudgetCorrection>();
  for (const c of input.corrections) {
    if (c.deleted) continue;
    const key = `${c.account}|${c.ym}`;
    const held = corrections.get(key);
    if (held === undefined || laterCorrection(c, held)) corrections.set(key, c);
  }
  const correctionOf = (account: Account, ym: Ym) => corrections.get(`${account}|${ym}`)?.balance;

  // Start early enough to take in every record before fromYm.
  let start = input.fromYm;
  const consider = (ym: Ym) => { if (ym < start) start = ym; };
  for (const e of entries) consider(ymOf(e.date));
  for (const c of corrections.values()) consider(c.ym);
  for (const d of debts) consider(d.startYm);
  for (const m of input.fundMoves) if (!m.deleted) consider(m.ym);

  const plain: Account[] = ['bank', 'investments', 'emergency', ...assets.map((a) => `asset:${a.id}` as const)];
  const held = new Map<Account, Cents>(plain.map((a) => [a, 0]));
  /** A debt's balance once it has started (its start month, or an earlier correction). */
  const debtHeld = new Map<string, Cents>();

  for (let ym = start; ym <= input.toYm; ym = addMonths(ym, 1)) {
    const moved = flows.get(ym);
    for (const account of plain) {
      let balance = held.get(account)! + (moved?.get(account) ?? 0);
      if (account.startsWith('asset:')) balance = Math.max(0, balance);
      held.set(account, correctionOf(account, ym) ?? balance);
    }
    for (const d of debts) {
      const account = `debt:${d.id}` as const;
      let balance = debtHeld.get(d.id);
      if (balance === undefined && ym >= d.startYm) balance = d.startBalance;
      if (balance !== undefined) {
        if (ym >= d.startYm) balance += monthlyInterest(balance, d.yearlyRatePct);
        balance += moved?.get(account) ?? 0;
      }
      const corrected = correctionOf(account, ym);
      if (corrected !== undefined) balance = corrected;
      if (balance !== undefined) debtHeld.set(d.id, balance);
    }
    if (ym < input.fromYm) continue;

    const record: Record<Account, Cents> = { bank: held.get('bank')!, investments: held.get('investments')!, emergency: held.get('emergency')! };
    for (const d of debts) record[`debt:${d.id}`] = debtHeld.get(d.id) ?? 0;
    for (const a of assets) record[`asset:${a.id}`] = held.get(`asset:${a.id}`)!;
    for (const f of funds) record[`fund:${f.id}`] = fundLedger(f, input.fundMoves, ym, input.corrections).balance;
    out.set(ym, record);
  }
  return { balances: out, unassignedDebtPayments };
}

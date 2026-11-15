# Budget Tracker v2 (Piece 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a personal budget tracker that replaces the user's Excel workbook. It has:
- fast entry;
- pots, categories, recurring payments and sinking funds;
- a rotation cash-flow forecast;
- net worth and the freedom date;
- scenarios;
- Excel import and export.

All of it is offline, in EUR, for one person.

**Architecture:**
- **Pure calculations** in `src/budget/` with no I/O and integer cents. They are fully unit-tested.
- **Dexie personal-scope tables**, schema version 5, in backups and snapshots, never in handovers.
- **One lazy `budget` chunk** for every screen. Charts are hand-made SVG.

**Tech Stack:** Preact 11, TypeScript, Dexie 4, SheetJS (existing), Vitest, Playwright 1.63. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-15-masterpiece-budget-v2-design.md`, on top of its base `docs/superpowers/specs/2026-10-25-masterpiece-budget-design.md`. The base applies unless v2 changes it. **§3.9 Accounting rules are binding.**

## Global Constraints

- All of `.superpowers/sdd/2026-10-25-masterpiece-base/global-constraints.md` applies. No new dependencies.
- **Money:**
  - Integer cents (`type Cents = number`, always an integer). Never use floats for stored amounts.
  - Display `€1,234.56`.
  - `parseMoney`: if both `.` and `,` appear, the last one is the decimal separator; one separator followed by 1–2 digits is the decimal. A negative is only accepted where stated.
- **Months** are `YYYY-MM` strings and dates are `YYYY-MM-DD`. "Today" is ship's today from `useAppState().shipToday`.
- **Scope:** every budget record has `scope: 'personal'`. The tables are appended last to `TABLE_NAMES`, are excluded from `SHIP_TABLES` like the library tables (`PERSONAL_TABLES`), and are **never** in `collectHandover`.
- **Pots** (exact ids and labels):
  - `needs` "Needs";
  - `savings` "Savings & investments";
  - `wants` "Wants";
  - `debts` "Debts";
  - `emergency` "Emergency fund".
- **Default categories** are exactly the base spec §3.3 table.
- **Defaults:**
  - pattern 8 months on / 4 off;
  - forecast horizon 24 months (choices 12, 24, 36, 60);
  - withdrawal rate 4%;
  - expected return: none (the user must enter it, 0% allowed);
  - inflation: none (the user must enter it);
  - paid in the same month;
  - paid at home 0%;
  - buffer 1 × average monthly Needs;
  - emergency fund target N = 6;
  - fund reminder 30 days.
- **Labels** (exact):
  - "Projection — not a forecast or financial advice.";
  - "an assumption, not advice";
  - "Enter your bank balance to see the forecast";
  - `Targets add up to <n>% — adjust to 100%.`;
  - "Not within 60 years at this plan.".
- **Main chunk:**
  - Budget code is imported only through `lazyScreen(() => import('../ui/screens/budget'))`.
  - Only these may enter the main chunk: the Home card, the "+ Expense" button, the routes and a tiny alert-count hook.
  - Main gzip may grow by **≤ 1.5 kB**. Measure the startup bytes (the index chunk plus its modulepreloads) against `main`.
- **Performance:** `forecast()` for 60 months with base + 4 scenarios takes **< 100 ms** in Node.
- **Privacy:** made-up data only in tests and commits. The user's workbook (`/root/.claude/uploads/.../16c4205e-BUDZETIRANJE.xlsx`) is used only locally in the final acceptance step and is never copied into the repo.

## Review Focus

1. **Money parsing of real phone input**, such as `1.234,56`, `1,234.56`, `12,5`, ` 7 `, `€12` and `-5` where negatives are not allowed. Expected: correct cents or a clear refusal, never a 100× error. Pinned in Task 1.
2. **Rounding drift across 60 forecast months**, where salary is prorated by days and interest is computed monthly. Expected: integer cents at every step, and totals equal to the sum of their parts. Pinned in Task 4: property tests over random plans check sum identities.
3. **A rotation crossing a month boundary or a leap year, with sign-on and sign-off on the same day.** Expected: inclusive day count and correct proration. Pinned in Task 4.
4. **The same entry edited on phone and laptop, then merged by backup.** Expected: the existing last-writer-wins merge works, and no budget record leaks into handovers. Pinned in Task 1.
5. **Quick add pressed twice fast, or offline.** Expected: one entry, saved locally, and Undo removes exactly that entry. Pinned in Task 6.

---

## File Structure

- `src/budget/`, all pure:
  - `money.ts`;
  - `months.ts` (month arithmetic);
  - `catalog.ts` (pots and default categories);
  - `targets.ts` (inheritance rules);
  - `month.ts` (month totals);
  - `planned.ts` (recurring and fund set-aside generation);
  - `funds.ts`;
  - `debts.ts`;
  - `ledger.ts` (balances over time from entries and corrections);
  - `netWorth.ts`;
  - `rotation.ts` (pay rule);
  - `forecast.ts`;
  - `freedom.ts`;
  - `scenarios.ts`;
  - `shorthand.ts`;
  - `excel/import.ts`, `excel/export.ts`.
  - Tests sit next to each file.
- `src/domain/types.ts`: the budget record types.
- `src/db/schema.ts`: version 5.
- `src/db/budget.ts`: reads and writes.
- `src/backup/service.ts`: handover exclusion.
- `src/ui/screens/budget/`: `index.ts`, then:
  - `Dashboard.tsx`, `MonthView.tsx`, `QuickAdd.tsx`, `CatchUp.tsx`;
  - `Plan*.tsx`, `Forecast.tsx`, `NetWorth.tsx`, `Scenarios.tsx`, `Trends.tsx`;
  - `StartBalances.tsx`, `ImportBudget.tsx`, `ExportBudget.tsx`;
  - `charts/` (`LineChart.tsx`, `BarChart.tsx`, `Ring.tsx`, `ChartTable.tsx`);
  - `budget.css`.
- Main-chunk files touched:
  - `src/app/router.ts` and `src/app/App.tsx`: routes;
  - `src/ui/screens/Home.tsx`: the Budget card, "+ Expense" and alert count;
  - `vite.config.ts`: manifest `shortcuts` entry `{ name: 'Add expense', url: './#/budget/add' }`.
- `e2e/budget.spec.ts` and `e2e/fixtures/makeBudgetXlsx.ts`.

---

### Task 1: Money, types, data layer

**Files:** `src/budget/{money,months,catalog}.ts` and their tests; `src/domain/types.ts`; `src/db/schema.ts`; `src/db/budget.ts` and its test; `src/backup/service.ts` and its test; `src/db/migrationV5.test.ts`.

**Interfaces (Produces):**

```ts
export type Cents = number; export type Ym = string; // 'YYYY-MM'
export function parseMoney(text: string, opts?: { negative?: boolean }): Cents | undefined | 'invalid';
export function formatMoney(c: Cents): string;            // '€1,234.56', '−€5.00'
export function addMonths(ym: Ym, n: number): Ym; export function monthsBetween(a: Ym, b: Ym): number; export function ymOf(date: string): Ym;
export type PotId = 'needs' | 'savings' | 'wants' | 'debts' | 'emergency';
export const POTS: readonly { id: PotId; label: string }[];
export const DEFAULT_CATEGORIES: readonly { pot: PotId; group?: string; name: string }[];
// types.ts — all extend BaseRecord with scope 'personal'
BudgetCategory { pot: PotId; group?: string; name: string; order: number; hidden: boolean; synonyms?: string[] }
BudgetEntry { kind: 'expense' | 'income'; date: string; amount: Cents; categoryId?: string; incomeSource?: 'salary'|'property'|'sales'|'jobs'|'other';
  note?: string; payee?: string; status: 'actual' | 'planned'; recurringId?: string; fundId?: string /* paid from fund */; soldAssetId?: string;
  importKey?: string /* month+cell, for re-import replacement */; oneOff?: boolean }
BudgetMonth { ym: Ym; plannedIncome?: Cents; potTargets: Partial<Record<PotId, { kind: 'pct'|'amount'; value: number; inherited: boolean }>>;
  categoryTargets: Record<string, { amount: Cents; inherited: boolean }>; notes?: string }
BudgetRecurring { name; amount: Cents; categoryId?; incomeSource?; day: number; startYm: Ym; endYm?: Ym; untilDebtId?: string }
BudgetFund { name; amount: Cents; dueYm: Ym; repeatMonths?: number; categoryId?; startBalance: Cents }
BudgetFundMove { fundId; ym: Ym; amount: Cents; kind: 'setaside' | 'paid'; entryId?: string }   // the "fund record" of spec §3.9.6
BudgetDebt { name; startBalance: Cents; yearlyRatePct: number; instalment: Cents; startYm: Ym }
BudgetGoal { name; amount: Cents; targetYm: Ym; categoryId? }
BudgetAsset { name; includeInNetWorth: boolean }
BudgetCorrection { account: 'bank'|'investments'|'emergency'|`debt:${string}`|`asset:${string}`|`fund:${string}`; ym: Ym; balance: Cents }
BudgetScenario { name; changes: ScenarioChange[] }            // ScenarioChange defined in Task 5
BudgetSettings { key: 'budget'; rotation: RotationSettings; assumptions: Assumptions; meCrewId?: string; favourites: { name; amount: Cents; categoryId }[];
  bufferCents?: Cents; forecastMethod: Record<PotId, 'targets'|'average'|'fixed'>; fixedSpend?: Partial<Record<PotId, Cents>>; horizon: 12|24|36|60 }
// RotationSettings { salaryFrom: { ym: Ym; amount: Cents }[]; periods: { signOn: string; signOff: string }[]; patternOn: number; patternOff: number; paidNextMonth: boolean; paidAtHomePct: number }
// Assumptions { yearlyReturnPct?: number; withdrawalRatePct: number; inflationPct?: number; emergencyMonths: number; fundReminderDays: number }
// db/budget.ts — CRUD per table following src/db/library.ts / records.ts patterns, plus:
export function ensureBudgetSetup(db): Promise<void>;  // seeds default categories + settings once
export function addEntry(db, e): Promise<BudgetEntry>; export function undoEntry(db, id): Promise<void>; // hard tombstone via soft delete
```

- **Tables**, all syncable and personal: `budgetCategories`, `budgetEntries` (indexed `id, date, categoryId, status`), `budgetMonths` (`id, ym`), `budgetRecurring`, `budgetFunds`, `budgetFundMoves` (`id, fundId, ym`), `budgetDebts`, `budgetGoals`, `budgetAssets`, `budgetCorrections` (`id, account, ym`), `budgetScenarios`, `budgetSettings` (`key`).
- **Schema version 5** calls `snapshotInUpgrade`.

- [ ] **Step 1: Write failing tests:**
  - **`parseMoney` cases:**
    - `1.234,56`→123456;
    - `1,234.56`→123456;
    - `12,5`→1250;
    - ` 7 `→700;
    - `€12`→1200;
    - `0,05`→5;
    - `1.234`→123400 (a thousands separator: one separator followed by exactly 3 digits and no other separator means thousands when the integer part is 1–3 digits; document the rule in a comment);
    - `12.345,6`→1234560;
    - `-5`→'invalid' unless `{negative:true}`;
    - `abc`→'invalid';
    - empty→undefined;
    - `1.2.3`→'invalid'.
  - **`formatMoney`:** 123456→`€1,234.56`; -500→`−€5.00`; 0→`€0.00`.
  - **Months:** `addMonths('2026-11', 3)`→`'2027-02'`; `monthsBetween('2026-11','2027-02')`→3.
  - **Schema v4→v5 migration:** keeps data, and the new tables are empty.
  - **`ensureBudgetSetup`:** idempotent; seeds exactly the default categories.
  - **Backups and handovers:** a handover contains no budget tables; a full backup does.
  - **Merge:** an entry edited on two devices merges by last-writer-wins.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run && npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit with the message `Add budget money, types and data layer (schema v5)`.

### Task 2: Month engine: targets, totals, planned items, funds

**Files:** `src/budget/{targets,month,planned,funds}.ts` and their tests.

**Interfaces (Produces):**

```ts
export function effectiveMonth(months: BudgetMonth[], ym: Ym): BudgetMonth;            // inherits from the latest earlier month; current/default if none
export function setPotTarget(months: BudgetMonth[], ym: Ym, pot: PotId, t: { kind: 'pct'|'amount'; value: number }, scope: 'this' | 'fromOn'): BudgetMonth[]; // changed records only
export function setCategoryTarget(months: BudgetMonth[], ym: Ym, categoryId: string, amount: Cents | undefined, scope: 'this'|'fromOn'): BudgetMonth[];
export interface PotSummary { pot: PotId; target: Cents; targetPct: number; spent: Cents; spentPct: number; unused: Cents; planned: Cents }
export interface MonthSummary { ym: Ym; plannedIncome: Cents; actualIncome: Cents; pots: PotSummary[]; targetsPctTotal: number; surplus: Cents;
  categories: { categoryId: string; target?: Cents; spent: Cents; band: 'ok'|'amber'|'red'|'none' }[] }
export function summariseMonth(input: { month: BudgetMonth; entries: BudgetEntry[]; categories: BudgetCategory[]; fundMoves: BudgetFundMove[]; funds: BudgetFund[] }): MonthSummary;
export function plannedItemsFor(ym: Ym, input: { recurring: BudgetRecurring[]; funds: BudgetFund[]; fundMoves: BudgetFundMove[]; existing: BudgetEntry[]; debts: BudgetDebt[]; debtBalances: Record<string, Cents> }):
  { entries: Omit<BudgetEntry, keyof BaseRecord>[]; setAsides: { fundId: string; amount: Cents }[] };   // idempotent: skips ones already created
export function fundStatus(fund: BudgetFund, moves: BudgetFundMove[], ym: Ym): { balance: Cents; dueYm: Ym; monthsLeft: number; setAside: Cents; behind: boolean };
```

**Rules:** base spec §3.2–§3.5 and v2 §3.2 and §3.9.6 are binding. In particular:
- The pot percentage target uses planned income.
- `Targets add up to <n>%` is shown when the total ≠ 100.
- Category bands: amber at ≥ 90% of target, red at > 100%.
- A planned entry counts in `planned`, never in `spent`.
- A bill paid from a fund adds a `paid` fund move. It counts against the pot in its month only beyond what the set-asides already covered.
- A transfer category (savings, emergency, debts) counts toward its pot, as in the workbook.

- [ ] **Step 1: Write failing tests:**
  - **Inheritance:** a `fromOn` edit doesn't override later months that were edited individually; a `this` edit changes one month only.
  - **Pot summary:** percentage and amount targets, overspend, and the surplus.
  - **Bands:** at 89%, 90%, 100% and 101%.
  - **Planned items:** the recurring item is generated once (idempotent); an `endYm` and `untilDebtId` stop it.
  - **Fund set-aside:** months left counts the due month (inclusive); overdue asks for the whole remainder; at or above the amount needs 0; a repeating fund rolls to its next cycle after `paid` and carries the leftover; a bill bigger than the fund empties it and the rest is overspend.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run src/budget`. Expected: PASS.
- [ ] **Step 5:** Commit with the message `Add budget month engine: targets, totals, planned items, funds`.

### Task 3: Balances, debts, net worth

**Files:** `src/budget/{debts,ledger,netWorth}.ts` and their tests.

**Interfaces (Produces):**

```ts
export function amortise(debt: { balance: Cents; yearlyRatePct: number; instalment: Cents; extra?: (ym: Ym) => Cents }, fromYm: Ym, maxMonths = 720):
  { months: { ym: Ym; interest: Cents; principal: Cents; balance: Cents }[]; debtFreeYm?: Ym; totalInterest: Cents };
export type Account = BudgetCorrection['account'];
export function balancesByMonth(input: { entries: BudgetEntry[]; corrections: BudgetCorrection[]; debts: BudgetDebt[]; assets: BudgetAsset[];
  categories: BudgetCategory[]; fundMoves: BudgetFundMove[]; funds: BudgetFund[]; fromYm: Ym; toYm: Ym }): Map<Ym, Record<Account, Cents>>;  // month-end
export function netWorthSeries(balances: Map<Ym, Record<Account, Cents>>, assets: BudgetAsset[]): { ym: Ym; netWorth: Cents; parts: Record<string, Cents> }[];
export function savingsRate(summaries: MonthSummary[]): { ym: Ym; rate: number }[]; // (income − needs − wants) / income; months with 0 income → null
```

**Rules:** v2 §3.9 items 1, 2, 3 and 7 are binding:
- Transfers move money between accounts.
- Debt interest is the yearly rate ÷ 12, rounded per month. The instalment includes interest.
- A correction sets the balance at that month end; later months continue from it.
- An income entry with `soldAssetId` lowers that asset by its amount.
- Sinking funds sit inside the bank.

- [ ] **Step 1: Write failing tests:**
  - **Amortisation:** a 0% loan; a 6% loan checked against a hand-computed 3-month table; an extra payment shortens the loan; a loan that is never paid off has no `debtFreeYm` within 720 months.
  - **A transfer** to investments leaves net worth unchanged.
  - **A correction** overrides the running balance.
  - **A sale of an asset** lowers that asset.
  - **Savings rate:** a month with 0 income gives null.
  - **Sum identity:** for every month, the net worth equals the sum of its parts.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run src/budget`. Expected: PASS.
- [ ] **Step 5:** Commit with the message `Add budget balances, debts and net worth`.

### Task 4: Rotation, forecast, freedom date

**Files:** `src/budget/{rotation,forecast,freedom}.ts` and their tests.

**Interfaces (Produces):**

```ts
export function salaryForMonth(rot: RotationSettings, ym: Ym): { onboardDays: number; daysInMonth: number; amount: Cents; onboard: 'onboard'|'home'|'mixed' };
export function rotationPeriods(rot: RotationSettings, untilYm: Ym): { signOn: string; signOff: string }[];   // entered periods + repeated pattern
export interface ForecastInput { today: string; data: BudgetData /* all tables */; settings: BudgetSettings; overrides?: ScenarioChange[] }
export interface ForecastMonth { ym: Ym; status: 'onboard'|'home'|'mixed'; income: Cents; spending: Cents; bank: Cents; freeToSpend: Cents; investments: Cents; emergency: Cents; debts: Cents; netWorth: Cents }
export interface ForecastResult { months: ForecastMonth[]; lowest?: { ym: Ym; freeToSpend: Cents; status: string }; warnings: { kind: 'belowBuffer'|'negativeBank'; ym: Ym }[];
  debtFree: Record<string, Ym | undefined>; totalInterest: Cents; needsBankStart: boolean }
export function forecast(input: ForecastInput): ForecastResult;
export function freedom(input: { forecast: ForecastResult; yearlySpending: Cents; assumptions: Assumptions; today: string }):
  { number: Cents; ym?: Ym; years?: number; months?: number; todayEuros: (c: Cents, ym: Ym) => Cents };
```

**Rules:** v2 §3.3, §3.4 and §3.9 items 4, 5 and 8 are binding:
- Days are counted inclusively, by ship-time dates.
- Proration: monthly × onboard days ÷ days in month, rounded to cents.
- Paid at home %.
- Paid next month or same month (default same).
- Actual salary entries override the rule.
- The current month blends actual and planned.
- Spending methods: targets, average or fixed, never below zero.
- One-off items.
- **Investments** grow monthly by (1+r)^(1/12), with contributions from planned investment spending.
- **Freedom number** = yearly spending, inflated by (1+i)^years ÷ withdrawal rate. The date is the first month where investments ≥ that number; it is not found within 720 months → undefined.
- Without a bank start, `needsBankStart` is true and there are no months.

- [ ] **Step 1: Write failing tests:**
  - **Proration:** sign-on on 15 Mar in a 31-day month gives 17/31; a leap February; sign-on and sign-off on the same day gives 1 day; a mixed month; paid next month shifts the income.
  - **Rotation pattern:** after the last entered period, 8 on / 4 off is generated correctly across years.
  - **Forecast:** a home month shows bank dropping and a `belowBuffer` warning; an actual salary entry in the current month replaces the rule; no double count in the current month; the targets method never goes negative.
  - **Freedom:** the date with and without inflation; never reached gives undefined.
  - **Property test** (100 random plans with a seeded PRNG): every money field is an integer, and bank(m) = bank(m−1) + income − spending.
  - **Performance:** 60 months × 5 runs in < 100 ms.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run src/budget`. Expected: PASS.
- [ ] **Step 5:** Commit with the message `Add rotation pay rule, cash-flow forecast and freedom date`.

### Task 5: Scenarios and shorthand

**Files:** `src/budget/{scenarios,shorthand}.ts` and their tests.

**Interfaces (Produces):**

```ts
export type ScenarioChange =
  | { kind: 'rotation'; periods?: { signOn: string; signOff: string }[]; patternOn?: number; patternOff?: number }
  | { kind: 'salary'; fromYm: Ym; amount: Cents }
  | { kind: 'oneOff'; ym: Ym; amount: Cents; pot?: PotId; income?: boolean; label: string }
  | { kind: 'extraDebt'; debtId: string; monthly?: Cents; lumpYm?: Ym; lump?: Cents }
  | { kind: 'investment'; fromYm: Ym; monthly: Cents }
  | { kind: 'rates'; yearlyReturnPct?: number; withdrawalRatePct?: number; inflationPct?: number }
  | { kind: 'potTarget'; pot: PotId; fromYm: Ym; amount: Cents };
export interface CompareRow { name: string; debtFree?: Ym; lowest?: { ym: Ym; amount: Cents }; netWorth1y: Cents; netWorth5y: Cents; netWorth10y: Cents; freedom?: Ym; totalInterest: Cents }
export function compareScenarios(base: ForecastInput, scenarios: BudgetScenario[]): CompareRow[];   // base first
export function applyToPlan(data: BudgetData, settings: BudgetSettings, s: BudgetScenario, today: string): { writes: PlanWrite[]; summary: string[] };
export function parseShorthand(text: string, categories: BudgetCategory[]): { amount?: Cents; categoryId?: string; note?: string; ambiguous: boolean };
```

- Scenarios change only the forecast (§3.9.9).
- `applyToPlan` returns writes; the UI performs them after taking a snapshot. Each change maps to its real place as §3.9.9 says.
- **Shorthand:** the first number is the amount. A word is matched to a category name or synonym (diacritics folded like the library's `foldText`; copy that logic into budget, no import from `src/library`). The rest is the note. Two equally good matches give `ambiguous`.

- [ ] **Step 1: Write failing tests:**
  - A "Car €18,000 May 2027" one-off lowers bank from that month.
  - An extra debt payment brings the debt-free date earlier and lowers total interest.
  - `compareScenarios` puts the base first.
  - `applyToPlan` maps each change kind and lists its summary lines.
  - **Shorthand:**
    - `12.5 groceries lidl` → 1250, Groceries, note "lidl";
    - `fuel 60` → 6000, Fuel;
    - `kafa 3,20` with a synonym;
    - an ambiguous word;
    - no number.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run src/budget`. Expected: PASS.
- [ ] **Step 5:** Commit with the message `Add budget scenarios and typed shorthand`.

### Task 6: Quick add, month view, Home entry points

**Files:**
- `src/ui/screens/budget/{index.ts,QuickAdd.tsx,CatchUp.tsx,MonthView.tsx,budget.css}`;
- the routes (`/budget`, `/budget/add`, `/budget/month/:ym`, and the rest as placeholders to be filled by Task 7);
- `Home.tsx`: the Budget card and the "+ Expense" button;
- `vite.config.ts`: manifest `shortcuts`;
- `e2e/budget.spec.ts`.

**Behaviour** (v2 §3.6 and base §3.4):
- **Quick add:**
  - the amount pad, with big keys and a comma or dot key;
  - then a category grid with the top 6 by use in the last 30 days first;
  - date chips: Today, Yesterday, 2 days ago, Pick;
  - an optional note;
  - Save.
- **More entry options:**
  - "Repeat last";
  - favourite chips;
  - a shorthand line.
- **Save:**
  - The Save button is disabled while saving, so a double tap writes one entry.
  - An Undo toast stays for 5 s and removes exactly that entry.
  - First use runs `ensureBudgetSetup`.
- **Catch up:** a list of quick rows that stays on the pad after each Save.
- **Month view:**
  - pot cards with target, spent, unused and the % of income;
  - categories with bands;
  - entries, editable and deletable;
  - **To confirm**: planned recurring items and fund set-asides, each with Confirm or Edit amount;
  - notes;
  - the surplus;
  - the `Targets add up…` warning.
- **Planned items:** opening the month generates them idempotently via `plannedItemsFor`.

- [ ] **Step 1: Write failing e2e tests:**
  - Add an expense in 3 taps (amount, category, Save); it appears in the month; Undo removes it.
  - A fast double tap writes one entry.
  - Shorthand `fuel 60` saves 60.00 to Fuel.
  - Catch up adds 3 entries in a row.
  - A recurring item to confirm, then confirmed, moves from planned to spent.
  - Works offline after a reload.
  - No horizontal scroll at 360 px.
  - With the app lock on, the budget is behind the lock.
- [ ] **Step 2:** Run `npx playwright test e2e/budget.spec.ts --trace off`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx playwright test e2e/budget.spec.ts --trace off && npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit with the message `Add budget quick add, catch-up, month view and Home entry`.

### Task 7: Plan screens and starting balances

**Files:** `src/ui/screens/budget/{Plan.tsx,PlanTargets.tsx,PlanCategories.tsx,PlanRecurring.tsx,PlanFunds.tsx,PlanDebts.tsx,PlanGoals.tsx,PlanAssets.tsx,PlanRotation.tsx,PlanAssumptions.tsx,StartBalances.tsx}`, plus e2e.

**Behaviour:**
- **Targets:** percentage or amount, with "This month only" or "From this month on".
- **Categories:** add, rename, hide, reorder, move pot, and synonyms.
- **Recurring templates.**
- **Sinking funds**, with their status.
- **Debts:** balance, rate, instalment and extra, with the debt-free date and the "With an extra €X…" line.
- **Goals:** the suggested monthly amount.
- **Assets.**
- **Rotation:**
  - periods;
  - pattern;
  - salary from a month;
  - paid in;
  - paid at home %;
  - "Use my contract from ‹ship›": pick "me" from crew lists, copying sign-on and contract months; "Update from contract" when they differ.
- **Assumptions:** return, withdrawal and inflation (empty until entered), the buffer, the emergency months and the horizon, each labelled with the exact copy where required.
- **Starting balances** (first run and on demand): writes corrections at the chosen start month.
- **Every save** goes through `db/budget.ts`, and the target scope choice is a dialog.

- [ ] **Step 1: Write failing e2e tests:**
  - Change a pot target "From this month on", and check next month inherits it while an individually edited month doesn't.
  - Add a yearly fund, and see its set-aside to confirm in the month view.
  - Add a debt at 6% and see its debt-free month.
  - Set the rotation from a crew record marked as me.
  - Starting balances, then the bank shows on the dashboard.
  - 360 px.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with the message `Add budget plan screens and starting balances`.

### Task 8: Dashboard, forecast, net worth, scenarios, trends, charts

**Files:** `src/ui/screens/budget/{Dashboard,Forecast,NetWorth,Scenarios,Trends}.tsx` and `charts/*`, plus e2e.

**Behaviour** (v2 §3.3, §3.4, §3.5, §3.7; base §3.8):
- **Charts:**
  - Hand-made SVG: line (multi-series, shaded home months), bar (plan vs actual) and ring.
  - Each has an accessible name, a "Show as table" toggle rendering `ChartTable`, the theme tokens, and black-on-white print.
- **Dashboard:**
  - this month's pots;
  - bank and free to spend;
  - the next 3 forecast months with home months marked;
  - funds due within 60 days;
  - warnings;
  - one line with net worth and the freedom date.
- **Forecast:**
  - the horizon picker;
  - a month table: onboard or home, income, spending, bank, free to spend;
  - a chart;
  - a "Lowest: €X in ‹month› (home)" line;
  - warnings;
  - an Assumptions panel with Edit links;
  - "Enter your bank balance to see the forecast" when there is no start.
- **Net worth:**
  - a history chart and table;
  - the savings rate;
  - the freedom number and date, in nominal and today's euros;
  - the exact disclaimer.
- **Scenarios:**
  - a list, up to 5;
  - an editor for each change kind;
  - a compare table of base plus up to 3, with a chart;
  - "Apply to plan", which lists the changes, confirms, takes a snapshot, then writes.
- **Trends:** per pot and per chosen category across months; income planned vs received; balances over time.
- **Home alerts** for personal budget warnings: a pot or category over target, a fund due within 30 days, a goal behind, items to confirm, and targets not adding up to 100%. They are shown on this device's Home only and never printed. The hook stays tiny: Home lazily imports the alert computation, and only a count and short lines render.

- [ ] **Step 1: Write failing e2e tests:**
  - With a rotation that has 4 home months, the forecast shows a `belowBuffer` warning for a home month and "Lowest: …".
  - Create a scenario with a car one-off; the compare table shows a lower "lowest" and a later freedom date; Apply to plan creates a planned entry in that month.
  - Net worth after a correction.
  - "Show as table" for each chart.
  - A Home alert for a fund due within 30 days.
  - 360 px across all budget screens.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with the message `Add budget dashboard, forecast, net worth, scenarios and trends`.

### Task 9: Excel import and export

**Files:** `src/budget/excel/{import,export}.ts` and their tests; `src/ui/screens/budget/{ImportBudget,ExportBudget}.tsx`; `e2e/fixtures/makeBudgetXlsx.ts`; e2e.

**Behaviour:** base spec §3.9 is binding:
- **Sheets:** one per month, named `<Month> <YYYY>`, with Serbian or English month names.
- **Detection** is by label (the POTREBE, INVESTICIJE, ŽELJE, DUGOVANJA and CRNI FOND rows in column A with amounts in C, and so on), not by fixed rows.
- **Mapping review:** a label matches a category by name or synonym; an unknown label offers a new category or "map to…".
- **Preview:** the months, the totals per pot, and the differences from the sheet's own totals.
- **Import:**
  - A snapshot is taken before it.
  - Re-import replaces only entries with the same `importKey`.
  - STANJA gives the balances.
  - The bank balance is asked for (§3.9.3).
- **Export:** a month, range or year to `.xlsx`, one sheet per month in a similar layout plus a summary sheet, offered through `src/backup/share.ts`.
- The **made-up** fixture builder writes the real layout with fake numbers and labels.

- [ ] **Step 1: Write failing tests:**
  - **Unit:** detection on a fixture with row counts that differ between sheets; Serbian month names; a group heading row with a label and no amount; the totals; re-import replacing only imported entries; export → import round trip.
  - **E2E:** import a 3-month fixture, review the mapping, import, and check the month totals match; then export.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run src/budget && npx playwright test e2e/budget.spec.ts --trace off`. Expected: PASS.
- [ ] **Step 5:** Commit with the message `Add budget Excel import and export`.

### Task 10: README, verification, local acceptance

- [ ] Add a README "Budget" section covering quick add, plan, forecast, net worth, scenarios, and import and export.
- [ ] Run `npm run typecheck && npx vitest run && npx playwright test --trace off && npm run build`. Expected: all pass, apart from the known flaky crew-import flash test. Re-run it if it fails.
- [ ] Measure the startup gzip bytes against `main`. Expected: ≤ +1.5 kB.
- [ ] **Local acceptance, never committed:** import the user's real `BUDZETIRANJE.xlsx` from the uploads folder in a scratch Playwright run against the preview build. Record per sheet the app's pot totals against the sheet's totals in the scratchpad. Report the differences, with no figures in the repo.
- [ ] Commit with the message `Budget: README and verification`.

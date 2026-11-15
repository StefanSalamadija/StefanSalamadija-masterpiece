# Masterpiece — Budget Tracker v2 (Piece 5) Design

Date: 2026-11-15
Status: draft for user review.
Base: `2026-10-25-masterpiece-budget-design.md` (approved). **Everything in it still applies** unless this document changes it. This document adds the user's four upgrades and faster entry, and fixes the parts the base left open.

> Privacy: this public document describes structure only. It never includes the user's figures, names or notes. Tests use made-up budgets; the real workbook is used only locally for acceptance.

## 1. Intent

The user is a Chief Officer on an 8-on/4-off rotation, paid while onboard and unpaid at home. Today they budget in a monthly Excel workbook (BUDZETIRANJE). Entering expenses is slow, and the workbook only looks backwards.

The tracker replaces the workbook and does what it can't:
- entry in seconds on the phone;
- the bank balance forecast through the coming rotations;
- net worth and the date the user could stop depending on salary;
- side-by-side "what if" plans.

All of it works offline, for one person, in EUR.

**Success:**
1. The whole workbook is imported once, and Excel is no longer used.
2. A typical expense takes three taps and about 5 seconds.
3. The user can see, months ahead, whether the bank balance survives the next home leave.
4. Big decisions are compared in numbers before they are made: a longer contract, a car, an extra loan payment.

**Anti-goals** (failure even if it works):
- a forecast that looks precise but rests on hidden assumptions, so every assumption is visible and editable on the screen that uses it;
- anything presented as financial advice;
- a wrong total from rounding: money is held in integer cents;
- budget data leaking into ship files or handovers.

## 2. Decisions (user, 2026-11-15)

- **Scope:** all four upgrades plus the base design, built in one piece.
  - Rotation cash-flow forecast.
  - Scenarios ("what if").
  - Net worth and freedom date.
  - Yearly bills and sinking funds.
- **EUR only**, as agreed.
- **One person**, with phone and laptop synced through backups as for the rest of the app.
- **Main pain:** entering expenses is slow.

## 3. Additions to the base design

### 3.1 Money and the bank balance

- **Amounts:** integer **cents** everywhere. Display is `€1,234.56`. Input accepts `1234,56`, `1.234,56` and `1234.56`. When both `.` and `,` appear, the last one is the decimal separator.
- **Accounts:** one **Bank & cash** account. This is new; the base tracked only investments, the emergency fund and debts.
  - Income entries raise it.
  - Every expense lowers it, including contributions to investments, the emergency fund and debts.
  - Pot contributions also raise the investments or emergency fund balance, or lower the debt balance. Corrections work as in the base design (§3.6).
- **Free to spend** = bank balance − the balances of all sinking funds (§3.2), because sinking-fund money is earmarked inside the bank.

### 3.2 Yearly bills and sinking funds

- **A sinking fund** has:
  - a name;
  - an amount;
  - a due date, either a month and year, or **repeating yearly** (or every N months);
  - an optional category, which the bill is booked to when it is paid;
  - an optional start balance.
  - Examples: car registration in March, home insurance, property tax, a holiday, Christmas.
- **The monthly set-aside** is (amount − balance) ÷ the number of months left until it is due. Each month the set-aside is a **planned item** that the user confirms, as with recurring payments. A set-aside moves no bank money; it only raises the fund's balance, which is earmarked.
- **Paying the bill:** a normal expense in its category, marked "from fund ‹name›". It lowers the bank and the fund. If the fund was short, the shortfall shows as overspend in that month.
- **Reminders:** a Home alert 30 days before the due date, and on the due date. A fund behind plan turns amber.
- **Budget view:** set-asides count against the pot of the fund's category. Bills paid from a fund don't count twice against the pot in the month they're paid.

### 3.3 Rotation and cash-flow forecast

**Rotation settings**, entered once and editable, live under Budget → Plan → Rotation:
- **Monthly net salary onboard:** an amount, editable from a chosen month on.
- **Schedule:**
  - The user enters periods, each with a sign-on date and a sign-off date. Past and planned periods can be entered.
  - **Pattern for later:** the default is 8 months on and 4 months off. After the last entered period, the pattern repeats up to the forecast horizon.
  - **Prefill:** "Use my contract from ‹ship›" copies the sign-on date and contract months from the user's own crew record, if one exists. The user marks which crew member is "me" in Budget settings. Changing the crew record later never changes the budget silently: the screen offers "Update from contract".
- **Pay rule:** salary for a calendar month = monthly salary × (days onboard in that month ÷ days in that month), rounded to cents. There is an optional **"paid at home" %**, default 0, for leave pay.
- **Paid in:** the same month or the next month (default: next). This sets the month a salary lands in the bank.

**Forecast** (Budget → Forecast), for each month from the current one to the horizon (default 24 months; choices 12, 24, 36 or 60):
- **Income** = forecast salary + any other planned income entries.
- **Spending:**
  - recurring templates;
  - sinking-fund set-asides, which are earmarked, plus bills due, which leave the bank;
  - everything else, by a method the user chooses per pot:
    - **targets** (default for Needs and Wants): the pot's or category's monthly targets, minus the parts already covered by recurring templates and funds;
    - **average**: the average of the last 6 tracked months, excluding one-offs the user marked as one-off;
    - **fixed**: an amount per month.
  - Planned one-off purchases (§3.5) also count.
- **Bank balance** = last month's balance + income − spending. The starting point is the latest correction or the computed balance.
- **Free to spend** = bank balance − fund balances.
- **Output:**
  - a month-by-month table: month, onboard or home, income, spending, bank, free to spend;
  - a line chart of bank balance and free to spend, with home months shaded;
  - **the lowest point**, as "Lowest: €X in ‹month› (home)";
  - **warnings:**
    - "Free to spend drops below €‹buffer› in ‹month›", where the buffer is editable and defaults to 1 month of Needs;
    - "Bank goes negative in ‹month›".
- **The current month** blends actual figures to date with planned figures for the rest of the month.
- **Every assumption is shown** in an "Assumptions" panel on the same screen, with Edit links:
  - salary, pay rule, pattern and horizon;
  - the spending method per pot;
  - the expected return (§3.4).

### 3.4 Net worth and freedom date

- **Net worth** = bank & cash + investments + emergency fund + sinking funds' earmarked money (already inside bank, not counted twice) + **other assets** − debts.
  - **Other assets** are user-entered items such as a flat or a car, each with a value and corrections. Including them in net worth is optional per item.
- **History:** net worth at each month end, from tracked data and corrections, shown as a chart and a table.
- **Savings rate** per month and per 12 months = (income − spending on Needs and Wants) ÷ income. Debt repayment and investment count as saving.
- **Freedom date:**
  - **Yearly spending** is either the average Needs + Wants of the last 12 tracked months, or a fixed amount the user enters.
  - **Freedom number** = yearly spending ÷ withdrawal rate. The withdrawal rate is editable, default 4%, and labelled "an assumption, not advice".
  - **Freedom date** is the first forecast month where projected investments reach the freedom number. Investments are projected monthly as balance × (1 + r)^(1/12), where r is the yearly return the user enters (no default; the user must enter one, and 0% is allowed), plus planned contributions.
  - Shown as "At this plan: ‹Month YYYY› (in N years M months)". If it is never reached within 60 years: "Not within 60 years at this plan."
- Every figure carries the label "Projection — not a forecast or financial advice."

### 3.5 Scenarios ("what if")

- **A scenario** is a named set of changes on top of the base plan. The base plan itself is never changed. Up to 5 scenarios can be saved.
- **Changes available:**
  - rotation: a longer or shorter contract, a different pattern, a different start date;
  - salary from a month on;
  - **one-off purchases or income**, each with a month, an amount and a pot, e.g. "Car €18,000 in May 2027";
  - an extra debt payment per month, or a lump sum in a month;
  - investment contribution from a month on;
  - expected return and withdrawal rate;
  - a pot target change from a month on.
- **Compare:** the base and up to 3 scenarios side by side:
  - debt-free date;
  - lowest bank month and amount;
  - net worth in 1, 5 and 10 years;
  - freedom date;
  - total interest paid;
  - a line chart of net worth and bank balance for each.
- **Apply to plan:** copies a scenario's changes into the base plan, after a confirmation that lists them. A snapshot is taken first.

### 3.6 Faster entry (the main pain)

- **Quick add:**
  - A **"+ Expense"** button sits on Home and on every Budget screen. A shortcut on the installed app's icon (PWA manifest `shortcuts`) opens straight to it.
  - The screen is a full-screen amount pad, then a category grid with the 6 most used in the last 30 days first, then Save. A note is optional.
  - The date defaults to today in ship's time. A row of chips offers Yesterday, 2 days ago, or Pick date.
- **Repeat:** "Same as last time" on each recent entry fills the amount and category; "Repeat last" sits on the pad.
- **Templates:** favourite expenses ("Coffee €2.50", "Fuel"), saved with one tap from any entry and shown as chips above the pad.
- **Typed shorthand:** an optional text line, e.g. `12.5 groceries lidl` or `fuel 60`. The first number is the amount, a word is matched to a category name or synonym, and the rest becomes the note. Unclear matches fall back to the category grid.
- **Speed target:** a typical entry in 3 taps, saved in under 50 ms locally, and works offline. An Undo toast stays up for 5 s.
- **Batch catch-up:** after days without entering (common onboard), the "Catch up" list adds several entries in a row without leaving the pad.

### 3.7 Screens

The Budget tab is lazy-loaded. Its routes:
- `/budget`: **Dashboard.**
  - The month's pots, as rings or bars against target, with free to spend and bank.
  - The next 3 months from the forecast, with home months marked.
  - Funds due soon.
  - Warnings.
  - Net worth and the freedom date in one line.
- `/budget/month/:ym`: **Month.** Pots, categories, entries, planned items to confirm, notes, and the totals and surplus.
- `/budget/add`: **Quick add** (§3.6).
- `/budget/forecast`: **Forecast** (§3.3).
- `/budget/net-worth`: **Net worth and freedom** (§3.4).
- `/budget/scenarios`, `/budget/scenarios/:id`: **Scenarios** (§3.5).
- `/budget/plan`: **Plan.** Pot targets, categories, recurring templates, sinking funds, debts, savings goals, emergency fund target, rotation, assumptions and other assets.
- `/budget/trends`: **Trends** (base §3.8).
- `/budget/import`, `/budget/export`: **Excel** (base §3.9).

**Navigation:** the bottom nav's "Profiles" item stays as it is. Budget is reached from a Home card and the quick-add button, and it gets its own top tabs: Dashboard, Month, Forecast, Net worth, Scenarios, Plan.

**Charts** are hand-made SVG with no chart library, following the app's three themes. They have accessible labels and a table view of every chart. They print black on white.

### 3.8 Data and storage

- **Personal-scope syncable tables:** `budgetMonths`, `budgetCategories`, `budgetEntries`, `budgetRecurring`, `budgetFunds`, `budgetGoals`, `budgetDebts`, `budgetAssets`, `budgetCorrections`, `budgetScenarios`, and `budgetSettings`, which holds the rotation, assumptions, "me" crew link, favourites and buffer.
- **Syncing:** these go in full backups and snapshots. They **never** go in handovers, and no ship printout shows them. The App lock covers them, as for all data.
- **Derived figures** (balances, forecast, net worth) are computed, never stored, except the user's corrections.
- **Schema:** the next Dexie version, with a snapshot in the upgrade.

## 4. Approaches

- **One piece, as the user chose:** one design and one plan.
  - The plan is ordered so that a working core comes first: data, entry, month view and import.
  - The intelligence layer comes on top: funds, rotation forecast, net worth, scenarios and charts.
  - Everything ships together.
- **Alternatives:**
  - Two stages, which the user declined.
  - Forecasts first, rejected because a forecast without tracked data rests on guesses.

## 5. Constraints

- The base-app global constraints apply.
- **No new dependencies.** Charts are SVG by hand. Excel uses the existing SheetJS.
- **Main chunk:** the Budget code is lazy-loaded. Only the Home card, the "+ Expense" button, the routes and the alert hook may enter the main chunk, and the main gzip may grow by at most 1.5 kB.
- **Calculations** are pure functions in `src/budget/` with no I/O, fully unit-tested, with every money value in integer cents.
- **Forecast speed:** 60 months with 4 scenarios recomputes in under 100 ms on a mid-range phone, so the user sees results while editing.

## 6. Testing

- **Unit tests** cover:
  - money parsing, rounding and formatting;
  - pot and category totals;
  - the target "this month only" and "from this month on" rules;
  - recurring and fund set-aside generation;
  - the fund rules for paying bills;
  - the pay rule with partial months and the paid-next-month option;
  - forecast balances, including the lowest point and warnings;
  - debt payoff with and without interest;
  - the net worth history;
  - the savings rate;
  - the freedom date, including the never-reached case;
  - scenario application, comparison and "Apply to plan";
  - typed-shorthand parsing;
  - the Excel import of a **made-up** workbook built in the tests with the real layout's labels, plus export round trips.
- **End-to-end tests** cover:
  - quick add in 3 taps, then Undo;
  - catch-up entry;
  - confirming a recurring item and a fund set-aside;
  - paying a bill from a fund;
  - a forecast warning for a home month;
  - creating, comparing and applying a scenario;
  - net worth after a correction;
  - import and export;
  - offline use;
  - no horizontal scroll at 360 px;
  - the app lock covering the budget.
- **Acceptance:** the user's real BUDZETIRANJE.xlsx is imported **locally only**, never committed. Its sheet totals are compared with the app's.

## 7. Left to the builder

- The exact visual layout of the dashboard and charts, within the theme tokens.
- The category synonym list for shorthand and import.
- The order of tabs on small screens.

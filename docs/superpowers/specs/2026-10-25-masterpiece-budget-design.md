# Masterpiece — Personal Budget Planner — Design Spec

Date: 2026-10-25
Status: Approved design (user). It is built as part of the **Finance and converters** piece, the last on the roadmap. It gets its own implementation plan when that piece starts.

> Privacy: this public document describes only the *structure* of the user's existing workbook. It never includes the user's figures, names or notes.

## 1. Purpose

- Replace the user's monthly Excel budget workbook with a planner inside Masterpiece that works offline on the phone and the laptop.
- Keep the user's method: **five pots with target percentages**, planned against an **average 8/4 rotation income**.
- Add easy entry, recurring payments, editable targets and goals, projections, charts and warnings.

**Success:**
- The user imports the whole existing workbook once and stops using Excel.
- They enter expenses in seconds on the phone.
- They adjust targets and goals at any time, and they see at a glance whether each pot and category is on track, when the debts will be paid off and how the savings grow.

## 2. Decisions (user)

| Topic | Decision |
|---|---|
| Currency | EUR (€) only; amounts with 2 decimals |
| When | Built with the Finance piece (last on the roadmap) |
| Income | Plan each month on the 8/4 **average**; also record **actually received** pay, so months at home without salary are visible |
| Features | Quick entry and recurring payments; debt and savings projections; charts and warnings; Excel import and export |
| Editing | Every target and goal is editable: pot targets, per-category monthly targets, savings goals, emergency fund target, debt items |
| Language | English UI. The user's own category names and notes are kept exactly as entered (Serbian/Croatian text allowed) |
| Interim Excel | Not wanted; the user keeps the current workbook until the app planner ships |

## 3. Concepts

### 3.1 Months

- A **month** (`YYYY-MM`) holds two income figures:
  - **planned income**: by default the user's average monthly 8/4 income, editable per month and "from this month on";
  - **actual income received**: the sum of income entries.
- Other income sources are recorded as income entries: sale of property, other sales, other jobs.
- Future months exist as **plans**; past and current months are **tracked**.

### 3.2 Five pots, with editable targets

Each month has five pots:

1. Needs
2. Savings & investments
3. Wants
4. Debts
5. Emergency fund

**Targets**
- Each pot has a target as a **% of planned income** or a **fixed amount**; the user chooses either and the other is shown.
- The five must total **100%**. Otherwise the month shows `Targets add up to <n>% — adjust to 100%.`, and saving is still allowed.

**Editing a target** asks:
- **This month only**, or
- **From this month on**, which updates this and every later month that still uses the same "inherited" value; months already individually edited are left alone.

This is how the plan changes over the years, for example when a loan is paid off and its share moves to investments.

**For each pot the month shows:**
- target;
- actual spent;
- actual % of planned income;
- **unused** (target − spent, negative = overspent);
- the month's **total surplus or overspend** (sum of unused).

### 3.3 Categories, editable, with optional monthly targets

- Categories belong to a pot. Each can have an **optional monthly target**, edited with the same "this month only / from this month on" choice.
- Progress shows per category: amber at **90%** of its target, red when over.
- **Editable category list:** add, rename, hide (kept for history), reorder, move to another pot. Sub-categories are one level deep (a group heading and its items).

**Default list:**

| Pot | Group | Categories |
|---|---|---|
| Needs | Housing | Rent / mortgage; Utilities & bills; Phone & internet; Home insurance; Property tax; Maintenance; Repairs |
| Needs | Food | Groceries, food & drink |
| Needs | Health | Pharmacy; Doctors & dentist |
| Needs | Car & transport | Fuel & parking; Regular service; Car repairs; Registration & insurance; Public transport & taxi |
| Needs | Family | Kindergarten / school; Children's needs |
| Needs | Pets | Pet food & vet (renameable, e.g. the pet's name) |
| Needs | Personal | Haircut & personal care; Clothing & shoes; Training / gym |
| Needs | Other | Other needs; Unallocated |
| Wants | — | Cafés & restaurants; Travel – flights; Travel – accommodation; Travel – eSIM & extras; Subscriptions; Shopping; Gifts & celebrations; Beauty & wellness; Books, toys & hobbies; Entertainment & outings; Other wants |
| Savings & investments | — | Index funds / ETFs (e.g. S&P 500); Other investments; Pension; Savings goals |
| Emergency fund | — | Emergency fund |
| Debts | — | Loan instalment; Extra loan payment; Personal debts; Credit card |

### 3.4 Entries

- **Expense entry:**
  - date (default: today, ship's time);
  - amount;
  - category;
  - optional note;
  - optional payee or description (for "Wants" lines such as a specific trip).
- **Income entry:** date, amount, source (Salary, Sale of property, Other sales, Other jobs, Other), note.
- **Quick entry:**
  - The phone shows a large amount pad, then a category picker with recent categories first, then a note, then Save. That's three taps for a typical expense.
  - The last-used category is preselected.

### 3.5 Recurring payments

- **Template:** name, amount, category (or income source), day of month, start month and optional end month (or "until the debt is paid").
  - Examples: loan instalment, monthly index-fund purchase, streaming subscription.
- On the first app open in a new month, each due template creates a **planned entry** marked *To confirm*.
  - Tapping confirms it, or lets you edit the amount first. Unconfirmed planned entries count towards "planned", not "actual".
- Templates are editable. Changing one affects future months only.

### 3.6 Balances

Balances are tracked at month end:

- **Investments**, **Emergency fund** and **each debt**.
- **Contributions** come from entries in those pots, and **debt repayments** reduce the debt balance.
- At any month end the user can enter a **correction**, such as the actual market value of investments or the bank's loan statement. The correction is kept as an adjustment, so later months start from it.

### 3.7 Goals and projections (all editable)

- **Savings goals:** name, target amount, target month, linked category.
  - Shows saved so far, progress %, and the **suggested monthly amount** = remaining ÷ months left.
  - Turns amber when the plan won't make it.
- **Emergency fund target:** a fixed amount, or **N × average monthly Needs spending** (default N = 6; the average uses the last 6 tracked months).
  - Shows the balance, progress and the month the target will be reached at the current contribution.
- **Debts:** for each debt, the balance, instalment, optional interest rate (% per year, default 0 if unknown) and planned extra payments.
  - Shows the **debt-free month**, total interest if a rate is given, and *"With an extra €X/month you'd be debt-free in <month> (<n> months sooner)"* with an editable X.
- **Investment projection:**
  - Uses the user's **own assumed yearly return** (editable; no built-in assumption is presented as advice) and the planned monthly contributions.
  - Shows the projected balance at chosen horizons (1, 3, 5, 10 years).
  - Clearly labelled *"Projection — not a forecast or financial advice."*

### 3.8 Charts and warnings

- **Month view:** plan vs actual per pot (bars), and category progress bars.
- **Trends:** spending per pot and per chosen category across months, income planned vs received, and balances (investments, emergency fund, debts) over time.
- **Warnings:**
  - a pot or category over target;
  - a savings goal behind plan;
  - recurring payments waiting to be confirmed;
  - targets not adding up to 100%.
- They appear in the planner and as Home alerts (personal alerts are shown only on this device's Home, never in ship printouts).
- Charts follow the app themes (Day / Night / High contrast) and print black on white.

### 3.9 Excel import (one time, re-runnable) and export

**Import of the user's existing workbook layout.** Each month is a sheet named `<Month> <YYYY>`; Serbian and English month names are accepted (Jun, Jul, Avgust, Septembar, Oktobar, Novembar/November, Decembar, Januar, Februar, Mart, April, Maj).

Detection is by labels, not fixed rows, because row counts vary between sheets.

| Area | How it is found |
|---|---|
| **Pot targets** | Rows labelled POTREBE, INVESTICIJE, ŽELJE, DUGOVANJA, CRNI FOND in column A, with amounts in column C, give the five pots' amounts. The % comes from planned income. |
| **Income** | The block under PRIMANJA (column A labels, column C amounts). The first line is the planned average income; the others are additional income sources. |
| **Needs** | Under the POTREBE header in column E (labels) and G (amounts). Rows with a label but no amount (for example "Stan", "AUTO", "DRUGO") are group headings. |
| **Savings & investments** | Under ŠTEDNJE I INVESTICIJE, columns I/K: the index-fund line plus the CRNI FOND line, which goes to the Emergency fund. |
| **Wants** | Under ŽELJE, columns M/O: free-text lines, imported as expenses with their text as the note, mapped to a Wants category. |
| **Debts** | Under DUGOVANJA, columns Q/S: instalment, extra payments, personal debts. |
| **Balances** | A STANJA block (found anywhere in columns W–Z) with INVESTICIJE, DUGOVANJA and CRNI FOND gives the month-end balances or corrections. |
| **Notes** | The row below each "Komentari i napomene" heading, per column group, gives the month notes. |

How the import works:
- Values are read as values; formulas are ignored, since totals are recalculated by the app.
- A **mapping review** follows, like the crew import. Each source label is matched to a category by name, with synonyms, and unknown labels are offered as *new category* or *map to…*.
- The preview shows months, totals per pot, and differences from the sheet's own totals.
- A snapshot is taken before importing. Re-importing a month replaces that month's imported entries, never ones added in the app.

**Export:** any month, range or year to `.xlsx`, with one sheet per month in a similar layout plus a summary sheet. The file is shared or downloaded like other exports.

### 3.10 Privacy and storage

- All budget records are **personal scope**:
  - included in full backups (encrypted);
  - **never** in ship handover files;
  - covered by the app lock.
- They are not tied to a ship profile; a user changing ships keeps the budget.

## 4. Out of scope

- Bank or card connections, automatic transaction download, OCR of receipts, and multi-currency (EUR only by decision).
- Investment price feeds; the market value is entered by the user.
- Tax calculations.

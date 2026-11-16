# Draft Survey (Piece 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** draft surveys (initial, interim, final and constant) on the phone or laptop, offline. Results are identical to the company workbook. There is a printable DS Report, and the company workbook can be filled in for the office.

**Architecture:**
- **Calculation:** pure functions in `src/survey/` copy the workbook's sheet formulas and report formulas exactly, including Excel ROUND and VLOOKUP behaviour.
- **Storage:** ship-scope Dexie tables in schema v6, carried in full backups and in handovers.
- **Workbook import and fill:** handled by `src/survey/workbook/`, which reuses the forms engine's package and Excel cell writing.
- **Screens:** one lazy `survey` chunk under Ship → Draft survey.

**Tech Stack:** Preact 11, TypeScript, Dexie 4, SheetJS (existing), fflate and @xmldom/xmldom (existing), Vitest, Playwright 1.63. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-16-masterpiece-draft-survey-design.md`. It is binding, especially §2 (user decisions) and §4.2 (the formulas, including the builder-check findings).

## Global Constraints

- All of `.superpowers/sdd/2026-10-25-masterpiece-base/global-constraints.md` applies. No new dependencies.
- **Confidential.** The company workbook, the hydrostatic table and the real survey figures are never committed, printed in reports or put in tests.
  - Fixtures are made up. `e2e/fixtures/makeSurveyWorkbook.ts` builds a workbook with the real layout's labels and formula shapes, and a made-up HYDRO table.
  - The real file `the real company workbook in the session scratchpad (never in the repo)` may be read locally only, for structure and for the final acceptance comparison.
- **Exactness:**
  - **Excel `ROUND(x, n)`:** half away from zero, computed on decimal strings or with an epsilon guard so that 0.0005-style ties round as Excel does.
  - **VLOOKUP approximate:** the last row whose draft is ≤ y.
  - **Rounding:** every intermediate is rounded exactly where the workbook's formula rounds, and nowhere else.
- **Results:**
  - Cargo is shown positive, as "loaded" or "discharged".
  - Difference = ship's figure − compared quantity, in tonnes and %.
- **LCF source:** a per-ship setting, `'workbook' | 'tabled'`, default `'workbook'`. The other source's first trim correction is shown as a check line until the user confirms which is right.
- **Out of range:** "Outside the ship's hydrostatic table" (exact copy). No result is shown.
- **Main chunk:** survey code only through `lazyScreen`. The main chunk's startup bytes may grow by at most +1.0 kB against `main`; only the route strings and one Ship chip are allowed in it.
- **Scope:** ship scope. Survey tables go in full backups **and** handovers. Snapshot and merge behave as for the other ship tables.

## Review Focus

1. **A draft exactly on a table row, and drafts at the table's first and last usable rows.** Expected: the same look-up as Excel. QM + 0.6 past the end gives the out-of-range message. Pinned in Task 3.
2. **The inserted 16.065 row (an irregular step).** Expected: `VL(x + 0.1)` is a second look-up, which matches the workbook. Pinned in Task 3, with a made-up table that has an irregular row.
3. **Decimal commas and negative trim** (head down, forward draft deeper than aft). Expected: input is read correctly, and the signs follow the workbook. Pinned in Tasks 3 and 4.
4. **Rounding ties** (x.xxx5). Expected: the same result as Excel's ROUND. Pinned in Task 3.
5. **A changed company template**, with a missing label or moved cells. Expected: the fill is refused with a plain message, while the numbers and the report still work. Pinned in Task 5.

---

## File Structure

- **`src/survey/`**, all pure:
  - `excel.ts`: `excelRound`, `vlookupApprox`.
  - `hydro.ts`: table types, the workbook-style look-up and range checks.
  - `calc.ts`: the sheet formulas for INITIAL and FINAL, and the constant, cargo and difference.
  - `report.ts`: the DS Report formulas.
  - Tests sit next to each file.
- **`src/survey/workbook/`:**
  - `read.ts`: detects HYDRO, the particulars, the per-sheet range start rows and the input-cell map.
  - `fill.ts`: writes inputs into the template, sets `fullCalcOnLoad`, and checks the result.
- **Storage:**
  - `src/domain/types.ts`: the types.
  - `src/db/schema.ts`: version 6.
  - `src/db/survey.ts`: reads and writes the survey tables.
  - `src/backup/service.ts`: validators, and handover inclusion.
- **Screens, `src/ui/screens/survey/`:**
  - `index.ts`;
  - `ShipData.tsx`, `Surveys.tsx`, `SurveyForm.tsx`, `Report.tsx`;
  - `survey.css`.
- **Routes and links:**
  - `src/app/router.ts` and `App.tsx`: `/ship/survey`, `/ship/survey/data`, `/ship/survey/:id`, `/ship/survey/:id/report`.
  - `Nav.tsx` `SHIP_LINKS`: a "Draft survey" chip.
- **Tests:** `e2e/survey.spec.ts` and `e2e/fixtures/makeSurveyWorkbook.ts`.

---

### Task 1: Data layer (schema v6)

**Interfaces (Produces):**

```ts
interface HydroRow { draft: number; displacement: number; tpc: number; mtc: number; lcbMid: number; lcfMid: number; lcfTabledMid?: number }
interface SheetRanges { dispTpcMtcFrom: number; lcfFrom: number }   // start drafts (m) per sheet
interface DraftSurveyShip extends BaseRecord { shipId; lbp; dF; dM; dA; beam; keelPlateCorr: number; lightShip; summerDraught?; summerDwt?; depth?; gt?;
  lcfSource: 'workbook' | 'tabled'; ranges: { initial: SheetRanges; final: SheetRanges }; sourceName?: string; importedAt?: string }
interface HydroTable extends BaseRecord { shipId; rows: HydroRow[] }
interface DraftSurvey extends BaseRecord { shipId; kind: 'initial'|'interim'|'final'|'constant'; initialId?: string; operation: 'loading'|'discharging';
  port?; terminal?; cargo?; holds?; date?; timeFrom?; timeTill?; windBft?; swell?; drafts: { fP?: number; fS?: number; mP?: number; mS?: number; aP?: number; aS?: number };
  density?: number; deductibles: { ballast?; freshWater?; vlsfo?; lsmgo?; lubOil?; other? }; comparedQty?: number; blQty?: number; remarks?; surveyor?; chiefOfficer? }
interface SurveyTemplate extends BaseRecord { shipId; fileName; blob-or-base64 per existing ship-scope file convention; cellMap: CellMap }
// src/db/survey.ts: getSurveyShip, saveSurveyShip, getHydro, saveHydro (replace), listSurveys(shipId), saveSurvey, deleteSurvey (soft), getTemplate, saveTemplate
```

- The tables are ship-scope syncable: `draftSurveyShips`, `hydroTables`, `draftSurveys` and `surveyTemplates`, appended last to `TABLE_NAMES`.
- **Template file storage:** follow how forms templates store their file. The workbook is small, about 140 kB, so base64 in the record is acceptable if forms templates do the same.
- **Validators:** finite numbers, sorted hydro rows, and kinds.

- [ ] **Step 1: Write failing tests:**
  - the v5 → v6 migration keeps the data;
  - a handover includes the survey tables for that ship;
  - an old backup without them still imports;
  - the validator refuses unsorted hydro rows and an unknown kind;
  - soft delete.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run && npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit with the message `Add draft survey data layer (schema v6)`.

### Task 2: Workbook import

**Interfaces (Produces):**

```ts
interface ImportedWorkbook { ship: Omit<DraftSurveyShip, keyof BaseRecord | 'shipId'>; hydro: HydroRow[]; cellMap: CellMap; warnings: string[] }
function readSurveyWorkbook(bytes: Uint8Array): ImportedWorkbook | { error: string }
// CellMap: per sheet ('INITIAL' | 'FINAL') the input cell address for every DraftSurvey input + FINAL's own dA/LBP cells, found by labels
```

- **HYDRO:** headers are matched by text: "Draught", "Displ", "TPC", "MTC", "LCB from midship", "LCF from midship", "LCF Tabled", "LCB Tabled".
  - Formula cells are read from their cached values.
  - `lcfTabledMid = LBP/2 − (LCF Tabled)`, using the LBP from INITIAL.
  - **Refused** with a plain message: missing columns, unsorted rows, a gap over 0.1 m, or no rows.
- **Particulars:** labels such as "LBP =", "dF =", "dM =", "dA =", "Beam", "Light Ship Weight", "Summer Draught:" are found by text on INITIAL. The value is the next non-empty cell on that row.
- **Ranges:** parse the `HYDRO!A<n>` start row from the INITIAL and FINAL look-up formulas and map it to the draft in that row.
- **Cell map:** for each input, the cell next to its label, in the column under Forward, Midships or Aft for drafts and in the label's column block otherwise.
  - The map is verified: every required input must be found.
  - Missing ones are listed, and the workbook stays usable for the numbers but cannot be filled.

- [ ] **Step 1: Write failing tests** with `makeSurveyWorkbook()` (a made-up table that includes an irregular row and formula cells):
  - reads all rows, the particulars and the ranges;
  - unsorted, missing-column and gap cases are refused;
  - the cell map is complete;
  - a moved label gives a "can't fill" warning.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run src/survey`. Expected: PASS.
- [ ] **Step 5:** Commit with the message `Read ship data and hydrostatics from the company workbook`.

### Task 3: Calculation engine

**Interfaces (Produces):**

```ts
function excelRound(x: number, digits: number): number
function vlookupApprox(rows: HydroRow[], fromDraft: number, y: number): HydroRow | 'outOfRange'
interface SheetResult { means: {F;M;A}; perp: {F;M;A}; corrected: {F;M;A}; apparentTrim; foreAftMean; meanOfMeans; quarterMean; trim; deflection: { kind: 'HOG'|'SAG'; cm }; list: { side: 'PORT'|'STBD'; deg };
  qmDisplacement; tpc; lcf; mtcPlus; mtcMinus; dMdZ; trimCorr1; trimCorr2; displCorrected; density; gross; deductibles; nett; lcfCheck?: { lcf; trimCorr1 } }
function calcSheet(ship: DraftSurveyShip, hydro: HydroRow[], survey: DraftSurvey, sheet: 'initial' | 'final'): SheetResult | { error: string }
function calcOutcome(initial: SheetResult, final: SheetResult | undefined, ship, survey): { constant?: number; cargo?: number; cargoLabel?: 'loaded'|'discharged'; differenceT?: number; differencePct?: number }
function reportFigures(ship, hydro, initial: DraftSurvey, other?: DraftSurvey): ReportFigures   // DS Report's own formulas
```

- Every step follows spec §4.2, items 1–20. Use the INITIAL ranges for initial and constant surveys, and the FINAL ranges for interim and final surveys.
- **Test values:** expected values for the made-up table are computed by hand, or by an independent Python script in the scratchpad (not committed) that copies Excel's formulas literally. The test then pins the numbers.

- [ ] **Step 1: Write failing tests:**
  - excelRound on ties and negatives;
  - vlookup on an exact row, between rows, below the start and above the end;
  - a full initial sheet on made-up drafts, with every intermediate pinned;
  - head-down trim;
  - the irregular-row case;
  - the constant;
  - loading cargo and discharging cargo, both positive;
  - the difference in tonnes and %;
  - an interim against its initial;
  - the LCF check line with source `'tabled'` against `'workbook'`;
  - the report formulas, which differ from the sheet in rounding order;
  - out of range.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run src/survey`. Expected: PASS.
- [ ] **Step 5:** Commit with the message `Add draft survey calculation matching the company workbook`.

### Task 4: Screens

**Behaviour** (spec §4.3):
- **Ship data:**
  - Import workbook, with a preview of what was found: particulars, the table range and row count, warnings. The user confirms, and it is saved.
  - Edit the particulars, including the LCF source setting with its explanation.
- **Surveys list:** New initial, New interim or final (for an initial survey), New constant check.
- **Survey form:**
  - draft inputs as they are read at the marks, using decimal-comma `parseDecimal`;
  - density;
  - deductibles;
  - the compared quantity;
  - the metadata fields.
- **Live results:**
  - every intermediate line, in the workbook's order;
  - the result in large type;
  - warnings for list, deflection, out of range, and the LCF check line.
- **Routes:** lazy routes, plus the "Draft survey" Ship chip.
- **Layout:** fits 360 px.

- [ ] **Step 1: Write failing e2e tests:**
  - import a made-up workbook and see its particulars;
  - make an initial survey and see the constant;
  - make a final survey and see "Cargo loaded" positive, with the difference;
  - a decimal comma;
  - an out-of-range draft shows the message;
  - offline after a reload;
  - 360 px.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx playwright test e2e/survey.spec.ts --trace off && npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit with the message `Add draft survey screens`.

### Task 5: Report and company-workbook fill

**Behaviour** (spec §4.3 report and §4.4):
- **Report:**
  - The DS Report layout, using the report formulas: initial column, plus final or interim column.
  - Printed with the existing print CSS.
- **Fill:**
  - Write the survey inputs, and FINAL's own dA and LBP from the ship record, into the stored template using the cell map.
    - Initial → INITIAL; final and interim → FINAL; a combined export writes both.
  - Set the workbook's `fullCalcOnLoad`.
  - Reuse the forms engine's package reader and writer (`src/forms`) so that all other parts stay byte-identical. Add a small cell-writer helper if `writeExcel` cannot be used as it is.
  - File name: `Draft_Survey_<Ship>_<YYYY-MM-DD>_<kind>.xlsx`, shared or downloaded through the existing helper.
  - A template whose cell map is incomplete is refused with a plain message.

- [ ] **Step 1: Write failing tests:**
  - **unit:**
    - fill a made-up template, then only the input cells change (compare the parts) and `fullCalcOnLoad` is set;
    - an incomplete map is refused;
  - **e2e:** print the report (its content is visible), then export the filled workbook (the download happens).
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with the message `Add draft survey report and company workbook fill`.

### Task 6: README, verification, local acceptance

- [ ] Add a README "Draft survey" section.
- [ ] Run `npm run typecheck && npx vitest run && npx playwright test --trace off && npm run build`. Expected: all pass.
- [ ] Measure the startup bytes against `main`. Expected: ≤ +1.0 kB.
- [ ] **Local acceptance, never committed:**
  - Import the real workbook in a scratch script.
  - Feed the real INITIAL and FINAL inputs (read from the workbook's input cells) to `calcSheet`, `calcOutcome` and `reportFigures`.
  - Compare every intermediate value with the workbook's cached values (INITIAL I15…Y34, FINAL, and the DS Report). Report equal or not equal per value, **without printing any figures**.
  - Fill the template, and if LibreOffice is available, recalculate it headlessly and compare the cached results.
- [ ] Commit with the message `Draft survey: README and verification`.

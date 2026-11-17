# Masterpiece — Draft Survey (Piece 6) Design

Date: 2026-11-16
Status: approved by the user (2026-11-16). A builder check was done; findings marked *(builder check)*.

> Confidentiality: the company's draft-survey workbook, the ship's hydrostatic table and any real survey figures are used **only locally** for checking. They are never committed or published. Tests use a made-up hydrostatic table and made-up surveys.

## 1. Intent

The Chief Officer runs draft surveys at loading and discharging ports with the company's Excel workbook. The app does the same surveys on the phone or laptop, offline, with **numbers identical to the company workbook**. It also produces:
- the printed report in the workbook's "DS Report" layout;
- the company workbook itself filled in, for the office.

**Success:**
- for a real survey, the app's results equal the workbook's results to the last digit the workbook shows;
- a survey is entered on the phone at the draft marks in a few minutes;
- the office receives their own workbook.

**Anti-goals:**
- any difference from the company sheet that isn't explained;
- a result shown when an input is missing or out of the table's range;
- company or ship data leaving the device other than in the user's encrypted backups or in the files they choose to send.

## 2. User decisions (2026-11-16)

- **Method:** match the company workbook exactly, including its approximations (§4.2).
- **Output:** the numbers on screen, a printable report in the DS Report layout, and the company workbook filled in.
- **Surveys:** Initial and Final (cargo is the difference), interim surveys per hold (like the workbook's "FINAL (2)"), and a constant check.
- **Deductibles:** entered as tonnes per item, as agreed earlier.
- **Interim surveys:** use the **FINAL** sheet's formulas against the linked initial survey. The workbook's "FINAL (2)" sheet has the wrong LBP and dA, and a look-up range that stops at 8.30 m, so it is not copied (user decision). Interims are written into the FINAL layout (§4.4).
- **Cargo is always shown positive**, as loaded or discharged. **Difference = ship's figure − compared quantity**, in tonnes and %. The filled company Excel keeps its own formulas and signs untouched (user decision).
- **LCF needs checking.** The HYDRO sheet's "LCF from midship" column is computed from the column headed "LCB Tabled", and the other way round, so they look swapped.
  - The app keeps both: the workbook's column, and the "true" LCF from the "LCF Tabled" column.
  - A per-ship setting, **LCF source**, decides which one is used. It defaults to **workbook**, so results match the company sheet.
  - The survey screen shows the other value's first trim correction as a check line until the user confirms the right one against the stability booklet (user decision).
- **Data source:** hydrostatics and ship data are imported from the company workbook (the HYDRO sheet and the survey sheets' fixed inputs); no PDF is needed.

## 3. Data (ship scope)

All of this belongs to the ship and goes in full backups **and** in handovers, so the relief gets the ship's tables.

- **`draftSurveyShips`**, one per ship:
  - LBP;
  - draft-mark distances from the perpendiculars dF, dM, dA (signed as in the workbook);
  - beam;
  - keel-plate correction (default 0);
  - light ship;
  - summer draught;
  - summer deadweight;
  - depth moulded;
  - GT;
  - the source workbook's name and the import date.
- **`hydroTables`**, one per ship: rows `{ draft, displacement, tpc, mtc, lcbMid, lcfMid }`, exactly as the HYDRO sheet holds them.
  - Distances are from midships, forward negative (the sheet's "LCF (fwd −)").
  - Rows are sorted by draft, with no gaps checked at import.
- **`draftSurveys`:**
  - kind: `initial`, `interim`, `final` or `constant`;
  - links: a final or interim survey links to its initial survey;
  - operation: loading or discharging;
  - port, terminal, cargo, holds;
  - date, time from and time till;
  - weather: wind in Beaufort, swell in metres;
  - six drafts: F, M and A, each port and starboard;
  - dock-water density;
  - deductibles: ballast, fresh water, VLSFO, LSMGO, lub oil, other;
  - B/L quantity, where the workbook has it;
  - remarks;
  - surveyor name;
  - Chief Officer name.
- **`surveyTemplates`**, per ship: the company workbook file as imported (a Blob), plus the detected input-cell map (§4.4).

Schema: the next Dexie version, with a snapshot in the upgrade.

## 4. Design

### 4.1 Import from the company workbook

- **Choosing the file:** Ship → Draft survey → **Import ship data from workbook**, then choose the .xlsx.
- **What it reads:**
  - every HYDRO row;
  - LBP, dF, dM, dA, beam, light ship and the particulars from the INITIAL sheet's labelled cells;
  - the whole file, kept as the template for filling (§4.4).
- **Detection is by labels, not fixed cells.** It looks for "LBP =", "dF =", "dM =", "dA =", "Beam", "Light Ship Weight", "Summer Draught:" and so on, and the HYDRO headers "Draught, Displ, TPC, MTC, LCB from midship, LCF from midship".
- **Preview:** it shows what was found, with the table's draft range and row count. The user confirms; re-importing replaces the table.
- **A broken or unexpected table** is refused with a plain message: a missing column, unsorted drafts, or a gap of more than 0.1 m.

### 4.2 Calculation (exactly the workbook's formulas)

Implemented as pure functions in `src/survey/`. Each step uses the workbook's own formula and rounding (Excel `ROUND`, half away from zero):

1. **Mean drafts:** forward, midships and aft, each (port + starboard) ÷ 2.
2. **Apparent trim** = aft mean − forward mean.
3. **Perpendicular correction** for each mark: `ROUND(dX × apparentTrim / LBP, 4)`.
   - The workbook divides by the LBP, not by the distance between the marks, and the app keeps that.
4. **Corrected drafts** = mean + keel-plate correction + perpendicular correction.
5. **Fore-to-aft mean** = (F + A) ÷ 2; **mean of means** = (M + fore-to-aft mean) ÷ 2; **quarter mean** = `ROUND((M + mean of means)/2, 4)`.
6. **Actual trim** = corrected A − corrected F.
7. **Deflection:** HOG or SAG, and |100 × (M − fore-to-aft mean)| cm, rounded to 1 decimal. Shown only.
8. **List** = 57.3 × atan(|Mp − Ms| ÷ beam), with PORT or STBD. Shown only, with no correction.
9. **Table look-up, exactly as the workbook does it** *(builder check)*:
   - `v(x) = ROUND(VL(x) + (VL(x + 0.1) − VL(x)) × (x − VLd(x)) × 10, 3)`.
     - `VL(y)` is Excel `VLOOKUP(y, range, col)` with approximate match: the value at the last row whose draft ≤ y.
     - `VLd` is that row's draft.
     - `VL(x + 0.1)` is a second look-up at x + 0.1. It is **not** "the row 0.1 m above". The table has an inserted row at 16.065, so the two differ there.
   - For MTC at QM ± 0.5, the look-ups are at QM ± 0.5 and QM ± 0.6, but the fraction is `(QM − VLd(QM))` **taken at QM**, as the workbook does.
   - **The range start row is per sheet:**
     - INITIAL: displacement, TPC and MTC start at row 17 (1.75 m); LCF starts at row 2 (1.00 m).
     - FINAL (also used for interims): every look-up starts at row 37 (2.75 m).
     - The import stores these start drafts per sheet.
   - **Out of range:** a look-up below the start row, or a needed y above the last row, gives the out-of-range message. Excel would quietly return the last row; the app refuses instead.
10. **First trim correction** = `ROUND(trim × TPC × LCF × 100 / LBP, 3)`.
11. **dM/dZ** = MTC(QM + 0.5) − MTC(QM − 0.5). **Second trim correction** = `ROUND(trim² × dM/dZ × 50 / LBP, 3)`.
12. **Displacement corrected for trim** = QM displacement + first trim correction + second trim correction.
13. **Gross displacement** = `ROUND(corrected × density / 1.025, 3)`.
14. **Nett displacement** = gross − the sum of the deductibles.
15. **Constant**, for an initial survey when loading or a constant check, = nett − light ship. **Cargo + constant** is the same figure for an initial survey when discharging.
16. **Cargo and differences** follow the workbook's FINAL and DS Report formulas:
    - the cargo loaded or discharged;
    - the difference from the B/L in tonnes and in %.
    - Interim surveys use the FINAL formulas against the linked initial survey.
17. **Helper cells** AK11, AN12 and AN13 (INITIAL) and AK12, AN13, AN14 and BG31 (FINAL) feed no result, so they are not built *(builder check)*.
18. **The compared quantity** is FINAL's Y37: "Shore Scale" when loading, "B/L figure" when discharging. FINAL P8 "BL Q-ty" and INITIAL P8 are stored and written back, but used in no calculation, as in the workbook *(builder check)*.
19. **The DS Report computes some figures with its own formulas**, and the report must use them:
    - QM = `ROUND((F + 6M + A)/8, 4)`;
    - first trim correction = `ROUND(LCF × trim × TPC / LBP × 100, 3)`;
    - second trim correction = `ROUND(50 × dMdZ × trim² / LBP, 3)`;
    - deductibles grouped as VLSFO + LSMGO, fresh water, ballast, and lub oil + other.

    The on-screen survey uses the sheet formulas; the printed report uses the report formulas. The two can differ in the last digit, exactly as in the workbook *(builder check)*.
20. **FINAL takes dF, dM, beam and LBP from INITIAL**, but has its own typed dA and LBP *(builder check)*. The app uses the ship record for all of them. On fill, FINAL's own dA and LBP cells are written with the ship record's values, so the workbook agrees.

**Out of range:** a draft whose look-up needs a table row outside the table (including QM ± 0.6 for MTC) gives "Outside the ship's hydrostatic table", and no result is shown.

### 4.3 Screens

These sit under **Ship → Draft survey**, a new Ship chip, and are lazy-loaded:
- **Ship data:** the imported values, which are editable, and the table summary.
- **Surveys:** a list showing kind, port, date and the result; actions to start an Initial survey, or an Interim or Final survey for the last initial survey.
- **Survey screen:**
  - draft inputs laid out as the marks are read: forward, midships and aft, port and starboard;
  - density;
  - the deductibles;
  - every intermediate line in the workbook's order, live as the user types;
  - the result, constant or cargo, in large figures;
  - warnings for list, deflection and out-of-range input.
- **Phone first:** large decimal inputs that read a decimal comma, at 360 px.
- **Report:** **Print / Save PDF** renders the DS Report layout: initial and final columns, drafts data, light ship, LBP, TPC, LCF, trim, MTC ±0.5, deductibles, the result lines and signatures. It uses the existing print styles.

### 4.4 Filling the company workbook

- **What gets written:** the app writes the survey inputs, and nothing else, into the template's input cells:
  - drafts, density and deductibles;
  - port, terminal, cargo, holds, date and time;
  - weather and the B/L quantity;
  - names and remarks.
- **How the cells are found:** the input cells are detected once from the labels when the template is imported, e.g. the cell to the right of "Port" in the Forward column on INITIAL. The map is stored with the template.
- **Untouched:** formulas, styles and every other part of the workbook. Writing reuses the forms engine's Excel writer (`src/forms`, Excel cell writing that leaves other parts byte-identical).
- **Recalculation:** the workbook is set to recalculate fully when opened (`fullCalcOnLoad`), so Excel shows the results.
- **Sheet choice:** initial or constant check → INITIAL, final or interim → FINAL (§2: interims follow the FINAL layout). "FINAL (2)" is never written. A combined Initial + Final export writes both sheets, and the DS Report then shows both.
- **File name:** `Draft_Survey_<Ship>_<YYYY-MM-DD>_<kind>.xlsx`. It is shared or downloaded like other files.
- **A changed template:** if the input cells can't be found, the fill is refused with a plain message, and the report and numbers still work.

## 5. Testing

- **Unit tests** cover:
  - each formula step, against values computed by hand on a made-up table;
  - Excel ROUND half away from zero;
  - VLOOKUP approximate matching, including the exact-row and last-row cases;
  - out of range;
  - list, deflection and the HOG/SAG labels;
  - constant and cargo;
  - interim surveys;
  - the B/L difference.
- **Import tests** run on a made-up workbook with the real layout's labels, an unsorted table, and a missing column.
- **Fill tests:** fill a made-up template, then check that only the input cells changed and that `fullCalcOnLoad` is set.
- **Local acceptance**, never committed:
  - import the real workbook;
  - enter the real initial survey's inputs;
  - every intermediate value, the constant and the report must equal the workbook's cached values;
  - fill the real template, recalculate it with LibreOffice if available, and check the cached results match.
- **End-to-end:**
  - import a made-up workbook;
  - run an initial and a final survey;
  - see the cargo;
  - print the report;
  - export the filled workbook;
  - offline use;
  - no horizontal scroll at 360 px.

## 6. Left to the builder

- The exact on-screen arrangement, within the app's theme.
- Report pagination.
- Interim report: the DS Report layout with the interim survey in the second column, titled "Interim".

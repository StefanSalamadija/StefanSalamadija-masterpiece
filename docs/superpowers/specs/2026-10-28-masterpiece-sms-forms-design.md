# Masterpiece — Piece 2: SMS forms engine — Design Spec

Date: 2026-10-28
Status: design approved section by section by the user. This written spec is awaiting the user's review.
Roadmap: piece 2, built right after the base app (user decision 2026-10-27).

> **Confidentiality.** The company's SMS forms are confidential. This public document describes only form *patterns*. It contains no company form numbers, titles, item lists, thresholds or wording. Forms live only on the user's devices and in the user's encrypted backups. Code and tests use synthetic forms built for the purpose.

## 1. Purpose

The user fills the company's SMS forms on the phone in a few taps, and prints them on the ship's laptop **identical to the original**.

Success means:
- any of the user's 30–100 Word/Excel forms can be imported once, without a new app version;
- ship, crew, voyage and time fields fill themselves;
- the most-used forms take seconds to minutes instead of retyping:
  - toolbox talk;
  - work permits (enclosed space entry, working aloft/outboard);
  - weekly work done report;
  - ship/shore safety checklist;
  - store and gear inventories;
  - daily bilge soundings;
  - monthly condition report;
- the produced file opens in Word/Excel looking exactly like the company form, except that the boxes are filled in.

## 2. Decisions (user)

| Topic | Decision |
|---|---|
| How forms get into the app | **Smart import of any form** (approach A). The user imports the company's .docx/.dotx/.xlsx; the app detects every fillable place. No form is built into the app. |
| Number of forms | 30–100; the company issues revisions a few times a year. |
| Where | Filled on the **phone**; printed on the **ship's laptop** from Word/Excel. |
| Output | The **original file with the values written in**. Everything else in the file stays byte-identical. |
| Signatures | **By hand after printing.** Signature boxes stay empty; the signer's name and rank are filled where the form has fields for them. |
| Archive | **No archive** of filled forms. The app makes the file; the user keeps files in folders on the laptop. |
| Continuity | A form being filled is kept as a **draft** until the file is made. After that the app keeps only the **last values** of that form, so the next one starts from them (inventories; pending jobs roll over). |
| Helpers | All seven helpers in §7. |
| Backup / handover | Library, drafts and last values are in full backups. Handover files carry that ship's drafts and last values, plus the forms library (a checkbox, default on). |
| Language | App UI in English. |

## 3. Concepts

- **Form template.** An imported company file: its original bytes, its detected **schema** and the user's **setup**.
  - The setup holds: field-to-data links, helper switches, and the "all OK" word.
  - Identity: the code, title and revision read from the header (`Form:`, `Revision:` and similar labels), with the file name as fallback.
- **Field.** One fillable place. Kinds:
  - `text`, `date`, `time`, `number`, `checkbox`;
  - `choice` (a dropdown, or a row of tick columns such as Yes/No/N/A);
  - `picture`.
  
  Each field has a **label** (the nearby text), a **section** (the nearest heading) and a **location** in the file.
- **Row group.** A table area made of repeatable rows (participants, a log, a jobs list, an inventory). It has columns (fields) and a row capacity. It can grow when the form allows it (Word repeating sections, or cloned table rows).
- **Draft.** The values being entered for one form on one ship, including rows and photos. Saved on every change.
- **Last values.** What the last produced file contained, per form and per ship. It is the starting point for the next draft where a helper asks for it.
- **Output.** The original template file with the draft's values written into its fields.

## 4. User flow

1. **Forms tab.** The bottom bar gets a fifth item, `Forms`. It shows:
   - the library (code, title, revision), with search;
   - the drafts in progress for the active ship.
2. **Import.** The user picks a `.docx`, `.dotx` or `.xlsx` file. The app reads it and shows a **setup review**:
   - what was found: for example, 33 fields, 1 row group of 13 rows, 2 signature boxes left empty;
   - the auto-fill links;
   - the helpers it suggests;
   - what it could not handle (text in floating text boxes or drawings).
   
   The user confirms or adjusts once: relink a field, unlink it, mark it as left empty, switch a helper.
3. **Fill.** The draft opens as a phone-friendly list of questions, grouped by the form's sections:
   - auto-filled values are shown and stay editable;
   - helpers appear where they apply (§7);
   - every change is saved at once.
4. **Make file.** `Make file` writes the values into the original and produces the output.
   - File name: `<code> <title> <YYYY-MM-DD>.<ext>`, made safe for any file system.
   - It goes through the existing share-or-download path (email, WhatsApp, USB, cloud) to the laptop, where it is printed from Word/Excel.
   - After a successful share or download, the draft closes and its values become the form's last values.
   - If the share is cancelled, the draft stays open.
5. **New revision.** Importing a file with the same code as a library form asks: `Replace Revision <old> with Revision <new>?`
   - The new fields are linked to the old ones by label (then by position within their section).
   - The setup and last values are kept for every linked field.
   - Unlinked fields are listed for review.

Unsupported inputs get a message explaining the one-time fix, and nothing is imported:
- **Legacy `.doc` and `.xls`.** Open the file once in Word/Excel and save it as `.docx`/`.xlsx`. Identical output needs the modern formats.
- **Macro-enabled files.** Macros are never run or kept.

## 5. Detection

### 5.1 Word (`.docx`, `.dotx`)

Detected in the document body, from the document XML:
- **Legacy form fields:**
  - `FORMTEXT` becomes `text`, or `date`/`time`/`number` from the field's own type settings or the label;
  - `FORMCHECKBOX` becomes `checkbox`;
  - `FORMDROPDOWN` becomes `choice`, with its list entries.
- **Content controls:**
  - plain or rich text becomes `text`;
  - date becomes `date`;
  - dropdown or combo box becomes `choice`;
  - checkbox becomes `checkbox`;
  - picture becomes `picture`;
  - a repeating section becomes a **row group** that can grow.
- **Tick columns.** Table rows whose cells hold an empty tick-box symbol (a Wingdings or Symbol box character), under a header row whose column texts are short choice words (for example Yes / No / N/A), become one `choice` per row. The options come from the header texts.
- **Plain tables with empty rows.** Under a header row, consecutive rows whose cells are all empty become a **row group**. Its columns are the header texts, and its capacity is the number of empty rows. More rows can be added by cloning the last empty row with its formatting.
- **Labels.** A field's label is the nearest preceding text in the same table cell. Failing that, it is the preceding cell in the same row, then the header cell above it, then the preceding paragraph. A table title row or bold heading above sets the **section**.
- **Signature boxes.** Any field or cell whose label contains `Signature`, `Signed`, `Sign` or `Stamp` (case-insensitive, whole word) is marked *left empty*. It is never filled.
- **Not fillable (reported at import):** text inside floating text boxes, shapes and drawings; text in headers and footers.

### 5.2 Excel (`.xlsx`)

Detected in each visible sheet, within the print area when one is set:
- **Label cells.** A cell whose text ends with `:` (or is a known label such as `M/V`) followed by an empty cell, or an empty merged range, to its right on the same row makes that empty cell a field. The text is its label.
- **Table blocks.** A header row of bordered cells, followed by rows whose cells under those headers are partly prefilled and partly empty, makes the empty cells fields.
  - The prefilled first column (an item name, or a day number) names each row.
  - Examples: inventories with item rows; day 1–31 grids; condition lists.
- **Matrices.** When the header is a row of column titles and the first column holds attribute names, each empty cell is a field labelled `<column> · <attribute>`.
- **Cells left alone:** formulas, cells with existing values, hidden rows and columns, and cells outside the print area.
- **Data types.** Number cells (by number format) become `number`; date-formatted cells become `date`; everything else is `text`.

### 5.3 Fields the app could not classify

Each field gets a confidence. Low-confidence fields (no label found, or an odd layout) are listed first in the setup review for the user to name or skip.

## 6. Auto-fill

Labels are matched, case- and punctuation-insensitive, against a synonym table that links them to the base app's field dictionary (`resolveField`):

| Data | Example labels |
|---|---|
| Ship | Vessel, Ship name, M/V, MV, Name of ship · IMO, IMO Number · Call sign, Distinctive letters · Flag · MMSI · GT · NT · DWT · Owner · ISM Company · Type · Date of construction / Year built · Port of registry |
| Time | Date, Dated, Date of submission · Time · Month · Year / Week No. · Date (from to) |
| Voyage | Port, Arrival port, Last port, Next port · ETA · Voyage no. · Agent |
| People | Master, Chief Officer / C/O / Ch. Officer, Chief Engineer / C/E, Person in charge, Responsible Officer, Prepared by → onboard crew member of that rank: full name, and rank where the field asks for `Name / Rank` |

**Formats.** A date is written in the format the form shows next to the field, for example `dd/MMM/yyyy` or `DD.MM.YYYY`. Otherwise it uses the format the cell already has. Otherwise it is written `DD-MMM-YYYY` (the app's printed-date convention).

**Time values** follow these rules:
- They use the ship's time, through the base app's `toShipLocal`.
- `(24:00 UTC)` labels get UTC.
- A week runs Monday to Sunday on the ship's date, and the week number is the ISO week number.

**People.** A person is filled from the crew onboard at the draft's date, at the given rank. If nobody holds the rank, the field stays empty and is shown as such.

**Editing.** Every auto value is a suggestion: the user can edit it in the draft or relink the field in the setup.

## 7. Helpers

Each helper is suggested at import from the detected shape of the form, and the user can switch it on or off.

1. **Pick from crew.** For any row group with columns like Name and Rank (also `Name / Rank`, Function), an `Add from crew` button lets the user tick people onboard. Their full name and rank are written into the next free rows. Signature columns stay empty.
2. **All OK, then exceptions.** For tick-column checklists and condition lists, one button sets every row to the form's positive answer (`Yes`) or to the setup's chosen word (default `Satisfactory`). The user then changes only the exceptions, each with an optional remark.
3. **Today's row.** For a table block whose first column is days 1–31, the draft opens on the ship's today. Only that row is entered; the rest fill over the month. The month and year header fields come from the draft's month.
4. **Start from last.** For inventories and matrices, a new draft starts from the form's last values. Each row shows the previous value next to the input, so the user changes only what changed.
5. **Job log.** For a row group with Date / Responsible / Description / Status columns plus picture controls, jobs are added at any time:
   - the date is the ship's today, and the responsible person is picked from the crew;
   - each job has a description, a status (the form's own dropdown values), remarks, and before/after photos from the camera, each with the form's photo-label choice.
   
   The week (year, ISO week, Monday–Sunday) is computed in ship's time. After the file is made, jobs whose status is the form's "not finished" value start the next week's draft. The setup review sets which dropdown entry means "not finished": by default, the entry that reads Pending, Open or In progress.
6. **Alarm thresholds.** When a measurement table has rows that give alarm limits per column (for example pre-alarm and main-alarm values), every reading entered in that table's columns is checked against them. An out-of-range reading is shown in red, for example `O₂ 18.5 — below 19`. This warning is in the app only and is never written into the file.
7. **Now.** Every `time` field and every `date + time` pair has a `Now` button that inserts the ship's time.

## 8. Writing the output

General rules:
- The output is the template's zip package. Only the XML parts that hold filled values change, plus the parts named below. Every other part is copied byte for byte.
- No text is ever rewritten outside the fields, apart from the cloned rows.

### Word

| What is filled | How it is written |
|---|---|
| `FORMTEXT` | The field's result runs are replaced by one run carrying the field's original run properties. |
| `FORMCHECKBOX` | `w:checked` is set. |
| `FORMDROPDOWN` | `w:result` is set to the entry index. |
| Content controls | The text, checkbox state or date is written inside the control, keeping its formatting. The placeholder flag is removed. |
| Tick columns | The empty box symbol in the chosen column becomes the checked box symbol of the same font. The other columns keep the empty box. |
| Picture controls | A downsized JPEG becomes a new media part with its relationship and content-type entry, sized to the control's frame. |
| Repeating sections and plain row groups | When more rows are needed, the last item or row is cloned with its formatting, and the clones are filled. |

A `.dotx` template becomes a `.docx` document: the main part's content type changes from template to document. Document protection for forms is kept as it is.

### Excel

- Values go into their cells as shared strings, numbers, or date serials that use the cell's existing number format.
- Formulas, styles, merges, print setup, drawings and external links are untouched.
- `fullCalcOnLoad` is set so that totals recalculate when the file is opened.

### Integrity check

Before a file is handed over, the app re-reads the output it just made and confirms:
- every filled field reads back with its value;
- every untouched part is byte-identical to the template.

On a mismatch, the file is not shared and the error is shown.

## 9. Data, storage and privacy

- **New tables** (Dexie version 3, with a `before-update` snapshot during the upgrade):
  - `formTemplates` (personal scope, not tied to a ship): id, code, title, revision, kind, original file name, original bytes, schema, setup, importedAt.
  - `formDrafts` (ship scope): template id, period (date, week or month as the helpers need), values, rows, photo ids, startedAt.
  - `formLastValues` (ship scope): template code and values.
  - `formPhotos` (ship scope): downsized JPEG bytes (longest side about 1600 px, about 300 KB). Photos exist only while their draft is open: once the file is made they live inside it, and the app deletes them.
- **Backups.**
  - Full backups include all four tables. Binary data is stored base64 inside the encrypted payload.
  - The backup import size limit is raised from 64 MB to 128 MB. That fits a library of 100 forms plus open drafts with photos. The "too large" message stays and states the new limit.
- **Handover.** It carries that ship's drafts, last values and photos. The forms library goes with it unless the new export checkbox `Include forms library` is unticked.
- **Storage.** Every write goes through the existing storage guard, so a full disk gives the storage-full message.
- **Privacy.**
  - Forms are read and written on the device only; nothing is uploaded.
  - Text that comes from a form is shown as plain text only.
  - Imported files are untrusted input. They are parsed with size limits, and any XML parsing must not resolve external entities or DTDs.

## 10. Screens and copy (English UI)

- **Bottom bar:** `Home`, `Ship`, `Forms`, `Profiles`, `Settings`.
- **Forms:**
  - heading `Forms`;
  - button `Import form`;
  - a search box;
  - the library list (`<code> · <title> · Rev <revision>`);
  - section `In progress` (drafts of the active ship, with each one's period).
- **Setup review:**
  - heading `Set up <code>`;
  - sections `Filled for you`, `You fill`, `Left empty`, `Can't be filled here`, `Helpers`;
  - button `Save form`.
- **Fill:**
  - heading `<code> <title>`, with the period line;
  - section blocks;
  - buttons `Make file` and `Discard draft`.
- **Home:** a small card for drafts in progress, for example `Bilge soundings — today's row not entered`.

## 11. Testing

- **Synthetic fixtures.** The tests build their own small `.docx`/`.dotx`/`.xlsx` forms, one for each pattern in §5 and §7. No company form is ever committed.
- **Detection tests.** Field kinds, labels, sections, row groups, signature exclusion, matrices, day grids and threshold rows.
- **Round-trip tests.** Write values, re-read them, and compare every untouched zip part byte for byte.
  - Tick symbols, dropdown indexes and cloned rows.
  - Picture insertion.
  - `.dotx` → `.docx` content type.
  - `fullCalcOnLoad`.
- **Revision mapping tests.**
- **Backup and handover round trips** with the new tables, and the v2 → v3 migration test.
- **E2E (Playwright).** Import a synthetic form, then: setup review, fill with each helper, make the file, and read the downloaded file back.
- **Acceptance with the user's real forms (local only, never committed).** All 16 sample forms go through import, fill and make file in the scratchpad. Every output is checked to open (re-parsed), and the user then prints them on the ship's laptop and confirms.

## 12. Build order

All of it is in piece 2, but it is built and checked in this order:

1. Engine core for Word and Excel: detect, setup, draft, write, integrity check.
2. Toolbox talk pattern: pick from crew.
3. Work permits: tick columns, all OK, alarm thresholds, `Now`.
4. Weekly work done: job log, photos, rollover.
5. Ship/shore safety checklist.
6. Inventories: start from last.
7. Daily grid and monthly condition report.
8. Revisions; backup and handover; the Home card.

## 13. Out of scope

- An in-app picture-perfect preview of the form. The final look is checked in Word/Excel.
- Digital or finger signatures.
- An archive of filled forms.
- PDF output; printing from the phone.
- `.doc`, `.xls` and macro-enabled files.
- Editing the form's layout.
- OCR of paper forms.
- Draft and air-draft values from cargo calculations, which come with the cargo piece and will then fill the checklist's draft fields.

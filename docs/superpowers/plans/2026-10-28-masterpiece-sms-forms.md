# Masterpiece Piece 2 — SMS Forms Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import any company Word/Excel form once, fill it on the phone as a list of questions with auto-fill and helpers, and produce the original file with only the values written in.

**Architecture:**
- A pure engine under `src/forms/` reads a `.docx/.dotx/.xlsx` zip package. It detects fields into a serialisable `FormSchema` and writes a `DraftValues` object back into a copy of the package. Every untouched part keeps its exact bytes.
- Detection is deterministic: writers re-run it on a fresh parse to find nodes by field id.
- Auto-fill and helpers are pure functions over the schema and the base app's field dictionary.
- Four new Dexie tables (v3) hold templates, drafts, last values and photos. The forms UI is a new `Forms` tab.

**Tech Stack:**
- Base app stack: Preact 11, Vite 8, TypeScript 7, Dexie 4, Vitest 5, Playwright 1.63.
- New runtime dependencies: `fflate` (zip) and `@xmldom/xmldom` (DOMParser/XMLSerializer, the same in the browser and in Vitest's node environment).

**Spec:** `docs/superpowers/specs/2026-10-28-masterpiece-sms-forms-design.md`. Read it together with this plan. The base app's conventions are in `docs/superpowers/plans/2026-10-25-masterpiece-base.md`.

## Global Constraints

Every base-app global constraint still applies:
- offline only;
- `base: './'`;
- English UI;
- ISO strings;
- soft deletes;
- Dexie async-transaction rule;
- 360 px with no sideways scroll;
- no literal invisible/bidi characters (`src/sourceHygiene.test.ts`).

Additions for this piece:

- **Dependencies (plan change, user-approved with this plan):** add runtime `fflate@^0.8.2` and `@xmldom/xmldom@^0.9.8`. No other new dependency.
- **Confidentiality:** no company form (file, code, title, item, wording) may be committed anywhere: tests, fixtures, docs or e2e. Tests use synthetic fixtures from Task 2 only. Real forms are used only by the controller's local acceptance run (Task 18) from the scratchpad.
- **Accepted inputs:** `.docx`, `.dotx`, `.xlsx`, by zip magic `PK\x03\x04` plus main part.
- **Refused inputs and their messages (exact):**

  | Input | Message |
  |---|---|
  | `.doc`/`.xls` (CFB magic `D0 CF 11 E0`) | `This is an old Word or Excel format. Open it once in Word or Excel and save it as .docx or .xlsx, then import that file.` |
  | Macro-enabled (`.docm`/`.xlsm`/`.dotm`, or a `vbaProject.bin` part) | `Files with macros can't be imported. Save a copy without macros (.docx or .xlsx) and import that.` |
  | Anything else | `This file isn't a Word or Excel form.` |
- **Limits:**

  | Limit | Value | Message (exact) |
  |---|---|---|
  | Template file size | ≤ 20 MB | `This file is too large to be a form (over 20 MB).` |
  | Zip entries | ≤ 2,000 | `This file couldn't be read. It may be damaged.` |
  | Total uncompressed size | ≤ 100 MB | same message |
  | XML part containing `<!DOCTYPE` | refused | same message |
- **Photos:** longest side 1,600 px, JPEG quality 0.8. Kept only while their draft is open.
- **Backup:** the import file limit is raised from 64 MB to **128 MB**. Binary data is stored as base64 strings inside records: `fileBase64`, `jpegBase64`.
- **Dates:**
  - A form's own format hint wins (`dd/MMM/yyyy` → `28/Oct/2026`; `DD.MM.YYYY` → `28.10.2026`).
  - Next comes an Excel cell's date format.
  - The default is `DD-MMM-YYYY` → `28-OCT-2026`.
  - The week is ISO, Monday–Sunday, on the ship's date.
- **Output file name:** `<code> <title> <YYYY-MM-DD>.<docx|xlsx>`. Characters `\/:*?"<>|` and control characters become `-`; whitespace runs are collapsed; the whole name is at most 120 characters before the extension; if there is no code, it is `<title> <date>`. A `.dotx` produces `.docx`.
- **Untrusted text:** text read from a form is rendered as plain text only (no `dangerouslySetInnerHTML`, no HTML built from it).
- **Storage guard:** every new write goes through the base `guardWrite`, so a full disk gives the existing storage-full message.
- **Lazy loading:** the forms engine (`src/forms/**`, fflate, xmldom) loads through a dynamic `import()` from the Forms screens. It is precached, and the main chunk must not grow by more than 15 kB gzip.
- **UI copy (exact):**
  - nav `Forms`;
  - headings `Forms`, `Set up <code>`;
  - buttons `Import form`, `Save form`, `Make file`, `Discard draft`, `Add from crew`, `All <okWord>`, `Now`, `Add job`, `Add photo`;
  - sections `In progress`, `Filled for you`, `You fill`, `Left empty`, `Can't be filled here`, `Helpers`;
  - prompt `Replace Revision <old> with Revision <new>?`;
  - integrity failure `The file couldn't be made correctly, so it wasn't shared. Nothing was lost — your draft is still here.`;
  - handover checkbox `Include forms library`.

## Review Focus

1. **Labels in merged or multi-row table cells, and labels above the field instead of beside it.** The field gets the visible nearby text as its label, never an empty label or a neighbour's. Pinned in Task 4 (`labels_from_merged_and_above`) and Task 7 (`merged_label_cells`).
2. **Values with `&`, `<`, `"`, diacritics (Š, ć, đ) and line breaks (Remarks).** They round-trip exactly and the XML stays valid. Line breaks become `<w:br/>` in Word and stay inside one Excel cell. Pinned in Task 5 (`escapes_and_line_breaks`) and Task 8 (`escapes_in_cells`).
3. **Large forms (a 120-row inventory, a 31-day × 12-column grid, a 3-page permit).** Detection takes under 1 s and filling under 1 s in Node. The fill screen renders and scrolls without freezing. Pinned in Task 7 (`large_grid_under_1s`) and Task 15 (e2e with the large fixture).
4. **A draft that is open when a new revision of its form is imported.** The draft moves to the new revision through the field mapping, and unmatched values are listed, not silently dropped. Pinned in Task 13 (`open_draft_migrates`).
5. **The share is cancelled after `Make file`.** The draft stays open and the last values are not updated. Pinned in Task 15 (e2e `cancelled_share_keeps_draft`).

---

### Task 1: Package and XML foundation

**Files:**
- Modify: `package.json` (add the dependencies), `vite.config.ts` (nothing unless chunking needs it)
- Create: `src/forms/package.ts`, `src/forms/xml.ts`, `src/forms/errors.ts`
- Test: `src/forms/package.test.ts`, `src/forms/xml.test.ts`

**Interfaces:**
- Produces:
  - `type Package = { entries: Map<string, Uint8Array>; order: string[] }`.
  - `readPackage(bytes: Uint8Array): Package`. Uses fflate `unzipSync`; enforces the Global Constraints limits.
  - `writePackage(original: Package, changed: Map<string, Uint8Array>): Uint8Array`. Uses fflate `zipSync`, in the original order, with new parts appended. Unchanged entries are passed through as the same bytes.
  - `partText(pkg: Package, path: string): string | undefined`.
  - `parseXml(text: string): Document`. Uses xmldom; throws `DamagedFormError` on `<!DOCTYPE` or a parse error.
  - `serializeXml(doc: Document): string`. Keeps the XML declaration.
  - `utf8(bytes)` / `bytesOf(text)`.
  - Error classes in `errors.ts`, all extending `FormFileError` (which has `.message`): `OldFormatError`, `MacroFileError`, `NotAFormError`, `FormTooLargeError`, `DamagedFormError`, each with the exact Global Constraints message.
  - `sniffFormat(fileName: string, bytes: Uint8Array): 'docx' | 'dotx' | 'xlsx'`. Throws the errors above. The kind comes from `[Content_Types].xml`: the main document is `wordprocessingml.document.main`, `wordprocessingml.template.main`, or `spreadsheetml.sheet.main`. A macro content type or `vbaProject.bin` gives `MacroFileError`.

- [ ] **Step 1: Install dependencies.** Run `npm i fflate@^0.8.2 @xmldom/xmldom@^0.9.8`. Expected: `package.json` lists both under dependencies.
- [ ] **Step 2: Write the failing tests.**

```ts
// package.test.ts
it('round-trips: unchanged parts keep their exact bytes', () => {
  const pkg = readPackage(zipOf({ '[Content_Types].xml': CT_DOCX, 'word/document.xml': DOC, 'word/media/a.png': PNG }));
  const out = readPackage(writePackage(pkg, new Map([['word/document.xml', bytesOf(DOC2)]])));
  expect(out.order).toEqual(pkg.order);
  expect(out.entries.get('word/media/a.png')).toEqual(pkg.entries.get('word/media/a.png'));
  expect(utf8(out.entries.get('word/document.xml')!)).toBe(DOC2);
});
it('sniffs kinds and refuses old, macro and foreign files', () => {
  expect(sniffFormat('a.dotx', zipOf({ '[Content_Types].xml': CT_DOTX }))).toBe('dotx');
  expect(() => sniffFormat('a.doc', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toThrow(OldFormatError);
  expect(() => sniffFormat('a.docx', zipOf({ '[Content_Types].xml': CT_DOCM }))).toThrow(MacroFileError);
  expect(() => sniffFormat('a.pdf', bytesOf('%PDF-1.4'))).toThrow(NotAFormError);
});
it('enforces size, entry and uncompressed limits', () => { /* 20 MB + 1 → FormTooLargeError; 2001 entries → DamagedFormError; a zip bomb (>100 MB inflated) → DamagedFormError */ });
// xml.test.ts
it('refuses DOCTYPE', () => expect(() => parseXml('<!DOCTYPE x [<!ENTITY a "b">]><x/>')).toThrow(DamagedFormError));
it('serialises Word XML with the declaration and namespaces kept', () => {
  const s = serializeXml(parseXml(WORD_MIN));
  expect(s.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')).toBe(true);
  expect(s).toContain('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"');
});
```

`zipOf` is a test helper in `src/forms/testing/zip.ts`: fflate `zipSync` over `{ path: string | Uint8Array }`. Task 2 extends it.

- [ ] **Step 3: Run them and confirm they fail.** `npx vitest run src/forms` → FAIL (modules missing).
- [ ] **Step 4: Implement `package.ts`, `xml.ts` and `errors.ts`.** Check the uncompressed size with fflate's `unzip` filter, or by summing `originalSize`, before inflating.
- [ ] **Step 5: Run them and confirm they pass.** `npx vitest run src/forms && npm run typecheck` → PASS.
- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat(forms): zip package and safe XML foundation"`

### Task 2: Synthetic form fixtures

**Files:**
- Create: `src/forms/testing/zip.ts`, `src/forms/testing/wordFixtures.ts`, `src/forms/testing/excelFixtures.ts`, `e2e/fixtures/makeForms.ts`
- Test: `src/forms/testing/fixtures.test.ts`

**Interfaces:**
- Produces:
  - **Word fixtures.** Each returns `Uint8Array` with the minimal valid package (`[Content_Types].xml`, `_rels/.rels`, `word/document.xml`, `word/_rels/document.xml.rels`, `word/header1.xml`, plus a 1×1 `word/media/image1.png` logo):
    - `toolboxTalkDocx()`: a header `Form: TST-01 Revision: 00 / 01.01.2026` with title `Toolbox Talk`; a details table whose rows are `Vessel:`, `Subject:` and `Date:` with `Time:`, each with FORMTEXT fields; a `Participants` table with header `Name | Rank | Signature` and 12 empty rows; a final `Signature: (Person in charge)` cell.
    - `permitDocx()`: sections `Section 1 – Checks` and `Section 2 – Entry`, each a `| Yes | No | N/A` header plus rows with Wingdings `F0A8` symbols. Also a gas table with columns `Time | O2 [Vol.%] | CO [ppm] | H2S [ppm]`; alarm rows `Alarm 1 | 19.5 | 25 | 5` and `Alarm 2 | 23 | 50 | 10`; 10 empty reading rows. Also a `Personnel` table with columns `Name / Rank | Time IN | Time OUT` and 8 empty rows.
    - `weeklyJobsDotx()`: a `.dotx` with `Vessel:`, `Year / Week No.:` and `Date (from to):` FORMTEXT fields. A jobs repeating section (`w15:repeatingSection`) with columns `Date | Responsible | Description | Status | Remarks`, where Status is a FORMDROPDOWN [`_ choose`, `Pending`, `Completed`]. A pictures repeating section with 3 picture controls, each with a FORMDROPDOWN `Photo` [`_ choose`, `Before`, `After`].
    - `contentControlsDocx()`: text, date (`dd/MMM/yyyy`), dropdown, combo and `w14:checkbox` controls, plus one placeholder-flagged control.
    - `oddLayoutsDocx()`: a label in a vertically merged cell; a label in the cell above its field; a field with no label; text in a `wps:txbx` textbox; a FORMTEXT inside the header.
  - **Excel fixtures.** Each sheet has a print area, a `styles.xml` with thin borders, and one logo drawing:
    - `inventoryXlsx(rows = 120)`: `Vessel:` at B6, `Date:` at D6; header `Description | Specification | Location | Qty | Unit` at row 8; item names prefilled in column B; the other cells empty and bordered; a formula total row; `Signature C/O:` below.
    - `dayGridXlsx()`: `M/V` at A6; header rows 8–9 (`Hold 1` … `Hold 6` over `PORT`/`STBD` sub-headers, 12 value columns, then `Remarks`); days 1–31 in column A, rows 10–40; `Dated:` and `Signed:` rows.
    - `matrixXlsx()`: column titles in row 6 (9 equipment), attribute names in column A with some merged over 2 rows; empty bordered cells; `Master:` / `C/O:` at the bottom.
    - `conditionListXlsx()`: `M/V` and `Month :` labels; header `No. | Item | Condition | Remarks`; 100 prefilled item rows.
  - `e2e/fixtures/makeForms.ts`: `writeFormFixtures(dir: string): Promise<Record<string, string>>`. It writes each fixture to disk (`toolbox.docx`, `permit.docx`, `weekly.dotx`, `inventory.xlsx`, `daygrid.xlsx`, `matrix.xlsx`, `conditions.xlsx`) and returns their paths.
  - **Confidentiality.** All fixture text is invented. It must not reuse any company wording beyond generic words (Vessel, Date, Yes/No/N/A, Signature).

- [ ] **Step 1: Write the failing test.** Every fixture opens with `readPackage` and `sniffFormat` gives its kind. Every XML part parses with `parseXml`. `inventoryXlsx(120)` has 120 item rows.
- [ ] **Step 2: Run it and confirm it fails.** `npx vitest run src/forms/testing` → FAIL.
- [ ] **Step 3: Implement the fixtures.** Hand-written minimal OOXML strings. Keep each builder small and readable, with helper functions for table rows and cells.
- [ ] **Step 4: Run it and confirm it passes.** Also read each xlsx written by `writeFormFixtures` with SheetJS (`XLSX.read`) to prove it is well formed → PASS.
- [ ] **Step 5: Commit.** `git commit -am "test(forms): synthetic form fixtures"` (add the new files first).

### Task 3: Form model and identity

**Files:**
- Create: `src/forms/types.ts`, `src/forms/labels.ts`, `src/forms/identity.ts`
- Test: `src/forms/labels.test.ts`, `src/forms/identity.test.ts`

**Interfaces:**
- Produces (`types.ts`):

```ts
export type FormKind = 'docx' | 'dotx' | 'xlsx';
export type FieldKind = 'text' | 'date' | 'time' | 'number' | 'checkbox' | 'choice' | 'picture';
export interface FieldDef {
  id: string; kind: FieldKind; label: string; section: string;
  options?: string[];            // choice
  formatHint?: string;           // e.g. 'dd/MMM/yyyy' found near the field
  leftEmpty?: boolean;           // signature/stamp
  confidence: 'high' | 'low';
}
export interface RowGroupDef { id: string; label: string; section: string; columns: FieldDef[]; capacity: number; growable: boolean;
  rowLabels?: string[];          // prefilled first column (item names, day numbers)
  shape: 'rows' | 'dayGrid' | 'matrix' | 'checklist' }
export interface FormIdentity { code: string; title: string; revision: string }
export interface FormSchema { kind: FormKind; identity: FormIdentity; fields: FieldDef[]; rowGroups: RowGroupDef[]; unsupported: string[] }
export type FormValue = string | boolean | null;   // not the field dictionary's FieldValue
export interface DraftValues { fields: Record<string, FormValue>; rows: Record<string, Record<string, FormValue>[]> }
export type FieldLink = { source: string; part?: 'name' | 'rank' | 'nameRank' } | { source: 'none' };
export type HelperKey = 'pickCrew' | 'allOk' | 'todayRow' | 'startFromLast' | 'jobLog' | 'thresholds' | 'now';
export interface FormSetup { links: Record<string, FieldLink>; leftEmpty: string[]; helpers: Record<HelperKey, string[]>;
  okWord: string; notFinished: string }
export const DEFAULT_OK_WORD = 'Satisfactory';
```

  `FieldLink`, `HelperKey` and `FormSetup` live here so that Tasks 10–12 share them; Tasks 10 and 11 give their meaning.
  Field ids are deterministic in document order: `f1`, `f2`…, and inside groups `g1.c1`… . Excel ids are `<sheet>!<A1>`, and groups `<sheet>!g<n>`.
- Produces (`labels.ts`):
  - `normaliseLabel(s: string): string`: lower-case; strip `:`, `()`, `*`, `.`; collapse spaces; trim.
  - `isSignatureLabel(s: string): boolean`: the whole words `signature`, `signed`, `sign` or `stamp`.
  - `formatHintOf(s: string): string | undefined`: detects `dd/MMM/yyyy`, `DD.MM.YYYY`, `dd.mm.yyyy`, `YYYY-MM-DD` and `(24:00 UTC)`.
- Produces (`identity.ts`):
  - `identityFromText(lines: string[], fileName: string): FormIdentity`.
  - `code` is the token after `Form:` (`TST-01`).
  - `revision` is the text after `Revision:` up to the next label (`00 / 01.01.2026`).
  - `title` is the longest remaining line that isn't a label (`Approved`, `Page`, `Form`, `Revision`).
  - With no code: `code = ''` and the title comes from the file name without its extension.

- [ ] **Step 1: Write the failing tests.**
  - `identityFromText(['Toolbox Talk', 'Form:', 'TST-01', 'Revision:', '00 / 01.01.2026', 'Page: 1 of 1'], 'x.docx')` → `{ code: 'TST-01', title: 'Toolbox Talk', revision: '00 / 01.01.2026' }`.
  - `normaliseLabel(' Vessel: ')` → `'vessel'`.
  - `isSignatureLabel('Signature:(Person in charge)')` → true.
  - `isSignatureLabel('Designated')` → false.
  - `formatHintOf('Date of submission (dd/MMM/yyyy):')` → `'dd/MMM/yyyy'`.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement the functions.**
- [ ] **Step 4: Run them and confirm they pass.**
- [ ] **Step 5: Commit.** `feat(forms): form model, labels and identity`

### Task 4: Word detection

**Files:**
- Create: `src/forms/word/detect.ts`, `src/forms/word/walk.ts`
- Test: `src/forms/word/detect.test.ts`

**Interfaces:**
- Consumes: Task 1 (`Package`, `parseXml`, `partText`), Task 3 (types, `labels.ts`, `identityFromText`).
- Produces:
  - `detectWord(pkg: Package, kind: 'docx' | 'dotx', fileName: string): FormSchema`.
  - `locateWord(doc: Document): Map<string, WordTarget>`, which re-runs the same traversal on a parsed `word/document.xml` and returns node targets by field id:
    - `type WordTarget = { kind: 'formtext' | 'formcheck' | 'formdrop'; begin: Element }`;
    - `| { kind: 'sdt'; sdt: Element }`;
    - `| { kind: 'tick'; cells: Element[] }` (one per option, in option order);
    - `| { kind: 'cell'; tc: Element }`;
    - `| { kind: 'group'; rows: Element[]; repeating?: Element }`.
- **Rules (spec §5.1):**
  - **Legacy fields:** `w:fldChar[@fldCharType=begin]` with `w:ffData` and an `instrText` of `FORMTEXT`, `FORMCHECKBOX` or `FORMDROPDOWN`.
    - FORMTEXT kind: `w:textInput/w:type`; `date` → `date`, `number` → `number`, `currentTime` → `time`. Otherwise the label decides: a date `formatHintOf` → `date`; a normalised label `time` or starting with `time ` → `time`; else `text`.
    - FORMDROPDOWN: the `w:listEntry` values, without the first entry when it starts with `_` or `...`.
  - **Content controls:** `w:sdtPr` holds `w:text`, `w:date` (`w:dateFormat` → `formatHint`), `w:dropDownList`/`w:comboBox` (`w:listItem/@w:displayText`), `w14:checkbox`, `w:picture`, or `w15:repeatingSection`. A repeating section is one row group with `growable: true`.
  - **Tick columns:**
    - **Header:** a table row whose last 2–4 cells hold only short choice words. The words are `Yes`, `No`, `N/A`, `NA`, `Y`, `N`, `OK`, `Good`, `Bad`, compared case-insensitively.
    - **Body:** each following row whose cells in those columns are empty or hold a box symbol becomes one `choice` field.
      - Box symbols: `w:sym` with `w:char` `F0A8`/`F06F`/`F071`, or the text `☐` or `□`.
      - Options: the header words.
      - Label: the row's first non-empty cell text.
      - Section: the nearest heading above.
  - **Plain row groups:**
    - Under a header row (≥ 2 non-empty cells), take the consecutive rows where every cell is empty: no text, no fields, no symbols.
    - Columns come from the header cells, with a signature column marked `leftEmpty`.
    - `capacity` is the number of rows; `growable: true`; `shape: 'rows'`.
  - **Labels:** the order of spec §5.1, plus format hints from the label (`formatHintOf`).
  - **Sections:** the nearest preceding table row with one cell spanning the table (`gridSpan` = all columns) that has text, or a paragraph whose runs are all bold, or text starting with `Section`.
  - **Unsupported:** the text of any `wps:txbx`/`v:textbox` that contains a field or an empty box, and any form field found in `word/header*.xml` or `word/footer*.xml`. Each becomes a short description such as `Text box: "<first 40 chars>"`.
  - **Identity:** the text of `word/header*.xml` (all paragraphs and cells), passed through `identityFromText`.

- [ ] **Step 1: Write the failing tests.**

```ts
const s = detectWord(readPackage(toolboxTalkDocx()), 'docx', 'toolbox.docx');
expect(s.identity).toEqual({ code: 'TST-01', title: 'Toolbox Talk', revision: '00 / 01.01.2026' });
expect(s.fields.map(f => f.label)).toEqual(expect.arrayContaining(['Vessel', 'Subject', 'Date', 'Time']));
const g = s.rowGroups.find(r => r.label === 'Participants')!;
expect(g.capacity).toBe(12); expect(g.columns.map(c => [c.label, !!c.leftEmpty])).toEqual([['Name', false], ['Rank', false], ['Signature', true]]);
const p = detectWord(readPackage(permitDocx()), 'docx', 'p.docx');
const tick = p.fields.find(f => f.kind === 'choice' && f.section.startsWith('Section 1'))!;
expect(tick.options).toEqual(['Yes', 'No', 'N/A']);
const w = detectWord(readPackage(weeklyJobsDotx()), 'dotx', 'w.dotx');
expect(w.rowGroups.map(r => r.growable)).toEqual([true, true]);
expect(w.rowGroups[0].columns.find(c => c.label === 'Status')!.options).toEqual(['Pending', 'Completed']);
const c = detectWord(readPackage(contentControlsDocx()), 'docx', 'c.docx');
expect(c.fields.find(f => f.kind === 'date')!.formatHint).toBe('dd/MMM/yyyy');
```
  - `labels_from_merged_and_above` (Review Focus 1), on `oddLayoutsDocx()`:
    - a merged-cell label is found;
    - an above-cell label is found;
    - the field with no label gets `confidence: 'low'` and label `Field <n>`;
    - `unsupported` lists the textbox and the header field.
  - `locateWord(parseXml(...))` returns a target for every schema id.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement `walk.ts`** (body traversal that yields tables, rows, cells and paragraphs in order, with text extraction) **and `detect.ts`** with the rules above.
- [ ] **Step 4: Run them and confirm they pass.** `npx vitest run src/forms/word`.
- [ ] **Step 5: Commit.** `feat(forms): Word form detection`

### Task 5: Word writing

**Files:**
- Create: `src/forms/word/write.ts`, `src/forms/word/read.ts`
- Test: `src/forms/word/write.test.ts`

**Interfaces:**
- Consumes: Task 4 (`detectWord`, `locateWord`, `WordTarget`), Task 1.
- Produces:
  - `writeWord(pkg: Package, schema: FormSchema, values: DraftValues, opts: { photos: Record<string, Uint8Array> }): Map<string, Uint8Array>`. It returns the changed parts. Pictures arrive in Task 6; until then it ignores `photos`.
  - `readWordValues(pkg: Package, schema: FormSchema): DraftValues`, which reads values back (used by the integrity check).
- **Rules (spec §8):**
  - **FORMTEXT:** replace every run between `separate` and `end` with one run that copies the first result run's `w:rPr`. When there is no result run, copy the `begin` run's. Text with `\n` becomes `w:t` / `w:br` pairs. Use `xml:space="preserve"` when there is leading or trailing whitespace.
  - **FORMCHECKBOX:** `w:checkBox/w:checked` (`w:val="1"`) when true; remove it when false.
  - **FORMDROPDOWN:** `w:ddList/w:result w:val=<index>`, counted including the skipped placeholder entry.
  - **sdt:** set the content text, keeping the run properties of the first run. `w14:checked` takes `1`/`0`, and the visible glyph comes from `w14:checkedState`. Remove `w:showingPlcHdr`. A date also sets `w:date/@w:fullDate` (`YYYY-MM-DDT00:00:00Z`).
  - **Tick:** in the chosen option's cell, replace the box symbol: `w:sym/@w:char` `F0A8` becomes `F0FE` in the same font, and `☐`/`□` becomes `☒`. A cell with no symbol gets a centred `X` run with the cell's paragraph properties.
  - **Plain row groups:** fill rows in order. When values exceed capacity, clone the last empty row (deep copy) after it as many times as needed, then fill.
  - **Repeating sections:** clone the last `w15:repeatingSectionItem` `w:sdt`, giving each clone fresh `w:id` values (a random 31-bit int, unique in the document).
  - **`.dotx` → `.docx`:** in `[Content_Types].xml` the main part's `ContentType` becomes `application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml`.
  - `leftEmpty` fields are never written.

- [ ] **Step 1: Write the failing tests.**

```ts
const pkg = readPackage(toolboxTalkDocx()); const s = detectWord(pkg, 'docx', 't.docx');
const id = (l: string) => s.fields.find(f => f.label === l)!.id;
const vals: DraftValues = { fields: { [id('Vessel')]: 'MV DEMO STAR', [id('Subject')]: 'Mooring' }, rows: {
  [s.rowGroups[0].id]: Array.from({ length: 15 }, (_, i) => ({ [s.rowGroups[0].columns[0].id]: `Person ${i + 1}`, [s.rowGroups[0].columns[1].id]: 'AB' })) } };
const changed = writeWord(pkg, s, vals, { photos: {} });
const out = readPackage(writePackage(pkg, changed));
expect([...changed.keys()]).toEqual(['word/document.xml']);                       // nothing else touched
for (const p of pkg.order) if (!changed.has(p)) expect(out.entries.get(p)).toEqual(pkg.entries.get(p));
expect(readWordValues(out, detectWord(out, 'docx', 't.docx')).fields[id('Vessel')]).toBe('MV DEMO STAR');
expect(detectWord(out, 'docx', 't.docx').rowGroups[0].capacity).toBeGreaterThanOrEqual(15);   // 3 rows cloned
```
  - `escapes_and_line_breaks` (Review Focus 2): the value `Šašić & <Co> "x"\nline 2` reads back identically, and `document.xml` parses.
  - The tick test: choosing `No` in `permitDocx` writes `F0FE` in the No cell only.
  - The dropdown index test.
  - The `w14:checkbox` test.
  - The repeating-section clone test, with unique ids.
  - The `.dotx` content-type test.
  - A `leftEmpty` value is ignored.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement `write.ts` and `read.ts`.**
- [ ] **Step 4: Run them and confirm they pass.**
- [ ] **Step 5: Commit.** `feat(forms): write values into Word forms`

### Task 6: Word pictures

**Files:**
- Modify: `src/forms/word/write.ts`
- Test: `src/forms/word/pictures.test.ts`

**Interfaces:**
- Consumes: Task 5.
- Produces: `writeWord` handles `picture` fields whose value is a photo id present in `opts.photos`. It adds:
  - a part `word/media/mp-<n>.jpeg`;
  - a relationship `rIdMp<n>` (type `.../relationships/image`) in `word/_rels/document.xml.rels`;
  - a `<Default Extension="jpeg" ContentType="image/jpeg"/>` entry if missing.
  
  It points the control's `a:blip/@r:embed` at the new relationship, keeps the control's `wp:extent`, and removes `w:showingPlcHdr`.

- [ ] **Step 1: Write the failing test.**
  - Two photos go into `weeklyJobsDotx`.
  - The output has 2 new jpeg parts, rels and the content type.
  - Each control's blip points to its photo.
  - `readWordValues` reports the photo fields as filled. The value is the media path; the integrity check compares presence only.
- [ ] **Step 2: Run it and confirm it fails.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it and confirm it passes.**
- [ ] **Step 5: Commit.** `feat(forms): photos in Word picture controls`

### Task 7: Excel detection

**Files:**
- Create: `src/forms/excel/workbook.ts` (parses workbook, sheets, shared strings, styles, merges and print area), `src/forms/excel/detect.ts`
- Test: `src/forms/excel/detect.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 3.
- Produces:
  - `loadWorkbook(pkg: Package): Workbook`, where `interface Workbook { sheets: SheetModel[]; date1904: boolean }` and `SheetModel` is:

    ```ts
    {
      name: string;
      path: string;
      cells: Map<string, CellModel>;
      merges: string[];
      printArea?: string;
      hiddenRows: Set<number>;
      hiddenCols: Set<number>;
    }
    ```

    `CellModel` is `{ ref, row, col, text, formula?, styleId, bordered, numFmt?: string }`.
  - `detectExcel(pkg: Package, fileName: string): FormSchema`.
- **Rules (spec §5.2):**
  - **Visible sheets only.** Only cells inside the print area count when one exists.
  - **Merged ranges.** A merged range acts as its top-left cell.
  - **Label cells.** A text cell ending in `:` (or one of `M/V`, `MV`, `Vessel`) whose next cell to the right (or merged range) is empty makes that cell a field. If the label cell itself holds a value after the colon (`Date: ` with trailing spaces), the field is the label cell's right neighbour.
  - **Table blocks.** A header row is a run of ≥ 3 adjacent bordered text cells.
    - The block's data rows are the following rows with bordered cells under those columns. It stops at the first row with none, or at a row whose first text is a signature or `Dated`/`Signed` label.
    - Empty bordered cells are fields.
    - A non-empty first column gives `rowLabels`.
    - Day grid: `shape: 'dayGrid'` when the first column is the integers 1…n, with n between 28 and 31.
    - Checklist: `shape: 'checklist'` when a column header contains `condition` or `status` (case-insensitive).
    - Every other table block: `shape: 'rows'`.
    - `growable: false`.
  - **Matrix.** A header row of titles plus a first column of attribute names, where data cells span the titles. Each empty cell becomes a field labelled `<column title> · <attribute>`, with `shape: 'matrix'`. Merged attribute cells over 2 rows give each row the merged text, plus the row's own second-column text if present.
  - **Two-row headers.** A header row followed by a sub-header row (`PORT`/`STBD`) gives column labels `<header> <sub>`, for example `Hold 1 PORT`.
  - **Left alone.** Formula cells, non-empty cells and hidden cells are never fields.
  - **Kinds.** A cell with a date `numFmt` (built-in ids 14–22, or a custom format containing `d`, `m` and `y`) is `date`. A cell with a numeric `numFmt` is `number`. Every other cell is `text`.
  - **Identity.** Cells containing `Form:` and `Revision`, plus the largest-font or first long text in rows 1–4 as the title.

- [ ] **Step 1: Write the failing tests.**
  - On `inventoryXlsx(120)`:
    - fields `Vessel` (C6 area) and `Date`;
    - one row group with 120 `rowLabels` and columns `Specification`, `Location`, `Qty`, `Unit`;
    - the formula total row is excluded.
  - On `dayGridXlsx()`:
    - `shape: 'dayGrid'`, with 31 row labels;
    - a column label `Hold 1 PORT`.
  - `merged_label_cells` (Review Focus 1): on `matrixXlsx()`, a field labelled `<equipment 1> · <merged attribute>`.
  - On `conditionListXlsx()`: `shape: 'checklist'` and 100 rows.
  - `large_grid_under_1s` (Review Focus 3): `detectExcel` on `inventoryXlsx(500)` and `dayGridXlsx()` takes under 1,000 ms each in Node (`performance.now()`).
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement `workbook.ts` and `detect.ts`.**
- [ ] **Step 4: Run them and confirm they pass.**
- [ ] **Step 5: Commit.** `feat(forms): Excel form detection`

### Task 8: Excel writing

**Files:**
- Create: `src/forms/excel/write.ts`, `src/forms/excel/read.ts`
- Test: `src/forms/excel/write.test.ts`

**Interfaces:**
- Consumes: Task 7.
- Produces:
  - `writeExcel(pkg: Package, schema: FormSchema, values: DraftValues): Map<string, Uint8Array>`.
  - `readExcelValues(pkg: Package, schema: FormSchema): DraftValues`.
- **Rules (spec §8):**
  - **Text values** are written as shared strings. Append to `xl/sharedStrings.xml` and update `count`/`uniqueCount`. If the part is missing, create it, add its relationship in `xl/_rels/workbook.xml.rels`, and add its Override in `[Content_Types].xml`.
  - **Numbers:**
    - The input is accepted as typed, with a comma or a dot as the decimal mark, using `parseDecimal` from `src/domain/numbers.ts`.
    - It is written as `<v>`, and the cell has no `t` attribute.
    - A value that doesn't parse is written as text.
  - **Dates:**
    - Written as a serial in the workbook's date system (1900 or 1904), keeping the cell's `s` attribute.
    - If the cell has no date format, the date is written as text in the default format.
  - **Cells:**
    - A missing `<c>` is created in column order inside its `<row>`, and a missing `<row>` is created in row order.
    - The existing `s` attribute is always kept.
  - **Recalculation:** `xl/workbook.xml` gets `<calcPr fullCalcOnLoad="1"/>`, added or merged.
  - **Left alone:** formulas, styles, merges, drawings and external links.

- [ ] **Step 1: Write the failing tests.**
  - On `inventoryXlsx(10)`:
    - Fill `Qty` `"2,5"` and `Unit` `pcs` in row 3, and `Vessel` `MV DEMO STAR`.
    - The output parses with SheetJS: `Qty` is the number 2.5 and `Vessel` is text.
    - The formula total cell still has its `<f>`.
    - `fullCalcOnLoad="1"` is set.
    - Every part except `sheet1.xml`, `sharedStrings.xml` and `workbook.xml` is byte-identical.
  - `escapes_in_cells` (Review Focus 2): `Š & <x> "y"` with a line break round-trips through `readExcelValues`.
  - On `dayGridXlsx()`: filling day 28's row writes into row 37.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement `write.ts` and `read.ts`.**
- [ ] **Step 4: Run them and confirm they pass.**
- [ ] **Step 5: Commit.** `feat(forms): write values into Excel forms`

### Task 9: Engine façade, file naming and integrity check

**Files:**
- Create: `src/forms/engine.ts`, `src/forms/fileName.ts`
- Test: `src/forms/engine.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 4–8.
- Produces:
  - `importForm(fileName: string, bytes: Uint8Array): { kind: FormKind; schema: FormSchema }`. Calls `sniffFormat`, then `detectWord` or `detectExcel`.
  - `makeFile(input: { kind: FormKind; fileName: string; bytes: Uint8Array; schema: FormSchema; values: DraftValues; photos: Record<string, Uint8Array>; date: string }): { fileName: string; bytes: Uint8Array; mime: string }`. Writes the values, packages the file, then runs `verifyOutput`.
  - `verifyOutput(original: Package, output: Package, changed: Set<string>, schema: FormSchema, values: DraftValues): void`. Throws `IntegrityError` (message exactly the Global Constraints integrity text) when:
    - any unchanged part differs;
    - any filled field reads back differently (pictures: presence only);
    - any changed XML part fails to parse.
  - `formFileName(identity: FormIdentity, date: string, kind: FormKind): string`, following the Global Constraints file-name rule.
  - MIME: `application/vnd.openxmlformats-officedocument.wordprocessingml.document` for docx and dotx output, and `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` for xlsx.

- [ ] **Step 1: Write the failing tests.**
  - `formFileName({ code: 'TST-01', title: 'Toolbox Talk', revision: '' }, '2026-10-28', 'dotx')` → `'TST-01 Toolbox Talk 2026-10-28.docx'`.
  - A title with `/:*?` gives a safe name.
  - A 200-character title is cut to the 120-character rule.
  - `makeFile` on each fixture produces output that `importForm` re-imports with the same field ids.
  - A deliberately corrupted output (the test mutates an unchanged part through a seam) throws `IntegrityError`.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and confirm they pass.**
- [ ] **Step 5: Commit.** `feat(forms): engine façade, file names and integrity check`

### Task 10: Auto-fill

**Files:**
- Create: `src/forms/autofill.ts`, `src/db/fieldContext.ts`
- Modify: `src/domain/dates.ts` (add `isoWeek(date: string): { year: number; week: number; monday: string; sunday: string }`)
- Test: `src/forms/autofill.test.ts`, additions to `src/domain/dates.test.ts`, `src/db/fieldContext.test.ts`

**Interfaces:**
- Consumes:
  - the base `resolveField(name, ctx, opts)` and `FieldContext` from `src/domain/fieldDictionary.ts`;
  - `toShipLocal` and `shipOffsetAt` from `src/domain/shipTime.ts`;
  - Task 3 types.
- Produces:
  - The meaning of `FieldLink` (Task 3). `source` is a field dictionary name (`vessel.name`, `vessel.imo`, `voyage.nextPort`, `voyage.agents`, …: see `FIELD_NAMES`), `crew.byRank.<RankKey>` (people, read through `resolveField('crew.byRank.<RankKey>.fullName', ctx, { asAt: date })`, with `part`: `name` = full name, `rank` = `rankLabel`, `nameRank` = `<full name> / <rank label>`), or one of the time sources `time.date`, `time.time`, `time.timeUtc`, `time.month`, `time.yearWeek` or `time.weekRange`.
  - `suggestLinks(schema: FormSchema): Record<string, FieldLink>`, from the spec §6 synonym table. People labels map to `crew.byRank.<RankKey>` (`master`, `chiefOfficer`, `chiefEngineer`; `Person in charge`, `Responsible Officer` and `Prepared by` map to `chiefOfficer`) with `part: 'nameRank'` when the label contains `Rank`, else `'name'`.
  - `autoValues(schema: FormSchema, links: Record<string, FieldLink>, ctx: FieldContext, date: string): { values: Record<string, string>; missing: Record<string, string> }`. `values` are formatted strings (dates use `formatHint`, then the cell format, then `DD-MMM-YYYY`). `missing` maps a people field with nobody of that rank onboard to `No <rank label> onboard`, which the fill screen shows under the empty field.
    - `time.month` → `October 2026`.
    - `time.yearWeek` → `2026 / 44`.
    - `time.weekRange` → `26-OCT-2026 - 01-NOV-2026`, or with the field's hint.
  - `loadFieldContext(db: MasterpieceDB, shipId: string, nowUtc: Date): Promise<FieldContext>` in `src/db/fieldContext.ts`.
  - `formatDate(iso: string, hint?: string): string` in `autofill.ts`: `dd/MMM/yyyy` → `28/Oct/2026`; `DD.MM.YYYY` → `28.10.2026`; no hint → `28-OCT-2026`.

- [ ] **Step 1: Write the failing tests.**
  - `isoWeek('2026-10-28')` → `{ year: 2026, week: 44, monday: '2026-10-26', sunday: '2026-11-01' }`.
  - `isoWeek('2027-01-01')` → week 53 of 2026.
  - `suggestLinks` on the toolbox schema links `Vessel` → `vessel.name` and `Date` → `time.date`.
  - The weekly fixture links `Year / Week No.` → `time.yearWeek`.
  - `autoValues` with a Master onboard fills `Master` → that crew member's full name; with none, `missing` holds `No Master onboard` and `values` has no entry.
  - `formatDate('2026-10-28', 'dd/MMM/yyyy')` → `'28/Oct/2026'`.
  - A `(24:00 UTC)` hint uses UTC time instead of ship's time.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and confirm they pass.**
- [ ] **Step 5: Commit.** `feat(forms): auto-fill from ship, crew, voyage and time`

### Task 11: Helpers (domain)

**Files:**
- Create: `src/forms/helpers.ts`
- Test: `src/forms/helpers.test.ts`

**Interfaces:**
- Consumes: Tasks 3 and 10, plus `onboardAt` and `fullName` (`src/domain/crew.ts`) and `rankLabel` (`src/domain/catalogues.ts`) from the base.
- Produces:
  - `suggestHelpers(schema: FormSchema): Record<HelperKey, string[]>`: the group or field ids each helper applies to.
    - **pickCrew:** groups with a `Name`/`Name / Rank` column.
    - **allOk:** tick-choice fields grouped by section, plus `checklist` groups.
    - **todayRow:** `dayGrid` groups.
    - **startFromLast:** `rows` groups with `rowLabels`, and `matrix` groups.
    - **jobLog:** growable groups with Date + Status columns.
    - **thresholds:** groups whose rows include an alarm row (`rowLabels` matching `/alarm/i` with numeric values).
    - **now:** every `time` field and every column labelled `Time` / `Time IN` / `Time OUT`.
  - `crewRows(group: RowGroupDef, people: CrewMember[]): Record<string, FormValue>[]`. Fills the name column with the full name, the rank column with the rank label, and a combined `Name / Rank` column as `<full name> / <rank>`.
  - `allOkValues(fieldsOrGroup: FieldDef[] | RowGroupDef, okWord: string): Record<string, FormValue>`. For a choice field, uses the first option that matches `yes`/`ok`/`good` (case-insensitive), otherwise `okWord`.
  - `todayRowIndex(group: RowGroupDef, shipToday: string): number`. Returns the day − 1.
  - `startFromLast(schema: FormSchema, last: DraftValues | undefined): DraftValues`. Copies only `startFromLast` groups and matrix fields.
  - `isoWeekPeriod(shipToday: string): string`, e.g. `2026-W44`.
  - `draftPeriod(setup: FormSetup, shipToday: string): string`: `YYYY-MM` when `todayRow` applies, else `isoWeekPeriod` when `jobLog` applies, else `YYYY-MM-DD`.
  - `periodLabel(period: string): string`: `2026-10` → `October 2026`; `2026-W44` → `Week 44, 2026`; `2026-10-28` → `28-OCT-2026`.
  - `defaultNotFinished(options: string[]): string`: the first option reading `Pending`, `Open` or `In progress` (case-insensitive), else `''`.
  - `defaultSetup(schema: FormSchema): FormSetup`: `suggestLinks`, the schema's `leftEmpty` ids, `suggestHelpers`, `DEFAULT_OK_WORD`, and `defaultNotFinished` of the job log's Status column.
  - `rolloverJobs(group: RowGroupDef, rows: Record<string, FormValue>[], notFinished: string): Record<string, FormValue>[]`.
  - `thresholdsOf(group: RowGroupDef, values: DraftValues): { column: string; low?: number; high?: number }[]`.
    - The lower of the two alarm rows' values is `low` and the higher is `high` when the column is O₂-like (the label contains `O2`).
    - Otherwise the first alarm row's value is `high`.
  - `checkReading(value: string, t: { low?: number; high?: number }): 'ok' | 'low' | 'high' | 'invalid'`.
  - `nowValue(nowUtc: Date, offsetMinutes: number): string`, returning `HH:mm`.

- [ ] **Step 1: Write the failing tests.**
  - `suggestHelpers` on the permit fixture gives `allOk`, `thresholds` and `now` for the right ids.
  - `crewRows` with two crew members.
  - `checkReading('18.5', { low: 19, high: 23 })` → `'low'`.
  - `checkReading('31', { high: 30 })` → `'high'`.
  - `rolloverJobs` keeps only `Pending` rows and clears their photo columns.
  - `todayRowIndex(dayGrid, '2026-10-28')` → 27.
  - `draftPeriod` for each of the three cases, and `periodLabel` for each form of period.
  - `defaultNotFinished(['Completed', 'In progress'])` → `'In progress'`.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and confirm they pass.**
- [ ] **Step 5: Commit.** `feat(forms): helper rules`

### Task 12: Data layer v3, backup and handover

**Files:**
- Modify:
  - Domain: `src/domain/types.ts`
  - Database: `src/db/schema.ts`, `src/db/records.ts`
  - Backup: `src/backup/envelope.ts`, `src/backup/service.ts`
  - UI: `src/ui/importReview.ts`, `src/ui/screens/Settings.tsx`, `src/ui/settingsView.ts`
- Create: `src/db/forms.ts`
- Test: `src/db/migrationV3.test.ts`, `src/db/forms.test.ts`, additions to `src/backup/service.test.ts` and `src/ui/importReview.test.ts`; e2e addition in `e2e/backup.spec.ts`

**Interfaces:**
- Produces (types):
  - `interface FormTemplate extends BaseRecord { code: string; title: string; revision: string; kind: FormKind; fileName: string; fileBase64: string; schema: FormSchema; setup: FormSetup }`. Scope is `'personal'`; there is no `shipId`.
  - `FormSetup`, `DraftValues` and the other form types are imported (type-only) from `src/forms/types.ts`.
  - `interface FormDraft extends BaseRecord { shipId: string; templateId: string; code: string; period: string; values: DraftValues; photoIds: string[] }`.
  - `interface FormLastValues extends BaseRecord { shipId: string; code: string; values: DraftValues }`.
  - `interface FormPhoto extends BaseRecord { shipId: string; draftId: string; jpegBase64: string; width: number; height: number }`.
  - `TableName` and `TABLE_NAMES` gain `'formTemplates' | 'formDrafts' | 'formLastValues' | 'formPhotos'`, appended.
- **Schema:** `version(3).stores({ formTemplates: 'id, code', formDrafts: 'id, shipId, templateId', formLastValues: 'id, shipId, code', formPhotos: 'id, shipId, draftId' })`. The upgrade is an `async` callback that awaits `snapshotInUpgrade(tx)`.
- **Records:**
  - `createRecord(db, table, fields, opts?: { scope?: Scope })`. The default scope stays `'ship'`.
  - `softDelete` on `formPhotos` also sets `jpegBase64: ''`, so tombstones carry no image.
- **`src/db/forms.ts`:**
  - `saveTemplate(db, input: { fileName: string; bytes: Uint8Array; kind: FormKind; schema: FormSchema; setup: FormSetup }): Promise<FormTemplate>`.
  - `listTemplates(db)`.
  - `openDraft(db, shipId, template, period): Promise<FormDraft>`. Returns the live draft for that template and ship (the newest if a merge left two), or creates one with `period`.
  - `saveDraftValues(db, draftId, values)`.
  - `addPhoto(db, shipId, draftId, jpeg: Uint8Array, width: number, height: number): Promise<FormPhoto>`.
  - `photosFor(db, draftId): Promise<Record<string, Uint8Array>>`: live photos by id, decoded.
  - `lastValuesFor(db, shipId, code): Promise<FormLastValues | undefined>`: the newest live one.
  - `closeDraft(db, draftId, values: DraftValues, rollover?: { period: string; values: DraftValues }): Promise<void>`. In one transaction it upserts `formLastValues`, soft-deletes the draft and its photos, and creates the rollover draft when one is given.
  - `discardDraft(db, draftId)`.
- **Backup:**
  - `assertWellFormed`: `formTemplates` need `scope === 'personal'`, a string `fileBase64`, and object `schema`/`setup`. Every other new table needs `shipId`.
  - `collectHandover(t, shipId, opts: { includeLibrary: boolean })` adds the live `formTemplates` when the option is on.
  - `exportBackup` passes `includeLibrary` through for a handover.
  - `MAX_BACKUP_FILE_BYTES = 128 * 1024 * 1024`.
  - `importReview` names the new tables. A template conflict is titled `Form <code>`, and its changed fields are `Revision` and `Setup`.
- **Settings:** the handover export gets the checkbox `Include forms library`, ticked by default.

- [ ] **Step 1: Write the failing tests.**
  - **migrationV3:** a v2 database with data opens as v3, with one `before-update` snapshot and the data unchanged.
  - **forms:**
    - `closeDraft` writes the last values, tombstones the draft and empties the photos;
    - a failure inside writes nothing (`holdWrites`-style spy, as in the base tests);
    - there is one live draft per template and ship.
  - **service:**
    - a full backup round-trips templates (`fileBase64` intact) and drafts;
    - a handover with `includeLibrary: false` has no templates;
    - a handover never carries another ship's drafts.
  - **importReview:** the size message says 128 MB.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and confirm they pass.** Also run the full `npm test` (the generic merge and backup now cover 10 tables).
- [ ] **Step 5: Commit.** `feat(forms): data layer v3, backup and handover`

### Task 13: Revisions

**Files:**
- Create: `src/forms/revision.ts`
- Modify: `src/db/forms.ts` (`replaceTemplate`)
- Test: `src/forms/revision.test.ts`, additions to `src/db/forms.test.ts`

**Interfaces:**
- Produces:
  - `mapRevision(oldSchema: FormSchema, newSchema: FormSchema): { map: Record<string, string>; unmatched: string[] }`.
    - Match by `(section, normaliseLabel(label), kind)`.
    - Then by the order of the remaining fields within the same section.
    - Group columns match the same way, inside matched groups.
  - `migrateValues(values: DraftValues, map: Record<string, string>): { values: DraftValues; dropped: string[] }`.
  - `replaceTemplate(db, oldId, newInput): Promise<{ template: FormTemplate; unmatched: string[]; droppedFromDrafts: number }>`. It keeps the old id. It maps the setup links, the leftEmpty list, the helper ids, the last values and every open draft, all in one transaction.

- [ ] **Step 1: Write the failing tests.**
  - A revision of the toolbox fixture, with one field renamed and one added, maps everything else.
  - `unmatched` lists the new field.
  - `open_draft_migrates` (Review Focus 4): an open draft keeps its values under the new ids, and `droppedFromDrafts` counts the removed field.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and confirm they pass.**
- [ ] **Step 5: Commit.** `feat(forms): import a new revision of a form`

### Task 14: Forms tab, import and setup review (UI)

**Files:**
- Create: `src/ui/screens/Forms.tsx`, `src/ui/screens/FormSetup.tsx`, `src/ui/formsView.ts`, `src/forms/load.ts` (dynamic-import wrapper)
- Modify: `src/ui/components/Nav.tsx` (fifth item `Forms`, between Ship and Profiles, with a document icon), `src/app/router.ts` (`/forms`, `/forms/:id/setup`, `/forms/:id/fill`), `src/app/App.tsx` (`SCREENS`), `src/app/scrollMemory.ts` (`/forms` is a list route)
- Test: `src/ui/formsView.test.ts`, `e2e/forms.spec.ts` (part 1)

**Interfaces:**
- Consumes: Tasks 9–13, the base `useAppState`, `useLive`, `ConfirmDialog`, `reportError` and the flash queue.
- Produces:
  - `loadFormsEngine(): Promise<typeof import('../forms/engine') & typeof import('../forms/autofill') & typeof import('../forms/helpers') & typeof import('../forms/revision')>`.
  - **The Forms screen:**
    - `Import form` (a file input accepting `.docx,.dotx,.xlsx`, reset after reading, file name shown);
    - a search box;
    - a list `<ul aria-label="Forms">` of `<code> · <title> · Rev <revision>`, linking to fill;
    - a secondary `Set up` link per row;
    - section `In progress` with the active ship's drafts (`<code> <title> — <period>`).
  - **Import:**
    - Run `importForm`.
    - If a template with the same non-empty code exists, show the ConfirmDialog `Replace Revision <old> with Revision <new>?`.
    - Then navigate to `/forms/:id/setup`.
    - A `FormFileError` message shows with `role="alert"`.
  - **Setup review:**
    - heading `Set up <code>`;
    - sections `Filled for you` (with a link selector per field), `You fill`, `Left empty`, `Can't be filled here`, `Helpers` (switches), `OK word` (text, default `Satisfactory`) and `Not finished value` (only when `jobLog` applies);
    - `Save form`.
    - Every field row has a selector: a data link, `You fill` or `Leave empty`. Changing it moves the field between the sections.
    - Low-confidence fields are listed first in `You fill`, with an inline `Name this field` text input.
  - **After a revision replace:** the setup screen shows `New fields to check: <labels>` for `unmatched`, and `<n> values in open drafts could not be carried over.` when `droppedFromDrafts > 0`.
  - **Drafts and templates:** a draft finds its template by `templateId`, else by the live template with the same code. A draft with neither is listed as `<code> — import this form to continue`.

- [ ] **Step 1: Write the failing tests.**
  - **Unit:** `formsView` sorting by code, then title; search over code, title and revision; the `In progress` row text.
  - **E2E part 1:**
    - Write the fixtures with `writeFormFixtures`.
    - Import `toolbox.docx` and expect the setup heading `Set up TST-01`.
    - `Filled for you` lists `Vessel` and `Date`, and `Left empty` lists `Signature`.
    - Save, and the Forms list shows `TST-01 · Toolbox Talk · Rev 00 / 01.01.2026`.
    - Importing `old.doc` (4 CFB magic bytes) shows the old-format message.
    - Importing toolbox again (with a fixture variant revision `01`) shows the replace dialog.
    - No horizontal scroll at 360 px.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.** Also check that the engine chunk is separate. Run `npm run build` and confirm `dist/assets` has a `forms`/`engine` chunk listed in `sw.js`, and that the main chunk grew by less than 15 kB gzip.
- [ ] **Step 4: Run them and confirm they pass.**
- [ ] **Step 5: Commit.** `feat(forms): Forms tab, import and setup review`

### Task 15: Fill screen and making the file

**Files:**
- Create: `src/ui/screens/FormFill.tsx`, `src/ui/components/FormField.tsx`, `src/ui/components/RowGroup.tsx`, `src/ui/formFill.ts` (pure: build sections, merge auto values, validation)
- Test: `src/ui/formFill.test.ts`, `e2e/forms.spec.ts` (part 2)

**Interfaces:**
- Consumes: Tasks 9–14, the base `shareOrDownload` (returns `'shared' | 'downloaded' | 'cancelled'`) and `parseDecimal`.
- Produces:
  - **Fill screen:**
    - heading `<code> <title>` and a period line;
    - fields grouped by section in document order;
    - inputs by kind: `text` is a textarea when the label contains `Remarks`/`Description`/`Comments`; `date` is `type=date`; `time` is `type=time`; `number` is `type=text inputmode=decimal`; `checkbox`; `choice` is segmented buttons up to 4 options, otherwise a select; `picture` comes in Task 16.
    - row groups list their rows, with `Add row` while under capacity or growable, and `Remove` per row;
    - auto values appear in their fields, marked `Auto`, and can be edited (an edit wins over a later auto value);
    - every change saves to the draft (debounced 300 ms; the last change is flushed on leaving the screen).
  - **`Make file`:**
    1. It loads the engine.
    2. It calls `makeFile`.
    3. It passes the result to `shareOrDownload`.
    4. On `shared`/`downloaded` it calls `closeDraft` (with rollover when `jobLog` applies) and flashes `File made: <file name>`.
    5. On `cancelled` it keeps the draft and shows `File not shared — your draft is still here.`.
    6. An `IntegrityError` shows its message, and the draft stays.
  - **`Discard draft`:** a ConfirmDialog (`Discard this draft?` / `Discard draft`).
  - The busy pattern is `aria-disabled` plus a ref guard.

- [ ] **Step 1: Write the failing tests.**
  - **Unit:** sections in document order; an edited auto value wins; number parsing.
  - **E2E part 2:**
    - Import and save the toolbox form, then open it.
    - `Vessel` is prefilled with the ship name.
    - Fill `Subject` and make the file.
    - The downloaded `.docx`, read back in the spec by importing `readPackage`, `detectWord` and `readWordValues` from `src/forms` directly, has the values.
    - The Forms list's `In progress` is empty.
    - `cancelled_share_keeps_draft` (Review Focus 5): stub `navigator.share` with an AbortError, then `Make file` → the message appears and the draft is still listed.
    - Large fixture: `inventory.xlsx` with 120 rows renders the fill screen and scrolls to the end. Typing in the last row's Qty is saved.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and confirm they pass.**
- [ ] **Step 5: Commit.** `feat(forms): fill screen and making the file`

### Task 16: Helpers in the fill screen

**Files:**
- Create: `src/ui/components/CrewPicker.tsx`, `src/ui/components/JobLog.tsx`, `src/ui/photo.ts` (downsize: `downsizeImage(file: Blob, longest = 1600, quality = 0.8): Promise<{ jpeg: Uint8Array; width: number; height: number }>` via `createImageBitmap` + canvas; pure `fitWithin(w, h, longest)` unit-tested)
- Modify: `src/ui/screens/FormFill.tsx`, `src/ui/components/RowGroup.tsx`, `src/ui/components/FormField.tsx`
- Test: `src/ui/photo.test.ts`, `e2e/forms.spec.ts` (part 3)

**Interfaces:**
- Consumes: Task 11 helpers, Task 12 `addPhoto`.
- Produces:
  - **Pick from crew:** `Add from crew` opens a dialog listing the crew onboard at the draft date, as checkboxes, and fills the next free rows. In a job log the `Responsible` column uses the same list, as a single choice.
  - **All OK:** `All <okWord>` (for tick fields, `All Yes` with the matching option) per section or group. It sets only fields that are still empty unless the user confirms `Replace answers already given?`. When a row is changed to any other answer and the row has a Remarks field, that field is shown under it and focused.
  - **Today's row:** the day grid shows only today's row by default, with a `Show all days` toggle.
  - **Start from last:** a new draft is pre-filled from the last values. Each row shows `Last: <value>` under its inputs.
  - **Job log:** `Add job` adds a row with today's date and the status `notFinished`. `Add photo` uses `<input type=file accept="image/*" capture="environment">`, downsizes the image, stores it with `addPhoto`, and sets the picture field. The `Photo` choice (Before/After) sits next to each photo.
  - **Thresholds:** after a reading is entered, an inline warning, for example `O2 18.5 — below 19.5` or `CO 31 — above 25`, with `role="alert"`. Never written to the file.
  - **Now:** a `Now` button next to each time field and time column, inserting the ship's `HH:mm`.

- [ ] **Step 1: Write the failing tests.**
  - **Unit:** `fitWithin(4000, 3000, 1600)` → `{ width: 1600, height: 1200 }`, and small images are unchanged.
  - **E2E part 3:**
    - **Toolbox:** `Add from crew` ticks 2 people → 2 rows with name and rank.
    - **Permit:**
      - `All Yes` sets every Section 1 row.
      - An O2 reading of `18.5` shows the warning.
      - `Now` fills `14:00` (clock 2026-10-28T13:00Z at UTC+1).
    - **Weekly:**
      - Add 2 jobs (one Pending) and 1 photo (a generated 10×10 PNG via `setInputFiles` with a buffer).
      - Make the file: the output has a jpeg part.
      - A new draft exists with the Pending job only.
    - **Day grid:** opens on day 28.
    - **Inventory:** a second draft shows `Last: <qty>`.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and confirm they pass.**
- [ ] **Step 5: Commit.** `feat(forms): helpers in the fill screen`

### Task 17: Home card, README and full verification

**Files:**
- Modify: `src/ui/screens/Home.tsx`, `src/ui/homeView.ts`, `README.md` (section `SMS forms`)
- Test: additions to `src/ui/homeView.test.ts` and `e2e/home.spec.ts`

**Interfaces:**
- Produces:
  - **Home section `Forms in progress`:** one line per live draft of the active ship, as `<code> <title> — <period>`, linking to fill. A day-grid draft without today's row filled reads `<code> <title> — today's row not entered`.
  - **README `SMS forms`:**
    - import once;
    - fill on the phone;
    - `Make file` and print from Word/Excel on the laptop;
    - signatures by hand;
    - `.doc`/`.xls` must be saved as `.docx`/`.xlsx` first;
    - forms stay on your devices.

- [ ] **Step 1: Write the failing tests.** The `homeView` text for both cases; the e2e card links to the fill screen.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the full verification.** `npm run typecheck && npm test && npx playwright test && npm run build` → all pass. Report the exact lines.
- [ ] **Step 5: Commit.** `feat(forms): Home card and README`

### Task 18: Acceptance with the user's real forms (controller, local only, never committed)

- [ ] **Step 1:** The controller runs a throwaway Node script from the scratchpad. The script imports the built `src/forms` modules through `vite-node` or a scratch build. It is never added to the repo.
- [ ] **Step 2:** For each of the 16 sample forms in the scratchpad (`sms-in/<code>/form.*`):
  - run `importForm`, and print the field and row-group counts and the unsupported list;
  - fill every field with a sample value, every group to capacity + 1, and one photo where pictures exist;
  - run `makeFile`;
  - re-read the output, and check that `verifyOutput` passes;
  - open the docx output with a second parser (SheetJS for xlsx; a fresh `readPackage` + `parseXml` of every part for docx).
- [ ] **Step 3:** Report the per-form results to the user, in plain language, with the files to print on the ship's laptop. Fix every engine defect found, through an implementer task with a synthetic fixture that reproduces the pattern. Never use the company file itself.

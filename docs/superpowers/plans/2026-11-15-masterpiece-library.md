# Knowledge Library (Piece 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** an offline library of the user's own documents (PDF, DOCX, XLSX and images): text indexed at import,
searchable inside, viewed in the app, and moved between devices as separate encrypted library files.

**Architecture:**
- **Metadata** (`libraryDocs`, `libraryFolders`) is syncable and personal, so it rides in snapshots, backups and the merge.
- **Files and text** (`libraryFiles`, `libraryText`) are local-only Dexie tables.
- **Lazy code:** everything heavy lives in one lazy `library` chunk: pdf.js, extraction, viewer and `.mplib` code.

**Tech Stack:** Preact 11, TypeScript, Dexie 4, fflate, @xmldom/xmldom, SheetJS, **pdfjs-dist@6.4.299 (new, exact)**, Vitest, Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-11-15-masterpiece-library-design.md`. Read it before each task.

## Global Constraints

- All of `.superpowers/sdd/2026-10-25-masterpiece-base/global-constraints.md` applies, with one exception: the dependency
  `pdfjs-dist@6.4.299` is added, pinned exactly (`npm i pdfjs-dist@6.4.299 --save-exact`).
- **Never commit** company documents, real crew data or real hydrostatics. Test files are generated in the tests.
- **The main chunk must not import any of these**, except through `lazyScreen(() => import(...))`:
  - `src/library/**`;
  - `src/ui/screens/library/**`;
  - `pdfjs-dist`.
- **Main chunk size:** gzip growth ≤ 1.0 kB. The routes, the Home card, the types and the table names are allowed.
- **Limits:** one file ≤ 100 MB (`MAX_LIBRARY_FILE_BYTES = 100 * 1024 * 1024`). A library part is ≤ 100 MB
  (`LIBRARY_PART_BYTES`, injectable for tests).
- **Statuses:** `textStatus: 'indexed' | 'no-text' | 'failed' | 'not-supported'`. A PDF is `no-text` when its average
  is < 20 characters per page.
- **Kinds:** `kind: 'pdf' | 'docx' | 'xlsx' | 'image' | 'other'`.
  - Images are `image/jpeg` and `image/png`.
  - `.doc`, `.xls` and anything else is `other`, which is stored with no text and no viewer.
- **Search:** text is normalised as lowercase, with NFD diacritics removed and whitespace collapsed. Words shorter than 2
  characters are dropped. Matching is by substring. A document matches when every word appears in its title, tags and
  folder name together, or inside one part. Results:
  - up to 50 documents;
  - at most 3 parts each;
  - snippets of about 160 characters.
- **Recently deleted:** kept for 30 days. Purging removes the `libraryFiles` and `libraryText` rows. The record stays as
  a tombstone.
- **`.mplib` format:**
  - It starts with a JSON header line terminated by `\n`:
    `{"format":"masterpiece-library","version":1,"exportId","part","parts","salt","iv","iterations"}`.
  - The rest is the AES-GCM ciphertext of a stored (uncompressed) zip holding `manifest.json` and `files/<docId>`.
  - The key is derived with PBKDF2-SHA-256, 600,000 iterations (as for backups); reuse `src/backup/crypto.ts`.
  - File name: `Masterpiece-library-YYYY-MM-DD-part-n-of-m.mplib`.
- **UI copy** (exact):
  - "No searchable text";
  - "File not on this device";
  - "This is a different file. Use it anyway?";
  - "Already in the library as ‹title›. Import again?";
  - "Indexing ‹title›: page N of M";
  - "Recently deleted";
  - "Open with…";
  - "Export library";
  - "Import library".

## Review Focus

1. **A large PDF of 500 pages or more during import.** Expected: the progress line updates, the screen stays usable,
   and memory stays bounded (pages are processed one at a time). Pinned in Task 3: a generated 600-page PDF test on the
   timing and yield checks.
2. **An encrypted or broken PDF, and a 0-byte file.** Expected: the file is stored with status `failed` and a message,
   and the import never crashes. Pinned in Task 3.
3. **Importing library parts out of order, twice, or a part with the wrong password.** Expected: the order doesn't
   matter, a second import adds nothing, and a wrong password says so and writes nothing. Pinned in Task 6.
4. **Search for text with diacritics or in mixed case, and 1-letter words.** "Šifra" must match "sifra". Expected:
   case and diacritics are ignored, and 1-letter words are dropped. Pinned in Task 2.
5. **Storage full while importing.** Expected: the existing storage-full error, and no half-written document: the
   record, the file and the text are written in one transaction. Pinned in Task 1.

---

## File Structure

- **`src/domain/types.ts`:** `LibraryDoc`, `LibraryFolder`. `TableName` and `TABLE_NAMES` gain `'libraryDocs'` and
  `'libraryFolders'`, appended last. `ShipTableName` excludes them.
- **`src/db/schema.ts`:** version 4, with the tables `libraryDocs: 'id, folderId, sha256'`, `libraryFolders: 'id'`,
  `libraryFiles: 'docId'` and `libraryText: 'id, docId'`. The upgrade calls `snapshotInUpgrade`.
- **`src/db/library.ts`:** reads and writes the library tables.
- **`src/library/search.ts`:** pure search, normalising and snippets.
- **`src/library/extract/`:** `pdf.ts`, `docx.ts`, `xlsx.ts`, `index.ts` (`kindOf`, `extract`), `hash.ts`.
- **`src/library/mplib.ts`:** packing, encrypting and reading library parts.
- **`src/backup/service.ts`:** handovers also carry the live `libraryDocs` and `libraryFolders`.
- **`src/ui/screens/library/`:**
  - `Library.tsx` (list, search, import, folders, recent, storage);
  - `DocDetails.tsx`;
  - `Viewer.tsx`, `PdfView.tsx`, `DocxView.tsx`, `XlsxView.tsx`, `ImageView.tsx`;
  - `LibraryFiles.tsx` (export and import parts);
  - `library.css`.
- **Routes and links:** `src/app/router.ts` and `src/app/App.tsx` get the routes `/library`, `/library/deleted`,
  `/library/files` and `/library/doc/:id`. `Home.tsx` gets the card.
- **`vite.config.ts`:** precache patterns gain `mjs`, `pfb` and `bcmap`. `maximumFileSizeToCacheInBytes` is raised to
  `5 * 1024 * 1024`. pdf.js assets (the worker, `standard_fonts/` and `cmaps/`) are copied into the build output under
  `pdfjs/`.
- **E2E:** `e2e/library.spec.ts`, plus `e2e/fixtures/makePdf.ts` (a minimal PDF writer: text pages, and an image-only
  page).

---

### Task 1: Data layer

**Files:**
- Modify:
  - `src/domain/types.ts`
  - `src/db/schema.ts`
  - `src/backup/service.ts`
- Create: `src/db/library.ts`
- Tests:
  - `src/db/library.test.ts`
  - `src/db/migrationV4.test.ts`
  - additions to `src/backup/service.test.ts`

**Interfaces (Produces):**

```ts
export type LibraryKind = 'pdf' | 'docx' | 'xlsx' | 'image' | 'other';
export type TextStatus = 'indexed' | 'no-text' | 'failed' | 'not-supported';
export interface LibraryDoc extends BaseRecord { scope: 'personal'; title: string; folderId?: string; tags: string[]; fileName: string;
  mimeType: string; kind: LibraryKind; size: number; sha256: string; pageCount?: number; textStatus: TextStatus; textError?: string;
  addedAt: string; openedAt?: string; deletedAt?: string }
export interface LibraryFolder extends BaseRecord { scope: 'personal'; name: string }
export interface LibraryTextRow { id: string; docId: string; part: number; label: string; text: string }   // text already normalised
export interface LibraryFileRow { docId: string; blob: Blob }
// db/library.ts
export interface NewDocument { title: string; folderId?: string; tags: string[]; fileName: string; mimeType: string; kind: LibraryKind;
  size: number; sha256: string; pageCount?: number; textStatus: TextStatus; textError?: string; blob: Blob; parts: Omit<LibraryTextRow, 'id' | 'docId'>[] }
export function addDocument(db: MasterpieceDB, doc: NewDocument): Promise<LibraryDoc>;          // record + file + text in ONE rw transaction
export function listDocuments(db: MasterpieceDB, opts?: { deleted?: boolean }): Promise<LibraryDoc[]>;
export function findBySha(db: MasterpieceDB, sha256: string): Promise<LibraryDoc | undefined>;   // live docs only
export function updateDocument(db: MasterpieceDB, id: string, patch: Partial<Pick<LibraryDoc, 'title' | 'folderId' | 'tags' | 'openedAt'>>): Promise<LibraryDoc>;
export function deleteDocument(db: MasterpieceDB, id: string, now: Date): Promise<void>;         // soft: deleted=true, deletedAt
export function restoreDocument(db: MasterpieceDB, id: string): Promise<void>;
export function purgeDeleted(db: MasterpieceDB, now: Date): Promise<number>;                     // > 30 days: drop file+text rows
export function attachFile(db: MasterpieceDB, id: string, blob: Blob, extracted: Pick<NewDocument, 'pageCount' | 'textStatus' | 'textError' | 'parts'> & { sha256: string }): Promise<void>;
export function getFile(db: MasterpieceDB, id: string): Promise<Blob | undefined>;
export function hasFiles(db: MasterpieceDB): Promise<Set<string>>;                               // docIds with a file
export function allText(db: MasterpieceDB): Promise<LibraryTextRow[]>;
export function listFolders(db: MasterpieceDB): Promise<LibraryFolder[]>;
export function saveFolder(db: MasterpieceDB, name: string, id?: string): Promise<LibraryFolder>;
export function deleteFolder(db: MasterpieceDB, id: string): Promise<void>;                      // its docs move to no folder
```

- Records are built with the existing record helpers in `src/db/records.ts` (timestamps, `updatedBy`, scope). Follow
  `src/db/forms.ts` for templates.
- In the backup service, handovers always include the live personal `libraryDocs` and `libraryFolders`. Full backups
  carry them already, through `TABLE_NAMES`.
- Check every `TABLE_NAMES` / `SHIP_TABLES` consumer (`grep -rn "TABLE_NAMES\|SHIP_TABLES\|formTemplates" src`) for
  special cases that personal tables need, and treat the library tables like `formTemplates`.

- [ ] **Step 1: Write failing tests:**
  - `addDocument` writes the record, file and text rows together. If a write fails (stub `libraryText.bulkAdd` to
    throw), nothing is left behind.
  - `findBySha` ignores deleted documents.
  - `purgeDeleted` at +31 days removes the file and text rows, keeps the tombstone, and returns 1. At +29 days it
    returns 0.
  - `deleteFolder` moves the folder's documents to no folder.
  - The v3 → v4 migration keeps the existing data and makes empty library tables.
  - A snapshot contains `libraryDocs` and not `libraryFiles`.
  - A handover includes the live `libraryDocs`.
  - An old backup without the library tables still imports.
- [ ] **Step 2:** Run `npx vitest run src/db src/backup`. Expected: the new tests fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run && npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit with the message `Add library data layer (schema v4)`.

### Task 2: Search

**Files:**
- Create: `src/library/search.ts`
- Test: `src/library/search.test.ts`

**Interfaces (Produces):**

```ts
export function normaliseText(s: string): string;                 // lowercase, NFD strip marks, collapse whitespace
export function queryWords(q: string): string[];                  // normalised, length >= 2, unique
export interface SearchHit { docId: string; byMeta: boolean; parts: { part: number; label: string; snippet: string }[]; moreParts: number }
export function searchLibrary(input: { docs: LibraryDoc[]; folders: LibraryFolder[]; text: LibraryTextRow[]; query: string }): SearchHit[];
export function highlightRanges(snippet: string, words: string[]): [number, number][];
```

- Live documents only.
- **Rank:**
  1. `byMeta` first;
  2. then more matching parts;
  3. then the latest `openedAt ?? addedAt`.
- **Snippet:** about 160 characters centred on the first match of the first word. It is cut at word edges, with `…` on
  each side that was cut.

- [ ] **Step 1: Write failing tests:**
  - "Šifra" matches the text "sifra broda";
  - every word must match within one part (no mixing of parts);
  - a meta match combined with a text match;
  - 1-letter words are dropped;
  - at most 3 parts, plus `moreParts`;
  - the 50-document cap;
  - snippet edges and `…`;
  - `highlightRanges` for overlapping words;
  - **performance:** 2,000 parts of about 2,000 characters each, searched in < 300 ms under Node.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run src/library`. Expected: PASS.
- [ ] **Step 5:** Commit with the message `Add library search`.

### Task 3: Text extraction and pdf.js setup

**Files:**
- Create:
  - `src/library/extract/{index,pdf,docx,xlsx,hash}.ts`
  - `src/library/pdfjs.ts`
  - `e2e/fixtures/makePdf.ts`, which the unit tests may import too
- Modify:
  - `package.json` (pdfjs-dist, exact)
  - `vite.config.ts`
- Test: `src/library/extract/extract.test.ts`

**Interfaces (Produces):**

```ts
export function kindOf(fileName: string, mimeType: string): LibraryKind;
export function sha256Hex(data: ArrayBuffer): Promise<string>;
export interface Extracted { pageCount?: number; textStatus: TextStatus; textError?: string; parts: { part: number; label: string; text: string }[] }
export function extract(kind: LibraryKind, data: ArrayBuffer, onProgress?: (done: number, total: number) => void): Promise<Extracted>;
// pdfjs.ts — the one place pdf.js is configured (worker URL, standardFontDataUrl, cMapUrl under `pdfjs/`)
export function loadPdf(data: ArrayBuffer | Uint8Array): Promise<import('pdfjs-dist').PDFDocumentProxy>;
// e2e/fixtures/makePdf.ts
export function makePdf(pages: (string[] | 'image')[]): Uint8Array;  // each page: lines of Helvetica text, or an image-only page
```

**Rules:**
- **PDF:**
  - each page's text comes from `getTextContent`;
  - `label` is `Page N`;
  - the code yields with `await new Promise(r => setTimeout(r))` every 10 pages;
  - a password-protected or unreadable PDF gives `failed`, with `textError` "Protected or damaged PDF";
  - an average under 20 characters per page gives `no-text`, with no parts.
- **DOCX:** one part, `Document`, with the text of `w:t` in paragraph order and a newline per paragraph and per table
  cell. Use fflate `unzipSync` and xmldom.
- **XLSX:** one part per sheet, `Sheet ‹name›`, with the cell values joined by spaces row by row. Use the existing lazy
  SheetJS loader.
- **Image and other:** `not-supported`, with no parts.
- **0 bytes:** `failed`, with "Empty file".
- **Tests run pdf.js in Node** with `pdfjs-dist/legacy/build/pdf.mjs` and no worker (`disableWorker`); this is allowed
  in tests only.

- [ ] **Step 1: Write failing tests:**
  - A 3-page `makePdf` gives 3 parts, with "Page 2" holding its text.
  - An image-only page gives `no-text`.
  - Random bytes with a `.pdf` name give `failed`.
  - 0 bytes give "Empty file".
  - A generated docx, with a paragraph and a table, gives its text in order.
  - A generated xlsx with 2 sheets gives 2 parts.
  - `kindOf` for `.PDF`, `.docx`, `.xlsx`, `.jpg`, `.doc` and `.txt`.
  - `sha256Hex` of "abc" is `ba7816bf…`.
  - **A 600-page PDF** is extracted with `onProgress` reaching 600 and at least 60 yields.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Install `pdfjs-dist@6.4.299` and implement. Copy the pdf.js `build/pdf.worker.min.mjs`,
  `standard_fonts/` and `cmaps/` into `dist/pdfjs/` with a small Vite plugin in `vite.config.ts`, using `fs.cpSync`
  in `closeBundle` or `generateBundle`. Add `mjs`, `pfb` and `bcmap` to the precache patterns, and set
  `maximumFileSizeToCacheInBytes: 5 * 1024 * 1024`.
- [ ] **Step 4:** Run `npx vitest run src/library && npm run build && ls dist/pdfjs`. Expected: PASS, and the worker,
  fonts and cmaps are present.
- [ ] **Step 5:** Commit with the message `Add library text extraction and pdf.js`.

### Task 4: Library screen: import, list, organise, delete

**Files:**
- Create:
  - `src/ui/screens/library/{index.ts,Library.tsx,DocDetails.tsx,library.css}`
  - `src/library/importFiles.ts`
  - `e2e/library.spec.ts`
- Modify:
  - `src/app/router.ts`, `src/app/App.tsx`: the routes are lazy, and all of them import `../ui/screens/library`.
  - `src/ui/screens/Home.tsx`: a "Library" card with the line "Your manuals and documents, searchable offline".

**Interfaces:**
- Consumes: Tasks 1 to 3.
- Produces:

```ts
export function importFiles(db, files: File[], hooks: { confirmDuplicate(title: string): Promise<boolean>; progress(text: string): void }): Promise<{ added: LibraryDoc[]; failed: { name: string; message: string }[] }>;
```

**Behaviour:**
- `importFiles` refuses files over 100 MB with the message "‹name› is over 100 MB". The title is the file name without
  its extension.
- The progress text uses the exact copy "Indexing ‹title›: page N of M".
- **Library page:**
  - a search box, wired to Task 5;
  - folder chips: "All", each folder, and "+ Folder";
  - a sort select: Title, Date added, Last opened;
  - the list rows show title, kind, size in MB, pages, and a status label for `no-text`, `failed` and missing files;
  - a "Recently opened" list of the last 5;
  - storage use (`navigator.storage.estimate`, used of quota);
  - an "Import documents" button (multiple, accepting `.pdf,.docx,.xlsx,.jpg,.jpeg,.png,.doc,.xls`);
  - a link to "Recently deleted";
  - a link to library files (Task 6).
- `purgeDeleted(now)` runs once on open.
- **DocDetails** (a dialog or section on the doc route header):
  - rename; folder select; tags (comma-separated input);
  - Open with… (`navigator.canShare?.({ files })` then `navigator.share`, else download through an object URL);
  - Delete, with Undo shown in the flash;
  - "Attach file" for a missing file, using the sha check and the "This is a different file. Use it anyway?" copy.
- **`/library/deleted`:** lists the deleted documents with "Deleted ‹date› · removed after ‹date+30›", Restore, and
  Delete now (which purges immediately).

- [ ] **Step 1: Write failing e2e tests:**
  - Import a generated 3-page PDF and a docx; both are listed, and the PDF shows "3 pages".
  - An image-only PDF shows "No searchable text".
  - Importing the same PDF again asks the duplicate question; Cancel adds nothing.
  - Rename, a folder, and tags persist after a reload.
  - Delete, then Undo; delete again and the document is in Recently deleted; Restore.
  - After going offline and reloading, the library opens (precache).
  - 360 px with no horizontal scroll.
- [ ] **Step 2:** Run `npx playwright test e2e/library.spec.ts --trace off`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx playwright test e2e/library.spec.ts --trace off && npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit with the message `Add library screen: import, organise, delete`.

### Task 5: Search UI and viewers

**Files:**
- Create:
  - `src/ui/screens/library/{Viewer,PdfView,DocxView,XlsxView,ImageView}.tsx`
  - the search results in `Library.tsx`
- Test: e2e in `e2e/library.spec.ts`

**Behaviour:**
- **Search results:**
  - search runs on input, debounced by 200 ms;
  - each result shows title, then its part rows ("Page 3 — …snippet…") with `<mark>` highlights, then "+N more pages";
  - tapping a part opens `#/library/doc/<id>?page=3&q=<query>`;
  - tapping the title opens page 1;
  - meta-only matches are shown with their status label;
  - opening a document sets `openedAt`.
- **Viewer:** reads `page` and `q` from `location.hash` itself.
  - **PDF:**
    - render pages lazily, the visible page ±2, onto canvas at device pixel ratio;
    - a pdf.js text layer is laid over each page, with `<mark>` on the query words;
    - toolbar: back, page `n / N` (an editable go-to field), previous and next, zoom − and +, and fit width;
    - Find: a field with next and previous match across pages, using the stored text to find pages, then the text
      layer to highlight;
    - Open with….
  - **DOCX:** render paragraphs, headings (`w:pStyle` Heading1–3 become h2–h4) and tables as HTML from
    `word/document.xml`, with query words marked and the view scrolled to the first match.
  - **XLSX:** sheet tabs, each sheet a table (SheetJS `sheet_to_html`, sanitised by building the cells into the DOM, no
    `innerHTML` of file content), with query words marked.
  - **Image:** the image is shown fit to width, with zoom.
  - **Other:** "This file opens in another app" and Open with….
- Never insert file content with `innerHTML`.

- [ ] **Step 1: Write failing e2e tests:**
  - Import a PDF whose page 3 has "ballast exchange". Searching "BALLAST exch" gives the result "Page 3" with a snippet.
    Tapping it opens the viewer showing "3 / 3", with a `mark` in the text layer holding "ballast".
  - Find "exchange" moves to the next match.
  - A docx search opens with the word marked.
  - An xlsx sheet tab is shown with the word marked.
  - A meta-only match on an image is found by its tag.
  - No horizontal scroll at 360 px in the viewer, with fit width.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx playwright test e2e/library.spec.ts --trace off && npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit with the message `Add library search results and document viewers`.

### Task 6: Library files (`.mplib`)

**Files:**
- Create:
  - `src/library/mplib.ts`
  - `src/ui/screens/library/LibraryFiles.tsx` (route `/library/files`)
- Modify: `src/ui/screens/Settings.tsx`: one line linking to "Library files".
- Test:
  - `src/library/mplib.test.ts`
  - e2e

**Interfaces (Produces):**

```ts
export interface LibraryPart { fileName: string; bytes: Uint8Array }
export function packLibrary(input: { docs: LibraryDoc[]; folders: LibraryFolder[]; files: Map<string, Blob> }, password: string,
  opts: { now: Date; partBytes?: number; iterations?: number }): Promise<LibraryPart[]>;   // docs whole per part; folders in every part
export interface ReadPart { exportId: string; part: number; parts: number; docs: LibraryDoc[]; folders: LibraryFolder[]; files: Map<string, Uint8Array> }
export function readLibraryPart(bytes: Uint8Array, password: string): Promise<ReadPart>;   // throws WrongPasswordError / not a library file
export function importLibraryPart(db: MasterpieceDB, part: ReadPart, progress: (t: string) => void): Promise<{ added: number; attached: number; skipped: number }>;
```

**Behaviour:**
- **Import:**
  - Merge folders by id.
  - Docs are matched by id, then by live `sha256`. A new doc is added with its file. A known doc that has no file gets
    the file attached. Metadata follows the newer `updatedAt`. A doc that already has its file is skipped.
  - The text is extracted for every added or attached file (Task 3).
  - A snapshot (`before-import`) is taken once per import session, before the first part.
- **Export:**
  - Only live documents with a file are included. The parts are offered for download or share one by one; reuse
    `src/backup/share.ts`.
  - The password follows the backup rules (≥ 8 characters, entered twice).
- **Errors:**
  - a wrong password gives the existing backup wrong-password message;
  - a file that is not a library file gives "This is not a Masterpiece library file.".
- **Memory:** use `Uint8Array` and `Blob` throughout; no base64.

- [ ] **Step 1: Write failing tests:**
  - **Unit:**
    - round trip of 3 docs with `partBytes` small enough to make 2 parts;
    - each part reads on its own;
    - a wrong password throws;
    - a tampered byte throws;
    - importing part 2 before part 1 ends with all docs and files;
    - importing a part twice adds nothing.
  - **E2E:**
    - export the library as 2 parts (lower the part size through a test hook such as
      `localStorage['masterpiece.test.partBytes']`, read only when `import.meta.env.DEV` or the test flag is set; or
      choose fixtures big enough);
    - erase the device and import part 2, then part 1;
    - search works, and a normal backup restored first shows "File not on this device" until the parts are imported.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run src/library && npx playwright test e2e/library.spec.ts --trace off`. Expected: PASS.
- [ ] **Step 5:** Commit with the message `Add encrypted library files: export in parts, import in any order`.

### Task 7: README and full verification

- [ ] Add a README section "Library": import, search, viewer, library files, and the 100 MB limits.
- [ ] Run `npm run typecheck && npx vitest run && npx playwright test --trace off && npm run build`. Expected: all pass.
- [ ] Record the main chunk gzip size against `main` (≤ +1.0 kB) and the library chunk size.
- [ ] Commit with the message `Library: README and verification`.

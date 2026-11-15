# Masterpiece: Knowledge Library (Piece 4) Design

Date: 2026-11-15
Status: draft for user review.

## 1. Intent

The Chief Officer keeps many documents onboard: manuals, company procedures, circulars, checklists and guidance.
Today they live in PC folders and emails, and they are hard to find on the phone and slow to search. The library puts
the user's **own documents** on their devices, offline, makes them **searchable inside**, and opens them **in the app**.

Success means:
- any imported document can be found in seconds by a word inside it, its title or a tag;
- it opens at the right page with the word highlighted;
- all of this works offline at sea.

## 2. Goals

1. **Import** PDF, Word (.docx), Excel (.xlsx) and images (JPEG, PNG) from the device. Several files can be imported at
   once.
   - Each document gets a title (from the file name, editable), one folder, and any number of tags.
2. **Text index at import.**
   - The text of each PDF page, Word document and Excel sheet is extracted once and stored.
   - Scanned PDFs and images have no text. They are found by title and tags, and are marked "No searchable text".
3. **Search** across the library:
   - all words must match, in any order;
   - matching ignores case and diacritics;
   - results show the document, the page or sheet, and a short snippet with the words highlighted;
   - title and tag matches rank first.
4. **Built-in viewer:**
   - **PDF:** pages rendered in the app, fit to width, with zoom in and out, page forward and back, and go-to-page.
     There is find-in-document with next and previous match. Opening from a search result goes to that page with the
     words highlighted.
   - **Word:** shown as readable text: paragraphs, headings and tables. The original layout is not kept.
   - **Excel:** each sheet as a table, with sheet tabs.
   - **Images:** shown fit to width, with zoom.
   - Every document can also be opened in the device's own app or saved, via **Open with…**.
5. **Organise:**
   - folders, one level deep, created by the user;
   - tags;
   - rename, move and delete (soft delete);
   - sort by title, date added or last opened;
   - a "Recently opened" list.
6. **Backups:**
   - The backup and handover screens get an **Include library documents** tick, off by default, showing the library
     size.
   - If including the library would push the file over the backup limit, the export is refused with a plain message
     naming the size and the largest documents.
   - Without the tick, a backup carries the titles, folders and tags only, not the files.

## 3. Non-goals

- Built-in reference content (SOLAS, MARPOL and similar). Copyright stays with the user's own copies.
- Writing notes in the app.
- Text recognition (OCR) of scanned pages.
- Editing documents.
- Old .doc and .xls files: these are stored and opened with the device only, with no text and no viewer.
- Sync between devices other than by backup.
- Splitting a large library across several backup files. This can come later if needed.

## 4. Anti-goals

- **A wrong search answer that looks complete.** If a document could not be indexed (scanned, broken or password
  protected), it must say so. It must never be silently missing from results.
- **Making the main app slower or bigger.** The library code and the PDF reader load only when the library is opened.
- **Losing a document without warning.** Deletion is soft and can be undone, the same as other records. A storage-full
  error says what happened.

## 5. Constraints

- The base-app global constraints apply.
- **One new dependency, `pdfjs-dist@6.4.299` (pinned exactly):**
  - It is used for text extraction and the PDF viewer.
  - Its worker, standard fonts and character maps are bundled and precached, so it works offline.
  - It sits in the lazy library chunk.
  - This is a plan change to the "no other dependency" rule. The user approved it with the approach.
- **Reused code:**
  - `fflate` and `@xmldom/xmldom` read .docx text;
  - SheetJS reads .xlsx.
- **Storage:**
  - Files are stored as Blobs in IndexedDB, in a new Dexie table, with the database schema bumped by one version and
    a migration.
  - The extracted text goes in a second table, per page or sheet.
  - Records are `scope: 'personal'`, like the forms library, so they do not belong to a ship.
- **Limits:**
  - one file up to 100 MB;
  - storage usage is shown on the library screen using `navigator.storage.estimate()`;
  - the existing storage-full handling applies.
- **Privacy:** documents never leave the device except in the user's encrypted backup, and only when the tick is on.

## 6. Approaches

1. **Store files, extract the text once at import, and view in the app** (chosen, with the built-in viewer).
   - Search is fast and works offline.
   - The PDF reader is the only new code of any size.
2. **Search by reading the files at search time.** No index to store, but slow on a phone with tens of manuals.
   Rejected.
3. **Titles and tags only.** Small, but it fails the user's main need of finding a word inside a manual. Rejected.

## 7. Design

### 7.1 Data

- **`libraryDocs`:**
  - `id`, `scope: 'personal'`, `title`, `folderId?`, `tags: string[]`;
  - `fileName`, `mimeType`, `kind` (`pdf`, `docx`, `xlsx`, `image` or `other`), `size`, `sha256`;
  - `pageCount?`;
  - `textStatus` (`indexed`, `no-text`, `failed` or `not-supported`);
  - `addedAt`, `openedAt?`;
  - the base record fields (timestamps and `deleted`).
- **`libraryFiles`:** `{ docId, blob }`. The file is kept apart from the record, so that lists never load file bytes.
- **`libraryText`:** `{ id, docId, part: number, label: string, text: string }`, one row per PDF page, Excel sheet, or
  the whole Word document. The text is stored normalised for search, and the snippet comes from that same text.
- **`libraryFolders`:** `{ id, scope: 'personal', name }`, plus the base fields.
- **Duplicates:** importing a file whose `sha256` is already in the library asks "Already in the library as ‹title›.
  Import again?".

### 7.2 Import

- The import runs in the lazy chunk.
- PDF text is read page by page with pdf.js, which yields between pages so the screen stays responsive. A progress line
  shows "Indexing ‹title›: page 120 of 480".
- **Results:**
  - A PDF whose pages give almost no text (fewer than 20 characters per page on average) is marked `no-text`.
  - A file that is encrypted or broken is marked `failed`, with a message. The file is still stored, so it can be
    opened with the device.

### 7.3 Search

- **The query:** split into normalised words (lowercase, no diacritics). Words shorter than 2 characters are dropped.
- **A match:** a document matches if every word appears either in its title, tags and folder name, or within one part
  (page or sheet) of its text.
- **Ranking:**
  1. a title or tag match;
  2. then the number of parts that match;
  3. then the most recently opened.
- **Results:**
  - Up to 50 documents are listed.
  - Each document shows up to 3 matching parts, with "+N more pages" when there are more.
  - Each snippet shows about 160 characters around the first match, with every query word highlighted.
- Documents marked `no-text`, `failed` or `not-supported` appear in results only by title or tag, and carry their
  label.
- **Speed target:** about 1 s for a library of 2,000 pages on a mid-range phone, checked by a test with a made-up
  library.

### 7.4 Screens

- **Home** gets a Library card. The routes are `/library`, `/library/doc/:id` and `/library/doc/:id?page=N&q=…`.
  - The router ignores query strings, so the viewer reads `page` and `q` from `location.hash` itself.
- **Library page:**
  - a search box at the top;
  - folder chips;
  - a document list showing title, kind, size, pages and status;
  - an "Import documents" button;
  - storage use;
  - "Recently opened".
- **Document details:** rename, folder, tags, Open with…, and Delete.
- **Viewer:** as in §2.4.
  - PDF pages render on demand, about 2 pages either side of the one shown.
  - Highlights come from the pdf.js text layer.

### 7.5 Backups

- With the tick, full backups and handovers include `libraryDocs`, `libraryFolders` and the files as base64. The
  `libraryText` table is not included: it is rebuilt on import.
- Without the tick, only `libraryDocs` and `libraryFolders` are included. The documents then show "File not on this
  device", with **Import file** to re-attach the file by choosing it again. The file is matched by its `sha256`.
- Before writing the file, the export estimates its size: about 1.37 × the bytes, from base64 plus encryption. If that
  is over `MAX_BACKUP_FILE_BYTES`, it refuses with the library size and the 3 largest documents.

### 7.6 Testing

- **Unit tests:**
  - normalising and the match and ranking rules;
  - snippets;
  - .docx text and .xlsx text extraction from made-up files;
  - the PDF text status rules;
  - the backup size check, and include and exclude;
  - the schema migration.
- **PDF tests:** made-up PDFs generated in tests. One has text on several pages, and one is image-only.
- **End-to-end tests:**
  - import a PDF, search a word on page 3, open the result at page 3 with the word highlighted;
  - import a .docx and an .xlsx and find words in them;
  - a scanned PDF is labelled;
  - delete and undo;
  - a backup with and without the tick;
  - offline after the first open;
  - 360 px with no horizontal scroll.

## 8. Left to the builder

- Exact styling of results and the viewer toolbar.
- The pdf.js rendering scale on high-density screens.
- Debouncing search while typing (about 200 ms).

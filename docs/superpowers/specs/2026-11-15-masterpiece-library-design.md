# Masterpiece: Knowledge Library (Piece 4) Design

Date: 2026-11-15
Status: draft for user review. A builder check was done; its questions are answered below and marked *(builder check)*.

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
6. **Backups (user decision: separate library files):**
   - Normal backups and handovers carry the library's titles, folders and tags only, never the files, so they stay small.
   - **Export library** makes encrypted library file(s) of their own. When the library is big, it is split into parts of
     about 100 MB each.
   - **Import library** reads any number of those parts, in any order, on any device. A relief gets the handover file
     plus the library file(s).

## 3. Non-goals

- Built-in reference content (SOLAS, MARPOL and similar). Copyright stays with the user's own copies.
- Writing notes in the app.
- Text recognition (OCR) of scanned pages.
- Editing documents.
- Old .doc and .xls files: these are stored and opened with the device only, with no text and no viewer.
- Sync between devices other than by backup.

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
- **Offline:** the pdf.js worker (`.mjs`), standard fonts (`.pfb`) and character maps (`.bcmap`) are added to the
  Workbox precache patterns, about 3 MB in all, downloaded once. The Workbox per-file size limit is raised to cover the
  worker, if needed. *(builder check)*
- **Storage persistence:** the app already asks for persistent storage and warns when it is refused. The library screen
  repeats that warning. There is no total cap beyond the device's quota. *(builder check)*
- **Privacy:** documents leave the device only in the user's encrypted library files.

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
- **Missing file:** a document whose `libraryFiles` row is missing shows "File not on this device", which is shown and
  never stored. This happens after a normal backup is restored without its library file, and the document can then be
  found only by title and tags. **Attach file** asks for the file; its `sha256` must match, otherwise "This is a
  different file. Use it anyway?". Attaching indexes the file. *(builder check)*
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
- **Word match:** a word matches anywhere inside a word of the text ("inspect" finds "inspection"). Search scans the
  stored text in full; there is no word index and no quoted-phrase search. *(builder check)*
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
  - **Open with…** uses the share sheet with the file (`navigator.share` with files) where the device supports it, and
    otherwise downloads the file. *(builder check)*
  - **Delete** is soft. Deleted documents stay in **Recently deleted** (with Restore, and Delete now) for 30 days. On
    the first library open after that, their files and text are removed; the record stays as a tombstone for the merge.
    *(builder check)*
- **Viewer:** as in §2.4.
  - PDF pages render on demand, about 2 pages either side of the one shown.
  - Highlights come from the pdf.js text layer.

### 7.5 Backups and library files

- **Normal backups and handovers** carry `libraryDocs` and `libraryFolders`, tombstones included, through the existing
  merge. A document that changed on both sides follows the newer `updatedAt`, as other records do. They carry neither
  `libraryFiles` nor `libraryText`.
- **Library file format (`.mplib`):**
  - It starts with a small JSON header: format version, part `n` of `m`, export id, salt, IV and iteration count.
  - The rest is AES-GCM ciphertext of a zip, stored without compression (PDFs are already compressed). The zip holds
    `manifest.json` (the part's documents and all folders) and one entry per file.
  - The key comes from the user's password with the same PBKDF2 settings as backups.
  - Documents are packed whole into parts of up to 100 MB; one file is at most 100 MB, so it always fits.
  - The file name is `Masterpiece-library-YYYY-MM-DD-part-n-of-m.mplib`.
- **Import library:**
  - The user picks one or more parts and enters the password.
  - Each part is read on its own: its folders and documents are merged by `id`, then by `sha256`, and its files are
    attached where missing.
  - A snapshot is taken before the first part, as for other imports.
  - The text index is rebuilt for each attached file, with progress, in the same way as import (§7.2).
  - A missing part leaves its documents as "File not on this device" until it is imported.
- **Memory:** each part is built and encrypted on its own, so at most about 2 × 100 MB is held at once. Base64 strings
  are never used for files.

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
  - export the library as several parts (with a lowered part size in the test) and import them on a fresh app,
    in reverse order;
  - a normal backup carries titles but no files;
  - Recently deleted, then purged after 30 days, using the clock;
  - offline after the first open;
  - 360 px with no horizontal scroll.

## 8. Left to the builder

- Exact styling of results and the viewer toolbar.
- The pdf.js rendering scale on high-density screens.
- Debouncing search while typing (about 200 ms).

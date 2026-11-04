# Masterpiece — Piece 1: Base — Design Spec

Date: 2026-10-25
Status: Draft for review (rev. 2: adds ship's time, crew import, crew list as at date, certificates, ship/personal separation, themes, PIN lock, copy profile)

## 1. Purpose

Masterpiece is an offline app for a deck officer on a bulk carrier. It cuts paperwork and repeated calculations onboard.
This spec covers **Piece 1 (Base)**: the shell, ship's data and backup/transfer that every later piece depends on.

**Success for Piece 1:** the user installs Masterpiece on an Android phone and a laptop.
They enter a ship's particulars, certificates and current voyage once, and import the crew list from Excel.
They move that data between the devices with one password-protected file, and nothing is lost or changed by accident.
At sign-off they can give the relief a ship-only handover file.

## 2. Agreed decisions (whole project)

| Topic | Decision |
|---|---|
| Platform | Installable offline web app (PWA): one codebase for laptop, Android phone and tablet |
| Internet | Needed only for first install and updates; everything else runs offline |
| Device-to-device sharing | Export/import a single backup file; no cloud, no accounts, no server |
| Backup files | Always password-protected (they contain crew personal data); password remembered only while the app is open |
| Ships | Several ship profiles; one is active at a time; a profile can be copied for a sister ship |
| Ship vs personal data | Kept separate; a ship-only handover file can be given to the relief |
| SMS forms | The company's real Word/Excel files are filled and printed **identical to the original** |
| Vessel type for cargo tools | Bulk carrier |
| Time | All forms and reports use **ship's time** (UTC offset with logged clock changes) |
| Language | English |
| Hosting | GitHub Pages from a public repo (the code holds no ship or crew data). Repo to be connected later |
| Primary phone | Android (Chrome) |

## 3. Roadmap (each piece gets its own spec → plan → build)

1. **Base:** this spec.
2. **SMS forms engine** (user decision 2026-10-27: built right after the base, before the Library, because these forms are used daily; designed in `2026-10-28-masterpiece-sms-forms-design.md`): fills the company .docx/.xlsx with ship's data and form inputs and outputs the original layout for printing. The user's sample forms have arrived (15, Word legacy form fields and Excel sheets). They are company documents: they stay on the user's devices and are never committed to this public repository.
3. **Library** (user request):
   - **Document shelf:** about 100 of the user's own PDF/Word/Excel files (SMS manuals, circulars, stability booklet, their own legal copies of codes), stored offline, with folders and tags, full-text search inside the documents, favourites, and optional inclusion in the ship handover.
   - **Built-in quick-reference cards:** only original or public-domain content (for example Beaufort scale, phonetic alphabet, flag signals, COLREG lights and shapes, formulas, unit tables). No copyrighted IMO or other publisher texts are bundled.
   - Own spec when started.
4. **Cargo:** draft survey (initial/final, trim, hog/sag and density corrections), final trimming pours, air draft (keel to hatch cover) for loader clearance. Hydrostatic tables are entered per ship profile. Results are an aid and are checked against the approved stability booklet/loading computer.
5. **Admin:** port and crew papers (crew lists, IMO FAL), voyage reports (noon, arrival/departure, NOR, SOF), planned tasks and due dates, work/rest hours, cargo/ballast logs and ROB.
6. **Finance and converters** (includes the **personal budget planner**, designed in `2026-10-25-masterpiece-budget-design.md`): currency (offline rates, updated when online or entered by hand), units, financial calculators, personal planning (personal data), and ship's business (ship data: master's cash, wages and advances, slop chest, disbursements).

## 4. Piece 1 scope

### 4.1 Screens

- **First start (no ships yet):** *Create your first ship* (name and ship's time offset), or *Import a backup* for a new device or a relief's handover file.
- **Errors:** a storage-full or unexpected error shows a clear message, with *Export backup* offered where relevant.
- **Header (every screen):**
  - Active ship name.
  - Ship's time with UTC offset (for example `14:32 LT (UTC+03:00)`).
  - One-tap theme switch (Day / Night / High contrast).
- **Home:**
  - Backup reminder (if due).
  - Alerts for crew documents and certificates that are expiring or overdue.
  - Upcoming clock change (if one is scheduled).
  - Shortcut to Ship's data.
  - Shortcuts to later pieces appear only once those pieces exist.
- **Ship's data**, for the active ship profile:
  - **Vessel particulars:** name, IMO, call sign, MMSI, flag, port of registry, GT, NT, DWT (summer), LOA, beam, year built, owners, managers (ISM company), P&I club, classification society.
  - **Crew list** (§4.4):
    - Fields: surname, given names, rank, nationality, date of birth, place of birth, passport no. and expiry, seaman's book no. and expiry, sign-on date and port, sign-off date and port.
    - **"As at" date** selector, defaulting to today (ship's time).
    - Actions: *Sign off*, *Re-join*, *Import from Excel*, *Print crew list*, *Export to Excel* (§4.15).
    - Each crew member has a **Documents** list (§4.14) and **contract** fields (§4.16).
  - **Reliefs** (§4.16): onboard crew sorted by contract end, with days onboard and planned reliefs.
  - **Expiring** (§4.14): crew documents that lapse before the next port.
  - **Certificates** (§4.6): the register, with expiry and survey warnings.
  - **Current voyage:** voyage no., last port, next port, ETA (local time + UTC offset), cargo, charterers, agents at next port.
    One voyage per ship is active. Starting a new voyage keeps the old one as history.
  - **Ship's time** (§4.3): current offset, *Advance 1 h*, *Retard 1 h*, *Set offset*, schedule a clock change, history.
- **Ship profiles:** list, create, rename, **copy** (§4.8), switch active, delete (confirmation shows what will be removed).
- **Settings:**
  - Export full backup.
  - Export handover file.
  - Import.
  - Restore a previous snapshot.
  - Backup reminder interval (default 7 days).
  - App PIN lock.
  - Theme.
  - About/version.

Unit preferences are **deferred** to Pieces 3/5, where units are first used.

### 4.2 Field dictionary ("enter once, use everywhere")

Every data item has a stable dotted name that later pieces use to pre-fill forms and reports:

- **Vessel:** `vessel.name`, `vessel.imo`, `vessel.callSign`, `vessel.mmsi`, `vessel.flag`, `vessel.portOfRegistry`, `vessel.gt`, `vessel.nt`, `vessel.dwt`, `vessel.loa`, `vessel.beam`, `vessel.yearBuilt`, `vessel.owners`, `vessel.managers`, `vessel.pandi`, `vessel.classSociety`
- **Voyage:** `voyage.no`, `voyage.lastPort`, `voyage.nextPort`, `voyage.eta` (local time at the destination), `voyage.etaTimeZone` (for example `UTC+01:00`), `voyage.cargo`, `voyage.charterers`, `voyage.agents`
- **Crew by rank:** `crew.byRank.<rank>.<field>`, for example `crew.byRank.master.fullName` (first crew member with that rank onboard at the reference date).
  - Rank is chosen from a standard list (Master, Chief Officer, 2nd/3rd Officer, Deck Cadet, Bosun, AB, OS, Chief/2nd/3rd/4th Engineer, ETO, Engine Cadet, Fitter, Oiler, Wiper, Chief Cook, Messman, plus *Other* as free text).
  - The key is the camelCase name, for example `chiefOfficer`.
  - Extra crew fields: `contractEndDate` and `daysOnboard` (§4.16), and `doc.<type>.<field>` for crew documents (§4.14), for example `crew.byRank.master.doc.coc.number`.
- **Crew lists:** `crew.onboard` (the list onboard at the reference date, for crew-list style forms), `crew.onboardCount`
- **Certificates:** `cert.<key>.number`, `cert.<key>.issuedBy`, `cert.<key>.issueDate`, `cert.<key>.expiryDate`, `cert.<key>.nextSurveyDue`. The key comes from the standard list (§4.6), for example `cert.loadLine.expiryDate`.
- **Time:** `today` and `now` in **ship's time**, `nowUtc`, `ship.timeZone` (for example `UTC+03:00`)

**Reference date:** fields resolve as at a reference date, which is today by default. Piece 2 can set another date to redo a past form.
The fields are exposed through one lookup function, `resolveField(name, { asAt? })`. Nothing uses it until Piece 2.

### 4.3 Ship's time

- Ship's time is stored as a log of `ClockChange` records per ship. Each one has an `effectiveAt` (UTC instant), a `toOffsetMinutes` and an optional note.
  The first record sets the starting offset.
- Offsets run from −12:00 to +14:00 in 15-minute steps, so ±05:30 and +05:45 are possible.
- The offset at any instant is the `toOffsetMinutes` of the latest change whose `effectiveAt` is at or before that instant: `shipOffsetAt(utcInstant)`.
  Later pieces need this, for example for 23- and 25-hour days in rest hours.
- *Advance/Retard 1 h* creates a change effective now.
  *Schedule* creates one effective at a chosen ship's time, for example tonight at 02:00. It appears on Home until it takes effect.
- The device clock is the UTC source. If the device's own time zone differs from ship's time, nothing breaks: only the UTC instant from the device is used.

### 4.4 Crew

**Contract records**
- Each service period is one `CrewMember` record.
- *Sign off* sets the sign-off date and port.
- *Re-join* creates a new record that copies the person's details, with a new sign-on.

**Onboard at date D**
- A crew member counts as onboard at D when `signOnDate ≤ D` and (`signOffDate` is empty or `signOffDate ≥ D`).
- The day of sign-on and the day of sign-off both count as onboard.

**Import from Excel/CSV** (.xlsx, .xls, .csv)
- If a file can't be read (for example it is password-protected in Excel), the app says so and suggests removing the password and saving it again.
- CSV files may use commas or semicolons (European Excel exports use semicolons).
- If a crew list has a single full-name column, it is split into surname and given names: "SURNAME, Given" (comma), or leading words in capitals taken as the surname.
- A *sign-on date for rows without one* is applied to rows that lack it (default: today, ship's time).

1. Pick the file, then pick the sheet. The header row is detected automatically and can be changed.
2. **Column mapping.** Masterpiece guesses from the header names (for example *Family name / Surname*, *Passport No*, *D.O.B.*), and the user confirms or corrects.
   The user also picks the date format (day-first by default: DD.MM.YYYY, DD/MM/YYYY, DD-MMM-YYYY; or YYYY-MM-DD). Excel date serials are handled automatically.
   The mapping is remembered per ship for next time.
3. **Preview.** Each row is marked *new*, *update* or *error*.
   - It is an *update* when the passport number matches an existing record for this ship (case and spaces ignored). The changes are shown.
   - Rows with errors (for example an invalid date) can be fixed in place or skipped.
4. Save. A `before-import` snapshot is taken first.

### 4.5 Data model

**Common fields on every record:** `id` (UUID), `createdAt`, `updatedAt` (ISO UTC), `updatedBy` (device id), `deleted` (soft-delete flag, so deletions travel with backups) and `scope`: `ship` or `personal`.

**Ship scope** (every record belongs to one ship via `shipId`):
- `ShipProfile`: `{ particulars: {…§4.1 fields}, crewImportMapping? }`
- `CrewMember`: `{ shipId, …§4.1 fields }`
- `Voyage`: `{ shipId, active: boolean, …§4.1 fields }`
- `Certificate`: `{ shipId, key, name, number, issuedBy, issueDate, expiryDate?, nextSurveyDue?, remarks }`
- `ClockChange`: `{ shipId, effectiveAt, toOffsetMinutes, note? }`
- `CrewDocument` (§4.14): `{ shipId, crewId, type, typeOther?, grade, number, issuedBy, issueDate, expiryDate?, remarks }`
- Added later to existing records: `CrewMember.contractMonths?`, `reliefPlannedDate?`, `reliefPlannedPort?` (§4.16); `ShipProfile.maxMonthsOnboard?` (§4.16) and `crewListColumns?` (§4.15).

**Personal scope:** no tables in Piece 1. Piece 5 adds personal finance here. The backup and handover mechanism already respects scope.

**Local only (never exported):**
- `Settings` (single record per device): `{ deviceId, deviceName, activeShipId, backupReminderDays, lastExportAt, lastSync: { [otherDeviceId]: isoTime }, theme, pin? }`
- `Snapshot`: a full copy of all records plus a reason (`before-import` / `before-update` / `manual`) and a timestamp. The **last 5** are kept.

### 4.6 Certificates register

**Standard list**, each with a fixed key, plus *Other* as free text:

| Group | Certificates |
|---|---|
| Registry and tonnage | Certificate of Registry, International Tonnage Certificate (1969), Continuous Synopsis Record |
| Statutory safety | Minimum Safe Manning Document, Cargo Ship Safety Construction, Cargo Ship Safety Equipment, Cargo Ship Safety Radio, International Load Line |
| Pollution and environment | IOPP, ISPP (sewage), IAPP, IEE, Ballast Water Management, Anti-Fouling System (IAFS), Inventory of Hazardous Materials (Statement of Compliance) |
| Management and security | Document of Compliance (ISM, copy), Safety Management Certificate, ISSC, Maritime Labour Certificate, DMLC Part I and Part II |
| Class | Class Certificate (Hull), Class Certificate (Machinery) |
| Cargo | Document of Authorization for carriage of grain, Document of Compliance for Dangerous Goods / IMSBC solid bulk cargoes |
| Liability and insurance | P&I Certificate of Entry, Bunker Convention (CLC) Certificate, Wreck Removal Certificate, Hull & Machinery insurance |
| Health | Ship Sanitation Control (Exemption) Certificate |

- **Fields:** number, issued by, issue date, expiry date (empty = no expiry), next survey due (optional, for annual or intermediate windows), remarks.
- **Warnings** (crew list, certificates and Home):
  - Amber when the expiry date or next survey due falls within **90 days**.
  - Red when it is past.

### 4.7 Ship vs personal data, backups and handover

**Two export types**
- **Full backup:** every record of both scopes and all ship profiles. For your own devices.
- **Handover file:** one chosen ship profile and its ship-scope records only, with **no personal data** and no other ships.
  It has its own password, which you give to the relief.
  Importing it on the relief's device adds or merges that ship profile.

**File format**
- Name: `masterpiece-<full|handover>-<ship>-<yyyy-mm-dd-hhmm>.mpbak`
- On Android the Web Share sheet (e-mail, Bluetooth, Drive, WhatsApp…) is used where available; otherwise the file is downloaded.
- A full backup updates `lastExportAt`.

**Encryption**
- AES-GCM 256 via WebCrypto. The key comes from the password via PBKDF2-SHA-256 with 600,000 iterations, a random 16-byte salt and a 12-byte IV.
- The envelope is JSON: `{ format: "masterpiece-backup", version: 1, kind: "full"|"handover", deviceId, deviceName, exportedAt, kdf, iv, ciphertext }`.
- The password must be at least 8 characters and is typed twice on export.
- It is remembered only until the app is closed and is never stored on disk.
- **A forgotten password cannot be recovered.** The app says so on the first export.

**Import**
1. Pick the file, then enter the password.
2. Wrong password, damaged file, non-Masterpiece file or newer unknown version → clear message, **nothing changes**.
3. Decrypt and compute the merge. Show a summary (*N new, N updated, N deleted, N conflicts*) before anything is applied.
4. Take a `before-import` snapshot, apply the merge, then set `lastSync[fileDeviceId] = exportedAt`.

**Merge rules (per record, matched by `id`)**
- Only in file → add.
- Identical → skip.
- Changed on only one side since `lastSync[fileDeviceId]` → the changed side wins.
- Changed on **both** sides since `lastSync[fileDeviceId]` → **conflict**. Both versions are shown side by side and the user picks one.
- Changed on neither side but different (for example after an earlier conflict choice) → the newer `updatedAt` wins.
- A deletion is treated like any other change. Deletions are listed in the summary and applied only after the user confirms.
- The first exchange between two devices has no `lastSync` entry, so it is treated as "never synced". Records that differ become conflicts.
- Resolving a conflict sets the chosen version's `updatedAt` to now, so the choice reaches the other device on the next exchange.

Device clocks are assumed to be roughly correct. Times are compared in UTC.

### 4.8 Copy ship profile (sister ships)

- **Copied:** particulars, except the identity fields. Name, IMO, call sign and MMSI are cleared and must be entered.
- **Optional:** the certificate list, as names only, with numbers and dates cleared.
- **Never copied:** crew, voyages, clock changes.
- Later pieces add their own optional items, such as hydrostatic tables (Piece 3) and form templates (Piece 2).

### 4.9 Display themes

**Visual style, chosen by the user: "A · Bridge Console".** Mockups are at https://claude.ai/artifact/7aEGBDGRCemA7uUWVE638x.
- Typefaces: IBM Plex Sans for text; IBM Plex Mono for clock times and rank codes. Both are bundled, so they work offline.
- Cards and list rows have 10–12 px rounded corners on a dark surface. Status is shown as pill badges.
- The main navigation is a bottom bar: Home, Ship, Profiles, Settings. The ship's sections are a row of chips under the header.
- The header shows the ship's name, the ship's clock and the theme button.
- **Logo (user-chosen): "M on the sea at sunrise" (logo v2).**
  - A navy "M" stands on the waves, with the horizon behind it.
  - The upper part of the tile is a bright sunrise sky (saturated sunrise yellow fading to light blue), with a small sun between the two peaks of the M. Below the horizon is blue sea, and dark navy waves sit under the M's feet.
  - The Night version uses a dark sky, a pale moon, a teal horizon line and a light "M".
  - It is used for the home-screen icon, the Android launch splash, the header brand and print footers. Print uses a one-colour line version.
- **Welcome page (first start, approved as mocked up):**
  - The logo and "Masterpiece" on a navy band.
  - The tagline "Your ship's office in your pocket. Crew, certificates and paperwork — fully offline."
  - Two large buttons, *Create your first ship* and *Import a backup*, a line for new phones and reliefs, and the note "Your data stays on this device. No account needed."

Themes (user decision: no red night mode):
- **Day (white with blue):** white page and light-grey cards with dark text, a navy `#0B2545` header and bottom bar, blue `#1D5FD1` buttons and accents, amber and red badges.
- **Night (dark navy Bridge Console):** background `#0B1622`, cards `#12243A`, lines `#1E3550`, text `#E6EDF5`, secondary text `#9FB3C8`, teal accent `#5FD4CE`, amber warnings `#F2B33D`, red alarms `#FF6B5E`. At night, lower the phone's own brightness.
- **High contrast:** black on white, bold text and larger touch targets, for bright sun on deck.

The header has a one-tap toggle, and the choice is remembered per device.
Printing always uses a black-on-white print layout, whatever the theme.

### 4.10 App lock: fingerprint and 4-digit passcode (user decision)

- **Phones** (Android): unlock with the **fingerprint first**. If the fingerprint isn't recognised or the prompt is cancelled, the **4-digit passcode** is the fallback.
- **Laptops:** the **4-digit passcode only**.
- **Setting it up:**
  - It is offered right after the first ship is created (*Protect Masterpiece*: set a passcode, plus "Also unlock with fingerprint" on phones), with a *Skip for now* option.
  - Once on, the lock is required every time the app opens and after the app has been in the background longer than a set time (default 5 minutes).
  - It can be turned off in Settings.
- **How the fingerprint works:**
  - It uses the phone's built-in sensor through the browser's standard secure-login feature (WebAuthn). It works offline.
  - The app keeps only a public key and checks the phone's signed answer itself. No fingerprint data ever reaches the app.
  - Android shows its own prompt and may offer the phone's own screen lock there.
- **Passcode:**
  - Exactly 4 digits, stored only as a salted PBKDF2 hash.
  - After 5 wrong tries, waits grow: 30 s, then 1 min, then 5 min.
  - Failed fingerprint attempts don't count towards the waits.
- **Can't unlock** (forgotten passcode and no fingerprint): the only way out is to erase all data on this device and import a backup. The app says so when the lock is set up.
- **Limitation, stated in the app:** the lock stops casual access but does not encrypt the data on the device. The phone's own screen lock and device encryption remain the real protection.

### 4.11 Data safety

- On first start, call `navigator.storage.persist()`. If it is refused, warn the user and show the backup reminder more prominently.
- Home shows the backup reminder when `now − lastExportAt > backupReminderDays`.
- A snapshot is taken automatically before every import (backup or crew Excel) and every data migration.
  Settings → *Restore snapshot* rolls back to any of the last 5.
- If storage is full: clear message, the change is not saved, and the user is offered an export.

### 4.12 Validation

- **IMO number:** 7 digits. The check digit (last digit) equals `(d1×7 + d2×6 + d3×5 + d4×4 + d5×3 + d6×2) mod 10`. A failed check is shown as a warning, but saving is still allowed.
- **MMSI:** 9 digits.
- **Dates:** must be valid; date of birth must be in the past; sign-off cannot be before sign-on; certificate expiry cannot be before issue.
- **Crew documents:** passport or seaman's book expiring within **6 months** of the "as at" date is shown amber, and expired is shown red.
- **Certificates:** see §4.6.
- Numeric fields (GT, NT, DWT, LOA, beam) must be positive numbers.

### 4.13 Updates

- The service worker checks for a new version when the app starts, every hour while it is open and online, and as soon as the connection returns.
- New versions are published by merging to `main`; GitHub Actions deploys them to GitHub Pages.
- Updates arrive as an in-app banner, not a phone notification, because push notifications would need an online push service.
- **The banner shows what's new**, for example *"Version 1.2.0 — Crew list print and Excel export. Update"*. It falls back to *"New version available — Update"* when the release note can't be fetched.
- **Release control (user decision):**
  - The owner asks for changes in a Claude session. Claude builds them on a branch with tests and reviews, and gives a plain-language summary.
  - Nothing is merged to `main` (and so published) until the owner approves.
  - There is no separate preview deployment.
  - A bad release is rolled back by reverting the merge.
- The user sees *"New version available — Update"*. The app never reloads by itself in the middle of a task.
- Data schema changes run as versioned migrations, each preceded by a `before-update` snapshot.

### 4.14 Crew documents (certificate register per seafarer)

**Document types**, plus *Other* as free text:

| Group | Documents |
|---|---|
| Competency | Certificate of Competency (CoC), Flag endorsement, GMDSS certificate |
| Health | Medical fitness certificate, Yellow fever certificate |
| STCW courses | Basic safety training, Advanced fire fighting, Survival craft and rescue boats, Fast rescue boats, Medical first aid, Medical care, Security awareness, Designated security duties, Ship security officer, ECDIS, Bridge resource management, Engine-room resource management, High voltage |
| Visas | US C1/D visa, Schengen visa |

- **Fields:** type, grade/capacity (for CoC, endorsement and GMDSS), number, issued by, issue date, expiry date (empty means no expiry), remarks.
- **Warnings:** amber when expiry is within **90 days** of the reference date, red when past.
  The crew list badge shows the worst of passport, seaman's book and documents.
- **Expiring view:**
  - Shows passports, seaman's books and documents of crew onboard today that expire on or before the active voyage's ETA date, sorted by expiry.
  - With no ETA set, it shows the next 90 days and says so.
- **Re-join:** the new contract record receives copies of the person's documents that have no expiry or expire on or after the new sign-on date.
- **Delete:** deleting a crew member also soft-deletes their documents.
- **Storage:** a new `crewDocuments` table (database version 2, with a `before-update` snapshot in the migration).
- **Older backups:** a backup without that table imports as having no documents.

### 4.15 Crew list output (print and Excel)

- **Buttons:** *Print crew list* and *Export to Excel* on the crew list. Both use the current *As at* date and the *Onboard*/*All* filter.
- **Options:**
  - *Port* (default: the active voyage's next port) and *Date* (default: As at).
  - Tickable columns, remembered per ship.
- **Columns:**
  - Default: No., surname, given names, rank, nationality, date of birth, place of birth, passport no., passport expiry, sign-on date, sign-on port.
  - Optional: seaman's book no. and expiry, CoC no., contract end.
- **Printout:**
  - A4 landscape.
  - Title `CREW LIST`; vessel name, IMO, call sign and flag; port and date.
  - A numbered table in rank order.
  - A Master signature line with the Master's name, a ship's stamp box, and a small "Printed with Masterpiece" footer.
- **Dates** on printouts and exports are shown as `05-JAN-1985`, which can't be misread.
- **Excel file:** the same header and table, named `crew-list-<ship>-<yyyy-mm-dd>.xlsx`, shared or downloaded like backups.

### 4.16 Contracts and relief planning

- **Crew fields:**
  - Contract length in whole months (1–24, optional).
  - Planned relief date and planned relief port (optional).
- **Calculated values:**
  - Contract end = sign-on + contract length.
  - Days onboard = days from sign-on to the reference date (or the sign-off date if earlier), counting both ends.
- **Contract warning:** amber when the contract ends within **30 days**, red when it has ended (relief overdue).
- **Onboard limit:**
  - A per-ship setting *Maximum months onboard*: 1–11, default **11**, staying under the MLC 12-month limit.
  - Amber from 30 days before sign-on + limit; red once reached.
  - Applies to crew onboard at the reference date.
- **Reliefs view:**
  - Onboard crew sorted by contract end (no contract length last), with days onboard, contract end, planned relief and badges.
  - Alerts also appear on Home.

## 5. Technical design

- **Stack:** TypeScript, Preact, Vite. PWA via `vite-plugin-pwa` (Workbox precache of all assets for full offline use). IndexedDB via Dexie. Plain CSS with variables and three theme sets, mobile-first, usable one-handed on a phone.
- **Spreadsheet reading:** SheetJS Community Edition 0.20.3 for .xlsx and .xls, installed from the official SheetJS CDN tarball, and a small built-in parser for .csv.
  - The build environment must allow `cdn.sheetjs.com`.
  - The npm-registry `xlsx@0.18.5` is outdated, has known vulnerabilities and is never used.
  - Excel dates are converted from the serial number directly, so results don't depend on the device's time zone.
- **Code units:**
  - `db/`: schema, migrations, record helpers (timestamps, soft delete, scope).
  - `domain/`: pure functions, no I/O:
    - validation and expiry banding
    - field dictionary (`resolveField`)
    - ship's time (`shipOffsetAt`)
    - onboard-at-date
    - crew import mapping and date parsing
    - merge engine
    - profile copy
  - `backup/`: encrypt/decrypt envelope, full and handover export and share, import flow.
  - `security/`: PIN hash, lockout timer.
  - `ui/`: screens, components, themes.
- **Hosting:** public GitHub repo, deployed to GitHub Pages by GitHub Actions on every push to `main`. Repo name to be confirmed when GitHub is connected.

## 6. Testing

**Unit tests (Vitest)**
- **Validation:** IMO check digit (valid and invalid examples); expiry banding at the exact 6-month and 90-day boundaries.
- **Ship's time:** `shipOffsetAt` with half-hour and 45-minute offsets, scheduled future changes, and instants exactly at a change.
- **Crew:** onboard-at-date boundaries (sign-on day, sign-off day, still onboard).
- **Crew import:** header guessing; date parsing in each format and from Excel serials; update vs new matching by passport number.
- **Field dictionary:** `resolveField` with and without `asAt`.
- **Merge engine:** every rule in §4.7, including conflicts and deletions.
- **Backup files:** a handover file contains only the chosen ship's ship-scope records; encryption round trip; wrong password and tampered ciphertext rejected.
- **Profile copy:** clears the identity fields and never copies crew.
- **PIN:** hash check and lockout steps.

**End-to-end tests (Playwright, Chromium, desktop and Android-sized viewport)**
- Create a ship, import a crew list from a sample .xlsx, add certificates, start a voyage, advance the clock.
- Export a full backup, wipe, import, and confirm the data is identical.
- Export a handover file, import it on a fresh profile, and confirm it holds only that ship's data.
- Two-device conflict scenario.
- Switch themes; check that the print layout is black on white.
- PIN lock on reopen.
- App loads and works with the network disabled after the first visit.

**Unit and e2e tests for §4.14–4.16:**
- Contract end, days onboard and band boundaries.
- Document carry-over on re-join.
- Expiring-before-next-port list.
- Database v1 → v2 migration snapshot.
- Old backups without crew documents.
- Crew list columns and date format.
- Excel export read back through the importer.
- Printing shows only the sheet.

**Manual:** install and run on an Android phone (Chrome) and a laptop (Chrome/Edge).

## 7. Out of scope for Piece 1

- SMS forms, cargo calculations, admin, finance and converters (Pieces 2–5).
- Printing documents (arrives with Pieces 2 and 4).
- Passport scanning with the camera.
- Cloud sync.
- Multiple users.
- Languages other than English.

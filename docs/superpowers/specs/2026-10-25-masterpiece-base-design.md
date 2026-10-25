# Masterpiece — Piece 1: Base — Design Spec

Date: 2026-10-25
Status: Draft for review

## 1. Purpose

Masterpiece is an offline app for a deck officer on a bulk carrier. It cuts paperwork and repeated calculations onboard.
This spec covers **Piece 1 (Base)**: the shell, ship's data and backup/transfer that every later piece depends on.

**Success for Piece 1:** the user installs Masterpiece on an Android phone and a laptop and enters a ship's particulars, crew and current voyage once.
They move that data between the devices with one password-protected file, and nothing is lost or changed by accident.

## 2. Agreed decisions (whole project)

| Topic | Decision |
|---|---|
| Platform | Installable offline web app (PWA): one codebase for laptop, Android phone and tablet |
| Internet | Needed only for first install and updates; everything else runs offline |
| Device-to-device sharing | Export/import a single backup file; no cloud, no accounts, no server |
| Backup files | Always password-protected (they contain crew personal data) |
| Ships | Several ship profiles; one is active at a time |
| SMS forms | The company's real Word/Excel files are filled and printed **identical to the original** |
| Vessel type for cargo tools | Bulk carrier |
| Language | English |
| Hosting | GitHub Pages from a public repo (the code holds no ship or crew data) |
| Primary phone | Android (Chrome) |

## 3. Roadmap (each piece gets its own spec → plan → build)

1. **Base:** this spec.
2. **SMS forms engine:** fills the company .docx/.xlsx with ship's data and form inputs and outputs the original layout for printing. Starts once the user sends 3–5 sample forms.
3. **Cargo:** draft survey (initial/final, trim, hog/sag and density corrections), final trimming pours, air draft (keel to hatch cover) for loader clearance. Hydrostatic tables are entered per ship profile. Results are an aid and are checked against the approved stability booklet/loading computer.
4. **Admin:** port and crew papers (crew lists, IMO FAL), voyage reports (noon, arrival/departure, NOR, SOF), planned tasks and due dates, work/rest hours, cargo/ballast logs and ROB.
5. **Finance and converters:** currency (offline rates, updated when online or entered by hand), units, financial calculators, personal planning, and ship's business (master's cash, wages and advances, slop chest, disbursements).

## 4. Piece 1 scope

### 4.1 Screens

- **Home:** active ship name, backup reminder (if due), crew document expiry alerts, shortcut to Ship's data.
  Shortcuts to later pieces appear only once those pieces exist.
- **Ship's data**, for the active ship profile:
  - **Vessel particulars:** name, IMO, call sign, MMSI, flag, port of registry, GT, NT, DWT (summer), LOA, beam, year built, owners, managers (ISM company), P&I club, classification society.
  - **Crew list:** surname, given names, rank, nationality, date of birth, place of birth, passport no. and expiry, seaman's book no. and expiry, sign-on date, sign-on port, sign-off date (empty while onboard). Filters: *Onboard* (default) or *All*.
  - **Current voyage:** voyage no., last port, next port, ETA (local time + UTC offset), cargo, charterers, agents at next port.
    One voyage per ship is active. Starting a new voyage keeps the old one as history.
- **Ship profiles:** list, create, rename, switch active, delete (confirmation shows what will be removed).
- **Settings:** export backup, import backup, restore a previous snapshot, backup reminder interval (default 7 days), about/version.

Unit preferences are **deferred** to Pieces 3/5, where units are first used.

### 4.2 Field dictionary ("enter once, use everywhere")

Every data item has a stable dotted name that later pieces use to pre-fill forms and reports:

- `vessel.name`, `vessel.imo`, `vessel.callSign`, `vessel.mmsi`, `vessel.flag`, `vessel.portOfRegistry`, `vessel.gt`, `vessel.nt`, `vessel.dwt`, `vessel.loa`, `vessel.beam`, `vessel.yearBuilt`, `vessel.owners`, `vessel.managers`, `vessel.pandi`, `vessel.classSociety`
- `voyage.no`, `voyage.lastPort`, `voyage.nextPort`, `voyage.eta`, `voyage.cargo`, `voyage.charterers`, `voyage.agents`
- `crew.byRank.<rank>.<field>`, for example `crew.byRank.master.fullName` (first onboard crew member with that rank).
  Rank is chosen from a standard list (Master, Chief Officer, 2nd/3rd Officer, Deck Cadet, Bosun, AB, OS, Chief/2nd/3rd/4th Engineer, ETO, Engine Cadet, Fitter, Oiler, Wiper, Chief Cook, Messman, plus *Other* as free text).
  The key is the camelCase name, for example `chiefOfficer`.
- `crew.onboard` (the list, for crew-list style forms), `crew.onboardCount`
- `today`, `now`, `nowUtc`

Piece 1 defines and exposes this dictionary through a single lookup function, `resolveField(name)`. Nothing uses it until Piece 2.

### 4.3 Data model

Every record has `id` (UUID), `createdAt`, `updatedAt` (ISO UTC), `updatedBy` (device id) and `deleted` (soft-delete flag, so deletions travel with backups).

- `ShipProfile`: `{ particulars: {…§4.1 fields} }`
- `CrewMember`: `{ shipId, …§4.1 fields }`
- `Voyage`: `{ shipId, active: boolean, …§4.1 fields }`
- `Settings` (single record per device, **not** included in backups): `{ deviceId, deviceName, activeShipId, backupReminderDays, lastExportAt, lastSync: { [otherDeviceId]: isoTime } }`
- `Snapshot` (local only): full copy of all records plus a reason (`before-import` / `before-update` / `manual`) and a timestamp. The **last 5** are kept.

### 4.4 Backup file: export, import, merge

**Export**
- Produces `masterpiece-<ship>-<yyyy-mm-dd-hhmm>.mpbak`, containing every ship profile, crew member and voyage, including soft-deleted ones.
- On Android the Web Share sheet (e-mail, Bluetooth, Drive, WhatsApp…) is used where available; otherwise the file is downloaded.
- `lastExportAt` is updated after the export.

**Encryption**
- AES-GCM 256 via WebCrypto. The key comes from the password via PBKDF2-SHA-256 with 600,000 iterations, a random 16-byte salt and a 12-byte IV.
- The envelope is JSON: `{ format: "masterpiece-backup", version: 1, deviceId, deviceName, exportedAt, kdf, iv, ciphertext }`.
- The password must be at least 8 characters and is typed twice on export.
- It can be remembered until the app is closed, and is never stored on disk.
- **A forgotten password cannot be recovered.** The app says so when the first export is made.

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

### 4.5 Data safety

- On first start, call `navigator.storage.persist()`. If it is refused, warn the user and show the backup reminder more prominently.
- Home shows the backup reminder when `now − lastExportAt > backupReminderDays`.
- A snapshot is taken automatically before every import and every data migration. Settings → *Restore snapshot* rolls back to any of the last 5.
- If storage is full: clear message, the change is not saved, and the user is offered an export.

### 4.6 Validation

- **IMO number:** 7 digits. The check digit (last digit) equals `(d1×7 + d2×6 + d3×5 + d4×4 + d5×3 + d6×2) mod 10`. A failed check is shown as a warning, but saving is still allowed.
- **MMSI:** 9 digits.
- **Dates:** must be valid; date of birth must be in the past.
- **Crew documents:** passport or seaman's book expiring within **6 months** of today is shown amber, and expired is shown red, on the crew list and in Home alerts.
- Numeric fields (GT, NT, DWT, LOA, beam) must be positive numbers.

### 4.7 Updates

- The service worker checks for a new version when online.
- The user sees *"New version available — Update"*. The app never reloads by itself in the middle of a task.
- Data schema changes run as versioned migrations, each preceded by a `before-update` snapshot.

## 5. Technical design

- **Stack:** TypeScript, Preact, Vite. PWA via `vite-plugin-pwa` (Workbox precache of all assets for full offline use). IndexedDB via Dexie. Plain CSS with variables, mobile-first, usable one-handed on a phone.
- **Code units:**
  - `db/`: schema, migrations, record helpers (timestamps, soft delete).
  - `domain/`: validation, field dictionary (`resolveField`), merge engine (pure functions, no I/O).
  - `backup/`: encrypt/decrypt envelope, export/share, import flow.
  - `ui/`: screens and components.
- **Hosting:** public GitHub repo, deployed to GitHub Pages by GitHub Actions on every push to `main`.

## 6. Testing

- **Unit (Vitest):**
  - IMO check digit (valid and invalid examples), expiry banding.
  - `resolveField`.
  - Merge engine: every rule in §4.4, including conflicts and deletions.
  - Encryption round trip; wrong password and tampered ciphertext rejected.
- **End-to-end (Playwright, Chromium, desktop and Android-sized viewport):**
  - Create a ship, add crew, start a voyage.
  - Export, wipe, import, and confirm the data is identical.
  - Two-device conflict scenario.
  - App loads and works with the network disabled after first visit.
- **Manual:** install and run on an Android phone (Chrome) and a laptop (Chrome/Edge).

## 7. Out of scope for Piece 1

SMS forms, cargo calculations, admin, finance and converters (Pieces 2–5); printing documents (arrives with Pieces 2 and 4); cloud sync; multiple users; languages other than English.

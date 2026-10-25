# Masterpiece Base (Piece 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the offline, installable Masterpiece base. It covers ship profiles, particulars, crew (with Excel import), certificates, voyage and ship's time, encrypted backup/handover files with merge, themes and PIN lock.

**Architecture:**
- Preact PWA built with Vite. All data lives in IndexedDB (Dexie) on the device.
- Business rules are pure TypeScript functions in `src/domain/` and `src/security/`, unit-tested with Vitest. Persistence is in `src/db/`, backup files in `src/backup/`, screens in `src/ui/`.
- Screens are tested end-to-end with Playwright against the production build, served by `vite preview` so the service worker is real.

**Tech Stack:** TypeScript 7, Preact 11, Vite 8, vite-plugin-pwa 2 (Workbox), Dexie 4, SheetJS Community Edition 0.20.3 (official CDN tarball), Vitest 5, fake-indexeddb 6, Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-10-25-masterpiece-base-design.md`

## Global Constraints

- **Runtime:** Node 22, npm. Project root `/home/user/masterpiece`.
- **Dependencies (exact ranges):**
  - Runtime: `preact@^11.0.2`, `dexie@^4.4.7`, `@fontsource/ibm-plex-sans@^5.3.0` and `@fontsource/ibm-plex-mono@^5.3.0` (both installed in Task 13), and `xlsx` (SheetJS CE). SheetJS is installed **only in Task 5** with `npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`.
    - This needs `cdn.sheetjs.com` allowed in the environment's network policy. If the download is refused, stop at Task 5 and report; do not substitute another package.
    - Never use the npm-registry `xlsx@0.18.5`, which is outdated and has known vulnerabilities.
  - Dev: `vite@^8.3.5`, `@preact/preset-vite@^2.10.6`, `@babel/core@^7`, `vite-plugin-pwa@^2.0.0`, `workbox-window@^7.4.1`, `vitest@^5.0.5`, `fake-indexeddb@^6.2.6`, `typescript@^7.0.2`, `@playwright/test@1.63.0` (exact: it must match the preinstalled browsers in `/opt/pw-browsers`; never run `playwright install`).
  - Adding any other dependency needs a plan change.
- **Offline:** no network requests at runtime (no CDNs, web fonts or analytics). Every asset is bundled and precached.
- **Vite paths:** `base: './'`. The manifest uses `start_url: '.'` and `scope: '.'`, because the GitHub repo name is not yet known.
- **Language:** UI copy in English. App name `Masterpiece`.
- **Value formats:**
  - Calendar dates: `'YYYY-MM-DD'` strings.
  - Instants: ISO-8601 UTC strings from `toISOString()`.
  - Ship's local date-time: `'YYYY-MM-DDTHH:mm'`.
- **Records:**
  - IDs come from `crypto.randomUUID()`.
  - Syncable records are never hard-deleted (soft delete only). The exceptions are snapshot restore and "erase all data on this device".
- **Backup crypto:** password ≥ 8 characters; PBKDF2-SHA-256 with **600,000** iterations; AES-GCM 256; 16-byte salt; 12-byte IV.
- **App lock (user decision):** phones unlock with the fingerprint first (WebAuthn platform authenticator), with an **exactly 4-digit** passcode as the fallback; laptops use the passcode only. Lockout after 5 wrong passcodes: 30 s, then 60 s, then 300 s. Relock after 5 minutes in the background by default.
- **Warnings:** crew documents amber when expiry ≤ 6 months away, red when past. Certificates amber when expiry or next survey ≤ 90 days away, red when past.
- **Defaults:** snapshots keep the last **5**; backup reminder **7** days.
- **Ship's time offsets:** −720 to +840 minutes, in steps of 15.
- **Layout:** mobile-first. Every screen fits 360 px width with no horizontal scroll.
- **Exact copy from the spec:** `New version available — Update`.

## Review Focus

1. **Crew Excel files with title, logo or blank rows above the header, and a "Total crew: N" footer.** Expected: the header is found and the footer is not imported as a person. Pinned in Task 5 (`detectHeaderRow`) and Task 6 (footer skipped).
2. **Names and passwords with diacritics and punctuation** (Šašić, Petrović, O'Brien, Jean-Luc; password `lozinka-ćevapi`). Expected: kept exactly as typed, and passport matching ignores spaces and case. Pinned in Task 6 and Task 8.
3. **The same backup file imported twice.** Expected: the second import shows zero changes and creates no duplicates. Pinned in Task 11.
4. **Ship names with characters that are illegal in file names** (`M/V Ocean Star`). Expected: a safe file name. Pinned in Task 11 (`backupFileName`).
5. **Phone-width screens (360 px).** Expected: no sideways scrolling on any screen. Pinned in Task 13 (`e2e/helpers.ts` `expectNoHorizontalScroll`), called in every UI task's e2e.

---

### Task 1: Project scaffold, PWA and offline smoke test

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `playwright.config.ts`, `index.html`, `.gitignore`, `src/main.tsx`, `src/app/App.tsx`, `src/app/swUpdate.ts`, `src/vite-env.d.ts`, `public/icon.svg`, `scripts/make-icons.mjs`, `public/icon-192.png`, `public/icon-512.png`, `public/icon-maskable-512.png`
- Test: `e2e/smoke.spec.ts`

**Interfaces:**
- Produces:
  - npm scripts: `dev`, `build` (`tsc --noEmit && vite build`), `preview`, `typecheck`, `test` (`vitest run`), `test:e2e` (`playwright test`).
  - `src/app/swUpdate.ts`: `onUpdateAvailable(cb: () => void): () => void` and `applyUpdate(): Promise<void>`. These wrap `registerSW` from `virtual:pwa-register` with `{ immediate: true, onNeedRefresh }`.
  - Global `__APP_VERSION__: string`, defined from `package.json` version via Vite `define`.
  - Vitest config inside `vite.config.ts`: `test: { environment: 'node', include: ['src/**/*.test.ts'] }`.

- [ ] **Step 1: Write the failing e2e test** in `e2e/smoke.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('app loads with title', async ({ page }) => {
  await page.goto('./');
  await expect(page).toHaveTitle('Masterpiece');
  await expect(page.getByRole('heading', { name: 'Masterpiece' })).toBeVisible();
});

test('works offline after first visit', async ({ page, context }) => {
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Masterpiece' })).toBeVisible();
});

test('manifest is installable', async ({ page, request }) => {
  await page.goto('./');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const m = await (await request.get(new URL(href!, page.url()).href)).json();
  expect(m.name).toBe('Masterpiece');
  expect(m.display).toBe('standalone');
  expect(m.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
});
```

Write `playwright.config.ts`:
- `webServer: { command: 'npm run build && npm run preview -- --port 4173 --strictPort', url: 'http://localhost:4173/', reuseExistingServer: false }`
- `use: { baseURL: 'http://localhost:4173/', serviceWorkers: 'allow' }`
- `projects`: `desktop` (Desktop Chrome) and `android` (`devices['Pixel 7']`)
- `testDir: 'e2e'`

- [ ] **Step 2: Run it and confirm it fails.** Run: `npm i && npx playwright test e2e/smoke.spec.ts`. Expected: FAIL (no app or build yet).

- [ ] **Step 3: Scaffold the app.**
  - Install the dependencies listed in Global Constraints.
  - `vite.config.ts`: `preact()` and `VitePWA({ registerType: 'prompt', injectRegister: false, workbox: { globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'] }, manifest })`, with this manifest:
    - `name` and `short_name`: `'Masterpiece'`
    - `description`: `'Ship office companion — works offline'`
    - `theme_color`: `'#0b3d5c'`; `background_color`: `'#ffffff'`
    - `display`: `'standalone'`; `start_url` and `scope`: `'.'`
    - icons 192, 512 and maskable 512
  - `index.html`: `<title>Masterpiece</title>`.
  - `App.tsx`: renders `<h1>Masterpiece</h1>`.
  - `main.tsx`: imports `swUpdate.ts` so registration happens at start-up.
  - `public/icon.svg`: navy `#0b3d5c` rounded square with a white "M" above a single white wave line.
  - `scripts/make-icons.mjs`: renders `icon.svg` with `playwright` Chromium to the three PNGs. The maskable icon has 20% padding. Run it once and commit the PNGs.

- [ ] **Step 4: Run the tests and confirm they pass.** Run: `npx playwright test e2e/smoke.spec.ts && npm run typecheck`. Expected: 6 passed (3 tests × 2 projects); typecheck clean.

- [ ] **Step 5: Commit.**

```bash
git add -A && git commit -m "feat: scaffold Masterpiece PWA with offline smoke tests"
```

---

### Task 2: Domain types, catalogues, validation and expiry bands

**Files:**
- Create: `src/domain/types.ts`, `src/domain/catalogues.ts`, `src/domain/dates.ts`, `src/domain/validation.ts`, `src/domain/expiry.ts`
- Test: `src/domain/dates.test.ts`, `src/domain/validation.test.ts`, `src/domain/expiry.test.ts`

**Interfaces:**
- Produces in `types.ts` (exact names; every later task imports from here):

```ts
export type Scope = 'ship' | 'personal';
export interface BaseRecord { id: string; createdAt: string; updatedAt: string; updatedBy: string; deleted: boolean; scope: Scope }
export interface Particulars { name: string; imo: string; callSign: string; mmsi: string; flag: string; portOfRegistry: string;
  gt?: number; nt?: number; dwt?: number; loa?: number; beam?: number; yearBuilt?: number;
  owners: string; managers: string; pandi: string; classSociety: string }
export type CrewField = 'surname' | 'givenNames' | 'fullName' | 'rank' | 'nationality' | 'dateOfBirth' | 'placeOfBirth'
  | 'passportNo' | 'passportExpiry' | 'seamansBookNo' | 'seamansBookExpiry' | 'signOnDate' | 'signOnPort' | 'signOffDate' | 'signOffPort';
export type DateFormat = 'day-first' | 'year-first';
export interface CrewImportMapping { byHeader: Record<string, CrewField>; dateFormat: DateFormat }
export interface ShipProfile extends BaseRecord { particulars: Particulars; crewImportMapping?: CrewImportMapping }
export type RankKey = 'master' | 'chiefOfficer' | 'secondOfficer' | 'thirdOfficer' | 'deckCadet' | 'bosun' | 'ab' | 'os'
  | 'chiefEngineer' | 'secondEngineer' | 'thirdEngineer' | 'fourthEngineer' | 'eto' | 'engineCadet' | 'fitter' | 'oiler'
  | 'wiper' | 'chiefCook' | 'messman' | 'other';
export interface CrewMember extends BaseRecord { shipId: string; surname: string; givenNames: string; rank: RankKey; rankOther?: string;
  nationality: string; dateOfBirth: string; placeOfBirth: string; passportNo: string; passportExpiry: string;
  seamansBookNo: string; seamansBookExpiry: string; signOnDate: string; signOnPort: string; signOffDate?: string; signOffPort?: string }
export interface Voyage extends BaseRecord { shipId: string; active: boolean; voyageNo: string; lastPort: string; nextPort: string;
  etaLocal: string; etaOffsetMinutes: number; cargo: string; charterers: string; agents: string }
export interface Certificate extends BaseRecord { shipId: string; key: string; name: string; number: string; issuedBy: string;
  issueDate: string; expiryDate?: string; nextSurveyDue?: string; remarks: string }
export interface ClockChange extends BaseRecord { shipId: string; effectiveAt: string; toOffsetMinutes: number; note?: string }
export type SyncRecord = ShipProfile | CrewMember | Voyage | Certificate | ClockChange;
export type TableName = 'ships' | 'crew' | 'voyages' | 'certificates' | 'clockChanges';
export const TABLE_NAMES: readonly TableName[] = ['ships', 'crew', 'voyages', 'certificates', 'clockChanges'];
export type Tables = Record<TableName, SyncRecord[]>;
export interface PinHash { salt: string; hash: string; iterations: number }
export interface LockoutState { failures: number; lockedUntil?: string }
export interface PinSettings { hash: PinHash; relockMinutes: number; lockout: LockoutState }
export type Theme = 'day' | 'night' | 'contrast';
export interface Settings { key: 'device'; deviceId: string; deviceName: string; activeShipId?: string; backupReminderDays: number;
  lastExportAt?: string; lastSync: Record<string, string>; theme: Theme; pin?: PinSettings; firstExportDone?: boolean }
export type SnapshotReason = 'before-import' | 'before-update' | 'manual';
export interface Snapshot { id: string; createdAt: string; reason: SnapshotReason; note?: string; data: Tables }
export type Band = 'none' | 'ok' | 'amber' | 'red';
export interface FieldError { field: string; message: string; severity: 'error' | 'warning' }
export type CrewDraft = Omit<CrewMember, keyof BaseRecord | 'shipId'>;
```

- Produces in `catalogues.ts`:
  - `RANKS: readonly { key: RankKey; label: string }[]` in the spec §4.2 order: Master, Chief Officer, 2nd Officer, 3rd Officer, Deck Cadet, Bosun, AB, OS, Chief Engineer, 2nd Engineer, 3rd Engineer, 4th Engineer, ETO, Engine Cadet, Fitter, Oiler, Wiper, Chief Cook, Messman, Other.
  - `rankLabel(m: Pick<CrewMember, 'rank' | 'rankOther'>): string`.
  - `CERTIFICATES: readonly { key: string; name: string; group: string }[]`: every certificate in spec §4.6, with camelCase keys including `loadLine`, `safetyConstruction`, `safetyEquipment`, `safetyRadio`, `iopp`, `ispp`, `iapp`, `iee`, `bwm`, `iafs`, `ihm`, `docIsm`, `smc`, `issc`, `mlc`, `dmlc1`, `dmlc2`, `registry`, `tonnage`, `csr`, `safeManning`, `classHull`, `classMachinery`, `grainAuthorization`, `docDangerousGoods`, `pandiEntry`, `bunkerClc`, `wreckRemoval`, `hullMachineryInsurance`, `sanitation`; plus `{ key: 'other', name: 'Other', group: 'Other' }`.
- Produces in `dates.ts`: `isValidIsoDate(s: string): boolean`, `addMonths(date: string, n: number): string` (clamps to month end), `addDays(date: string, n: number): string`.
- Produces in `validation.ts`:
  - `normaliseImo(s: string): string` strips a leading `IMO` and whitespace.
  - `isValidImo(s: string): boolean`, `isValidMmsi(s: string): boolean`.
  - `validateParticulars(p: Particulars): FieldError[]`, `validateCrewMember(m: CrewDraft, today: string): FieldError[]`, `validateCertificate(c: Pick<Certificate, 'issueDate' | 'expiryDate' | 'nextSurveyDue' | 'name'>): FieldError[]`.
- Produces in `expiry.ts`:
  - `expiryBand(expiry: string | undefined, ref: string, window: { months?: number; days?: number }): Band`. Red if `expiry < ref`; amber if `expiry ≤ ref + window`; otherwise ok; `'none'` if empty.
  - `worstBand(...b: Band[]): Band`, ranked red > amber > ok > none.
  - `crewDocBand(m: CrewDraft, ref: string): Band`: worst of passport and seaman's book, with a 6-month window.
  - `certificateBand(c: Pick<Certificate, 'expiryDate' | 'nextSurveyDue'>, ref: string): Band`: worst of expiry and survey, with a 90-day window.
- Exact messages:
  - IMO warning: `IMO check digit doesn't match — please re-check the number.`
  - Positive number: `Must be a positive number.`
  - MMSI: `MMSI must be 9 digits.`
  - Date: `Enter a valid date.`
  - Date of birth: `Date of birth must be in the past.`
  - Sign-off: `Sign-off can't be before sign-on.`
  - Certificate expiry: `Expiry date can't be before the issue date.`
  - Required: `<Label> is required.` (for example `Surname is required.`)

- [ ] **Step 1: Write the failing tests.**

```ts
// dates.test.ts
expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
expect(addMonths('2026-01-15', 6)).toBe('2026-07-15');
expect(addDays('2026-10-25', 90)).toBe('2027-01-23');
expect(isValidIsoDate('2026-02-30')).toBe(false);
expect(isValidIsoDate('2028-02-29')).toBe(true);

// validation.test.ts
expect(isValidImo('9074729')).toBe(true);
expect(isValidImo('IMO 9074729')).toBe(true);
for (const bad of ['9074728', '907472', '90747290', 'abcdefg']) expect(isValidImo(bad)).toBe(false);
expect(isValidMmsi('247123456')).toBe(true);
expect(isValidMmsi('24712345')).toBe(false);
expect(isValidMmsi('24712345a')).toBe(false);
expect(validateParticulars({ ...emptyParticulars, imo: '9074728' }))
  .toEqual([{ field: 'imo', severity: 'warning', message: "IMO check digit doesn't match — please re-check the number." }]);
expect(validateParticulars({ ...emptyParticulars, gt: -5 })[0]).toMatchObject({ field: 'gt', severity: 'error', message: 'Must be a positive number.' });
expect(validateParticulars({ ...emptyParticulars, mmsi: '123' })[0]).toMatchObject({ field: 'mmsi', severity: 'error' });
expect(validateCrewMember({ ...draft, dateOfBirth: '2027-01-01' }, '2026-10-25')[0]).toMatchObject({ field: 'dateOfBirth', message: 'Date of birth must be in the past.' });
expect(validateCrewMember({ ...draft, signOnDate: '2026-06-01', signOffDate: '2026-05-01' }, '2026-10-25')[0]).toMatchObject({ field: 'signOffDate' });
expect(validateCrewMember({ ...draft, passportExpiry: '2026-02-30' }, '2026-10-25')[0]).toMatchObject({ field: 'passportExpiry', message: 'Enter a valid date.' });
expect(validateCrewMember({ ...draft, surname: '' }, '2026-10-25')[0]).toMatchObject({ field: 'surname', message: 'Surname is required.' });
expect(validateCertificate({ name: 'Load Line', issueDate: '2026-05-01', expiryDate: '2026-04-01' })[0]).toMatchObject({ field: 'expiryDate', message: "Expiry date can't be before the issue date." });

// expiry.test.ts — ref '2026-10-25'
const crew = { months: 6 };
expect(expiryBand('2027-04-25', '2026-10-25', crew)).toBe('amber'); // boundary inclusive
expect(expiryBand('2027-04-26', '2026-10-25', crew)).toBe('ok');
expect(expiryBand('2026-10-25', '2026-10-25', crew)).toBe('amber'); // valid today
expect(expiryBand('2026-10-24', '2026-10-25', crew)).toBe('red');
expect(expiryBand(undefined, '2026-10-25', crew)).toBe('none');
expect(certificateBand({ expiryDate: '2027-01-23' }, '2026-10-25')).toBe('amber');
expect(certificateBand({ expiryDate: '2027-01-24' }, '2026-10-25')).toBe('ok');
expect(certificateBand({ expiryDate: '2030-01-01', nextSurveyDue: '2026-11-01' }, '2026-10-25')).toBe('amber');
expect(certificateBand({}, '2026-10-25')).toBe('none');
expect(crewDocBand({ ...draft, passportExpiry: '2030-01-01', seamansBookExpiry: '2026-01-01' }, '2026-10-25')).toBe('red');
```

In this test, `draft` is a valid `CrewDraft`: surname `PETROVIĆ`, rank `master`, signOnDate `2026-06-01`, other dates valid. `emptyParticulars` has empty strings and no numbers.

- [ ] **Step 2: Run them and confirm they fail.** Run: `npx vitest run src/domain`. Expected: FAIL, because the modules do not exist yet.
- [ ] **Step 3: Implement the four modules** with the signatures above. The IMO check: digits d1…d6 weighted 7, 6, 5, 4, 3, 2; the sum mod 10 must equal d7.
- [ ] **Step 4: Run them and confirm they pass.** Run: `npx vitest run src/domain`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add src/domain && git commit -m "feat: domain types, catalogues, validation, expiry bands"`

---

### Task 3: Ship's time

**Files:**
- Create: `src/domain/shipTime.ts`
- Test: `src/domain/shipTime.test.ts`

**Interfaces:**
- Consumes: `ClockChange` (Task 2).
- Produces:
  - `shipOffsetAt(changes: ClockChange[], instant: Date): number`. Ignores deleted changes; a change applies at or after `effectiveAt`; equal `effectiveAt` → later `createdAt` wins; before the first change → the first change's offset; no changes → 0.
  - `formatOffset(min: number): string`.
  - `isValidOffset(min: number): boolean`.
  - `OFFSET_OPTIONS: number[]` (−720…840, step 15).
  - `toShipLocal(instant: Date, offsetMin: number): { date: string; time: string; dateTime: string }`.
  - `shipLocalToInstant(dateTime: string, offsetMin: number): Date`.
  - `nextScheduledChange(changes: ClockChange[], now: Date): ClockChange | undefined`.
  - `deviceOffsetMinutes(now?: Date): number`: the device's offset rounded to the nearest 15.

- [ ] **Step 1: Write the failing tests.**

```ts
expect(formatOffset(180)).toBe('UTC+03:00');
expect(formatOffset(-570)).toBe('UTC-09:30');
expect(formatOffset(0)).toBe('UTC+00:00');
expect(formatOffset(345)).toBe('UTC+05:45');
expect([840, -720, 330].every(isValidOffset)).toBe(true);
expect([845, 855, 20].some(isValidOffset)).toBe(false);
const c1 = cc('2026-10-20T00:00:00.000Z', 60), c2 = cc('2026-10-24T23:00:00.000Z', 120);
expect(shipOffsetAt([c1, c2], new Date('2026-10-22T12:00:00Z'))).toBe(60);
expect(shipOffsetAt([c1, c2], new Date('2026-10-24T23:00:00Z'))).toBe(120);
expect(shipOffsetAt([c1, c2], new Date('2026-10-19T00:00:00Z'))).toBe(60);
expect(shipOffsetAt([], new Date())).toBe(0);
expect(shipOffsetAt([c1, { ...c2, deleted: true }], new Date('2026-10-25T00:00:00Z'))).toBe(60);
const a = cc('2026-10-24T00:00:00.000Z', 60, '2026-10-01T00:00:00.000Z'), b = cc('2026-10-24T00:00:00.000Z', 120, '2026-10-02T00:00:00.000Z');
expect(shipOffsetAt([b, a], new Date('2026-10-25T00:00:00Z'))).toBe(120);
expect(toShipLocal(new Date('2026-10-25T22:30:00Z'), 180)).toEqual({ date: '2026-10-26', time: '01:30', dateTime: '2026-10-26T01:30' });
// retard across midnight: local 00:30 on 26 Oct at +3 = 21:30Z; retard to +2 at that instant
const t = new Date('2026-10-25T21:30:00Z');
const changes = [cc('2026-10-01T00:00:00.000Z', 180), cc(t.toISOString(), 120)];
expect(toShipLocal(t, shipOffsetAt(changes, t))).toMatchObject({ date: '2026-10-25', time: '23:30' });
expect(shipLocalToInstant('2026-10-26T02:00', 180).toISOString()).toBe('2026-10-25T23:00:00.000Z');
expect(nextScheduledChange([c1, c2], new Date('2026-10-22T00:00:00Z'))?.id).toBe(c2.id);
expect(nextScheduledChange([c1, c2], new Date('2026-10-25T00:00:00Z'))).toBeUndefined();
```

`cc(effectiveAt, toOffsetMinutes, createdAt?)` is a local test helper that builds a `ClockChange`.

- [ ] **Step 2: Run them and confirm they fail.** Run: `npx vitest run src/domain/shipTime.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `shipTime.ts`** with the signatures above.
- [ ] **Step 4: Run them and confirm they pass.** Run: `npx vitest run src/domain/shipTime.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add src/domain && git commit -m "feat: ship's time offsets and clock changes"`

---

### Task 4: Crew rules and field dictionary

**Files:**
- Create: `src/domain/crew.ts`, `src/domain/fieldDictionary.ts`
- Test: `src/domain/crew.test.ts`, `src/domain/fieldDictionary.test.ts`

**Interfaces:**
- Consumes: Task 2 types and `RANKS`; Task 3 `shipOffsetAt`, `toShipLocal`, `formatOffset`.
- Produces in `crew.ts`:
  - `isOnboardAt(m: CrewMember, date: string): boolean`.
  - `onboardAt(crew: CrewMember[], date: string): CrewMember[]`: non-deleted, sorted by `RANKS` order, then `signOnDate` ascending, then surname.
  - `fullName(m): string` = `` `${givenNames} ${surname}`.trim() ``.
  - `normalisePassport(s: string): string`: uppercase, whitespace removed.
  - `latestContractByPassport(crew: CrewMember[], passportNo: string): CrewMember | undefined`: non-deleted, latest `signOnDate`.
  - `rejoinDraft(m: CrewMember, signOnDate: string, signOnPort: string): CrewDraft`. Copies personal and document fields, sets the new sign-on, and clears sign-off.
- Produces in `fieldDictionary.ts`:
  - `interface FieldContext { ship: ShipProfile; crew: CrewMember[]; voyages: Voyage[]; certificates: Certificate[]; clockChanges: ClockChange[]; nowUtc: Date }`.
  - `type FieldValue = string | number | CrewMember[] | undefined`.
  - `resolveField(name: string, ctx: FieldContext, opts?: { asAt?: string }): FieldValue`.
  - `FIELD_NAMES: readonly string[]`: every `vessel.*` and `voyage.*` name from spec §4.2, plus `today`, `now`, `nowUtc`, `ship.timeZone`, `crew.onboard`, `crew.onboardCount`.
- **Decisions:**
  - `asAt` (default: ship's today) affects `crew.*` and `today` only. `now` and `nowUtc` are always the real current time.
  - `crew.byRank.<rank>.<field>` takes the first entry of `onboardAt` with that rank. `<field>` is any `CrewMember` field or `fullName`.
  - `voyage.*` reads the non-deleted voyage with `active: true`.
  - `cert.<key>.<field>` reads the non-deleted certificate with that key.
  - Deleted records are always ignored. An unknown name → `undefined`.

- [ ] **Step 1: Write the failing tests.**

```ts
// crew.test.ts
const m = crewMember({ signOnDate: '2026-06-01' });
expect(isOnboardAt(m, '2026-06-01')).toBe(true);
expect(isOnboardAt(m, '2026-05-31')).toBe(false);
expect(isOnboardAt(m, '2027-01-01')).toBe(true);
const off = { ...m, signOffDate: '2026-10-10' };
expect(isOnboardAt(off, '2026-10-10')).toBe(true);
expect(isOnboardAt(off, '2026-10-11')).toBe(false);
expect(normalisePassport(' 012 345 ab ')).toBe('012345AB');
const r = rejoinDraft({ ...off, signOffPort: 'Santos' }, '2027-02-01', 'Rotterdam');
expect(r).toMatchObject({ surname: off.surname, passportNo: off.passportNo, signOnDate: '2027-02-01', signOnPort: 'Rotterdam' });
expect(r.signOffDate).toBeUndefined();
expect(r.signOffPort).toBeUndefined();

// fieldDictionary.test.ts — ctx: ship 'MV OCEAN STAR' gt 32500; clock +180 since 2026-10-01;
// nowUtc 2026-10-25T22:30:00Z; old master Ivan Petrović signOn 2026-03-01 signOff 2026-09-01;
// new master Marko Šašić signOn 2026-09-01; active voyage nextPort 'Rotterdam'; cert loadLine expiry '2029-03-14'
expect(resolveField('vessel.name', ctx)).toBe('MV OCEAN STAR');
expect(resolveField('vessel.gt', ctx)).toBe(32500);
expect(resolveField('crew.byRank.master.fullName', ctx, { asAt: '2026-08-15' })).toBe('Ivan Petrović');
expect(resolveField('crew.byRank.master.fullName', ctx, { asAt: '2026-09-02' })).toBe('Marko Šašić');
expect(resolveField('crew.onboardCount', ctx, { asAt: '2026-09-01' })).toBe(2);
expect(resolveField('crew.byRank.bosun.fullName', ctx)).toBeUndefined();
expect(resolveField('cert.loadLine.expiryDate', ctx)).toBe('2029-03-14');
expect(resolveField('voyage.nextPort', ctx)).toBe('Rotterdam');
expect(resolveField('voyage.nextPort', { ...ctx, voyages: [] })).toBeUndefined();
expect(resolveField('today', ctx)).toBe('2026-10-26');
expect(resolveField('today', ctx, { asAt: '2026-08-15' })).toBe('2026-08-15');
expect(resolveField('now', ctx)).toBe('2026-10-26T01:30');
expect(resolveField('nowUtc', ctx)).toBe('2026-10-25T22:30:00.000Z');
expect(resolveField('ship.timeZone', ctx)).toBe('UTC+03:00');
expect(resolveField('vessel.colour', ctx)).toBeUndefined();
expect(resolveField('crew.byRank.master.fullName', { ...ctx, crew: ctx.crew.map(c => ({ ...c, deleted: true })) })).toBeUndefined();
```

- [ ] **Step 2: Run them and confirm they fail.** Run: `npx vitest run src/domain/crew.test.ts src/domain/fieldDictionary.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `crew.ts` and `fieldDictionary.ts`.**
- [ ] **Step 4: Run them and confirm they pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `git add src/domain && git commit -m "feat: crew onboard rules and field dictionary"`

---

### Task 5: Spreadsheet and CSV reading, header detection

**Files:**
- Create: `src/domain/crewImport/csv.ts`, `src/domain/crewImport/readSpreadsheet.ts`, `src/domain/crewImport/header.ts`, `src/test/makeWorkbook.ts`
- Modify: `package.json` (add SheetJS from the CDN tarball, per Global Constraints)
- Test: `src/domain/crewImport/csv.test.ts`, `src/domain/crewImport/readSpreadsheet.test.ts`, `src/domain/crewImport/header.test.ts`

**Interfaces:**
- Consumes: `CrewField` (Task 2).
- Produces:
  - `type Cell = string | number | boolean | Date | null`; `interface SheetGrid { name: string; rows: Cell[][] }`.
  - `parseCsv(text: string): string[][]`. Strips a BOM, handles `"` quoting with `""` escapes and CRLF, and drops trailing empty lines. The delimiter is `;` when the first line has more unquoted `;` than `,`.
  - `readSpreadsheet(fileName: string, data: ArrayBuffer): Promise<SheetGrid[]>`:
    - `.xlsx` or `.xls` (case-insensitive) → `XLSX.read(new Uint8Array(data), { type: 'array', cellNF: true, cellDates: false })`.
      - Build each sheet's grid from cell **(0,0)** to the end of `!ref`, so `rows[i][j]` is sheet row i+1, column j+1, even when `!ref` starts lower.
      - Cell values by type: `s` → string; `b` → boolean; `e` or missing → `null`; `d` → `Date`.
      - `n` → number, unless `XLSX.SSF.is_date(cell.z)` is true. In that case it becomes a `Date` at **UTC midnight** of the serial (`Date.UTC(1899, 11, 30) + Math.floor(v) × 86400000`). Never rely on SheetJS local-time date conversion.
    - `.csv` → UTF-8 decode, then `parseCsv`; the sheet name is the file name without its extension.
  - `class UnsupportedFileError extends Error` with message `This file type isn't supported. Use an Excel file (.xlsx or .xls) or a CSV file.`
  - `class UnreadableFileError extends Error` with message `This file can't be read. If it's password-protected in Excel, remove the password, save it again and retry.` Thrown when SheetJS fails to parse the file.
  - `normaliseHeader(s: Cell): string`: NFD, strip `\p{M}`, lowercase, remove every non-`[a-z0-9]`.
  - `HEADER_SYNONYMS: Record<CrewField, string[]>`, with the normalised values from the table below.
  - `matchHeader(cell: Cell): CrewField | undefined`: an exact synonym match first. Otherwise, the longest synonym of at least 4 characters that the normalised header starts with. This handles headers like "Date of birth (DD.MM.YYYY)".
  - `detectHeaderRow(rows: Cell[][]): number`: the first row within the first 15 where `matchHeader` recognises ≥ 3 cells; otherwise the index of the first non-empty row.
  - Test helper `makeWorkbook(sheets: { name: string; rows: (string | number | null)[][] }[], bookType: 'xlsx' | 'biff8', dateCells?: { sheet: number; addr: string; serial: number }[]): ArrayBuffer`.
    - It uses `XLSX.utils.aoa_to_sheet` and `XLSX.write({ type: 'array', bookType })`.
    - Each `dateCells` entry is written as `{ t: 'n', v: serial, z: 'dd.mm.yyyy' }`, which gives a timezone-independent date fixture.

| CrewField | Synonyms (normalised) |
|---|---|
| surname | surname, familyname, lastname |
| givenNames | givennames, givenname, firstname, firstnames, forename, forenames, christianname |
| fullName | name, names, fullname, nameofseafarer, familynamegivennames, surnameandgivennames, nameandsurname |
| rank | rank, rankrating, rankorrating, position, capacity, function, designation |
| nationality | nationality, citizenship |
| dateOfBirth | dateofbirth, dob, birthdate, born |
| placeOfBirth | placeofbirth, pob, birthplace |
| passportNo | passportno, passportnumber, passport, ppno, passportnr |
| passportExpiry | passportexpiry, passportexpirydate, passportvalidity, passportvaliduntil, ppexpiry |
| seamansBookNo | seamansbookno, seamansbook, seamanbook, seamansbooknumber, sbno, cdc, cdcno, dischargebook |
| seamansBookExpiry | seamansbookexpiry, sbexpiry, cdcexpiry, seamansbookvalidity |
| signOnDate | signondate, signon, dateofembarkation, embarkationdate, joined, joiningdate, dateofjoining |
| signOnPort | signonport, portofembarkation, embarkationport, placeofjoining, portofjoining, joiningport |
| signOffDate | signoffdate, signoff, dateofdisembarkation, disembarkationdate |
| signOffPort | signoffport, portofdisembarkation, disembarkationport |

- [ ] **Step 1: Write the failing tests.**

```ts
expect(parseCsv('Surname,Given names\r\n"Smith, Jr",John\r\n')).toEqual([['Surname', 'Given names'], ['Smith, Jr', 'John']]);
expect(parseCsv('Surname;Rank\nPetrović;Master')).toEqual([['Surname', 'Rank'], ['Petrović', 'Master']]);
expect(parseCsv('﻿a,"He said ""hi"""\n\n\n')).toEqual([['a', 'He said "hi"']]);
const book = [{ name: 'Crew', rows: [['Surname', 'DOB', 'No'], ['PETROVIĆ', null, 7]] }, { name: 'Notes', rows: [['x']] }];
const dob = [{ sheet: 0, addr: 'B2', serial: 31052 }];
for (const [fileName, type] of [['CREW.XLSX', 'xlsx'], ['crew.xls', 'biff8']] as const) {
  const sheets = await readSpreadsheet(fileName, makeWorkbook(book, type, dob));
  expect(sheets.map(s => s.name)).toEqual(['Crew', 'Notes']);
  expect(sheets[0].rows[1]).toEqual(['PETROVIĆ', new Date(Date.UTC(1985, 0, 5)), 7]);
}
// a sheet whose used range starts at C3 still maps to sheet rows and columns
const offset = XLSX.utils.book_new(); const ws = XLSX.utils.aoa_to_sheet([['Surname']], { origin: 'C3' });
XLSX.utils.book_append_sheet(offset, ws, 'S');
const grid = (await readSpreadsheet('o.xlsx', XLSX.write(offset, { type: 'array', bookType: 'xlsx' })))[0].rows;
expect(grid[2][2]).toBe('Surname');
expect(grid[0][0]).toBeNull();
const csv = await readSpreadsheet('crew.csv', new TextEncoder().encode('Surname\nŠašić').buffer);
expect(csv).toEqual([{ name: 'crew', rows: [['Surname'], ['Šašić']] }]);
await expect(readSpreadsheet('crew.pdf', new ArrayBuffer(8))).rejects.toBeInstanceOf(UnsupportedFileError);
await expect(readSpreadsheet('crew.xlsx', new TextEncoder().encode('not a workbook \u0000\u0001').buffer)).rejects.toBeInstanceOf(UnreadableFileError);
expect(normaliseHeader("Seaman's Book No.")).toBe('seamansbookno');
expect(normaliseHeader('Date of Birth (DD.MM.YYYY)')).toBe('dateofbirthddmmyyyy');
expect(matchHeader('Date of Birth (DD.MM.YYYY)')).toBe('dateOfBirth');
expect(matchHeader('Passport expiry date')).toBe('passportExpiry');
expect(matchHeader('Passport No.')).toBe('passportNo');
expect(matchHeader('Nationality')).toBe('nationality');
expect(matchHeader('Remarks')).toBeUndefined();
// Review Focus 1: title rows above the header
expect(detectHeaderRow([['CREW LIST'], ['MV OCEAN STAR', null, 'IMO 9074729'], [], ['No.', 'Surname', 'Given names', 'Rank', 'Nationality', 'Passport No'], ['1', 'PETROVIĆ', 'Ivan', 'Master', 'Serbian', '012345678']])).toBe(3);
expect(detectHeaderRow([[], ['foo', 'bar'], ['1', '2']])).toBe(1);
```

- [ ] **Step 2: Run them and confirm they fail.** Run: `npx vitest run src/domain/crewImport`. Expected: FAIL.
- [ ] **Step 3: Implement the three modules and the test helper.**
- [ ] **Step 4: Run them and confirm they pass.** Run: `npx vitest run src/domain/crewImport`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: read crew spreadsheets and detect header row"`

---

### Task 6: Crew import mapping, value parsing and preview

**Files:**
- Create: `src/domain/crewImport/mapping.ts`, `src/domain/crewImport/values.ts`, `src/domain/crewImport/preview.ts`
- Test: `src/domain/crewImport/mapping.test.ts`, `src/domain/crewImport/values.test.ts`, `src/domain/crewImport/preview.test.ts`

**Interfaces:**
- Consumes: Task 5 `Cell`, `normaliseHeader`, `HEADER_SYNONYMS`; Task 4 `normalisePassport`, `latestContractByPassport`; Task 2 `validateCrewMember`, types.
- Produces:
  - `type ColumnMapping = Partial<Record<CrewField, number>>`.
  - `guessMapping(header: Cell[]): ColumnMapping`: for each field, the first column where `matchHeader` (Task 5) returns that field.
  - `applySavedMapping(header: Cell[], saved: CrewImportMapping | undefined): ColumnMapping`: the guess, overridden by saved entries whose `byHeader` key matches a column's normalised header.
  - `toSavedMapping(header: Cell[], mapping: ColumnMapping, dateFormat: DateFormat): CrewImportMapping`.
  - `parseDateCell(v: Cell, fmt: DateFormat, currentYear: number): string | null | 'invalid'`:
    - `null` means empty.
    - A `Date` uses its UTC parts.
    - A number in 1–2958465 is an Excel serial (epoch 1899-12-30).
    - Text:
      - Patterns that start with 4 digits (`YYYY-MM-DD`, `YYYY/M/D`) are accepted in **both** modes.
      - In day-first mode, `D.M.YYYY`, `D/M/YYYY`, `D-M-YYYY` and `D-MMM-YYYY` (English month abbreviations, any case) are accepted, with 1–2 digit day and month.
      - A two-digit year `yy` becomes `2000+yy` if `yy ≤ (currentYear % 100) + 15`, otherwise `1900+yy`.
    - Anything else, or an impossible date → `'invalid'`.
  - `parseRank(text: string): { rank: RankKey; rankOther?: string }`. Matches the normalised text against the table below. No match → `{ rank: 'other', rankOther: text.trim() }`; empty → `{ rank: 'other', rankOther: '' }`.
  - `splitFullName(text: string): { surname: string; givenNames: string }`:
    - With a comma, the part before the comma is the surname.
    - Otherwise the leading words written in capitals form the surname. A capitals word has letters and equals its own `toUpperCase()`.
    - Otherwise the last word is the surname.
  - `interface PreviewRow { rowNumber: number; status: 'new' | 'update' | 'error'; draft: CrewDraft; existingId?: string; changes: { field: keyof CrewDraft; from: string; to: string }[]; errors: FieldError[]; skip: boolean }`.
  - `buildPreview(input: { rows: Cell[][]; headerRow: number; mapping: ColumnMapping; dateFormat: DateFormat; existing: CrewMember[]; currentYear: number; today: string; defaultSignOnDate: string }): PreviewRow[]`.
  - `revalidateRow(row: PreviewRow, existing: CrewMember[], today: string): PreviewRow`.
- **Rules:**
  - `rowNumber` is the 1-based sheet row.
  - Rows with no value in the surname, givenNames, fullName or passportNo columns are skipped. This drops footers and blank rows.
  - A missing sign-on date takes `defaultSignOnDate`.
  - Required fields: surname, rank (`rankOther` may not be empty when rank is `other`), signOnDate. An invalid date gives the error `Enter a valid date.` on that field.
  - If the normalised passport number matches `latestContractByPassport`, the status is `update` with `existingId`. Empty file cells never overwrite existing values. Identical values give `changes: []` ("No changes").
  - Text cells are trimmed but otherwise kept exactly as typed.

| RankKey | Synonyms (normalised) |
|---|---|
| master | master, captain, capt, mstr |
| chiefOfficer | chiefofficer, chiefmate, co, cmate, choff, chofficer, firstofficer, 1stofficer, 1o |
| secondOfficer | secondofficer, 2ndofficer, 2o, secondmate, 2ndmate |
| thirdOfficer | thirdofficer, 3rdofficer, 3o, thirdmate, 3rdmate |
| deckCadet | deckcadet, cadet, dcadet, deckapprentice |
| bosun | bosun, boatswain, bsn |
| ab | ab, ablebodied, ableseaman, ablebodiedseaman |
| os | os, ordinaryseaman |
| chiefEngineer | chiefengineer, ce, chiefeng, cheng |
| secondEngineer | secondengineer, 2ndengineer, 2e |
| thirdEngineer | thirdengineer, 3rdengineer, 3e |
| fourthEngineer | fourthengineer, 4thengineer, 4e |
| eto | eto, electrotechnicalofficer, electrician, elec, electricalofficer |
| engineCadet | enginecadet, ecadet, engcadet |
| fitter | fitter |
| oiler | oiler, motorman |
| wiper | wiper |
| chiefCook | chiefcook, cook, chcook |
| messman | messman, messboy |

- [ ] **Step 1: Write the failing tests.**

```ts
// mapping.test.ts
expect(guessMapping(['No.', 'Surname', 'Given names', 'Rank', 'Nationality', 'Date of birth', 'Passport No', 'Passport expiry', "Seaman's book No.", 'Sign on']))
  .toEqual({ surname: 1, givenNames: 2, rank: 3, nationality: 4, dateOfBirth: 5, passportNo: 6, passportExpiry: 7, seamansBookNo: 8, signOnDate: 9 });
expect(guessMapping(['Name', 'Rank'])).toEqual({ fullName: 0, rank: 1 });
const saved = toSavedMapping(['Prezime', 'Rank'], { surname: 0, rank: 1 }, 'day-first');
expect(applySavedMapping(['Rank', 'Prezime'], saved)).toEqual({ rank: 0, surname: 1 });

// values.test.ts
expect(parseDateCell('05.01.1985', 'day-first', 2026)).toBe('1985-01-05');
expect(parseDateCell('5/1/85', 'day-first', 2026)).toBe('1985-01-05');
expect(parseDateCell('05/01/30', 'day-first', 2026)).toBe('2030-01-05');
expect(parseDateCell('05-JAN-1985', 'day-first', 2026)).toBe('1985-01-05');
expect(parseDateCell('5-jan-85', 'day-first', 2026)).toBe('1985-01-05');
expect(parseDateCell('1985-01-05', 'day-first', 2026)).toBe('1985-01-05');
expect(parseDateCell('1985/1/5', 'year-first', 2026)).toBe('1985-01-05');
expect(parseDateCell(31052, 'day-first', 2026)).toBe('1985-01-05');
expect(parseDateCell(new Date(Date.UTC(1985, 0, 5)), 'day-first', 2026)).toBe('1985-01-05');
expect(parseDateCell('31.02.1985', 'day-first', 2026)).toBe('invalid');
expect(parseDateCell('n/a', 'day-first', 2026)).toBe('invalid');
expect(parseDateCell('', 'day-first', 2026)).toBeNull();
expect(parseDateCell(null, 'day-first', 2026)).toBeNull();
expect(parseRank('CAPT.')).toEqual({ rank: 'master' });
expect(parseRank('C/O')).toEqual({ rank: 'chiefOfficer' });
expect(parseRank('Chief Mate')).toEqual({ rank: 'chiefOfficer' });
expect(parseRank('2/O')).toEqual({ rank: 'secondOfficer' });
expect(parseRank('A/B')).toEqual({ rank: 'ab' });
expect(parseRank('C/E')).toEqual({ rank: 'chiefEngineer' });
expect(parseRank('Electrician')).toEqual({ rank: 'eto' });
expect(parseRank('Pumpman')).toEqual({ rank: 'other', rankOther: 'Pumpman' });
expect(splitFullName('PETROVIĆ, Ivan')).toEqual({ surname: 'PETROVIĆ', givenNames: 'Ivan' });
expect(splitFullName('PETROVIĆ Ivan Marko')).toEqual({ surname: 'PETROVIĆ', givenNames: 'Ivan Marko' });
expect(splitFullName('VAN DER BERG Jan')).toEqual({ surname: 'VAN DER BERG', givenNames: 'Jan' });
expect(splitFullName('Ivan Petrović')).toEqual({ surname: 'Petrović', givenNames: 'Ivan' });

// preview.test.ts — rows: [title], [header: Surname, Given names, Rank, Date of birth, Passport No, Sign on],
// ['PETROVIĆ','Ivan','Master','05.01.1985','012345678','01.06.2026'],
// ["O'BRIEN",'Jean-Luc','A/B','31.02.1990','X1',''],
// ['ŠAŠIĆ','Marko','C/O','','P 77',''], [], ['Total crew: 3']
// existing: one CrewMember passportNo '012 345 678', rank 'chiefOfficer', all else same
const rows = buildPreview({ rows, headerRow: 1, mapping: guessMapping(rows[1]), dateFormat: 'day-first', existing, currentYear: 2026, today: '2026-10-25', defaultSignOnDate: '2026-10-25' });
expect(rows.map(r => r.rowNumber)).toEqual([3, 4, 5]); // footer and blank skipped
expect(rows[0]).toMatchObject({ status: 'update', existingId: existing[0].id, changes: [{ field: 'rank', from: 'chiefOfficer', to: 'master' }] });
expect(rows[1].status).toBe('error');
expect(rows[1].errors[0]).toMatchObject({ field: 'dateOfBirth', message: 'Enter a valid date.' });
expect(rows[1].draft).toMatchObject({ surname: "O'BRIEN", givenNames: 'Jean-Luc', rank: 'ab', signOnDate: '2026-10-25' });
expect(rows[2]).toMatchObject({ status: 'new', draft: { surname: 'ŠAŠIĆ', rank: 'chiefOfficer', passportNo: 'P 77' } });
const fixed = revalidateRow({ ...rows[1], draft: { ...rows[1].draft, dateOfBirth: '1990-02-28' } }, existing, '2026-10-25');
expect(fixed.status).toBe('new');
```

- [ ] **Step 2: Run them and confirm they fail.** Run: `npx vitest run src/domain/crewImport`. Expected: FAIL in the three new test files.
- [ ] **Step 3: Implement `mapping.ts`, `values.ts` and `preview.ts`.**
- [ ] **Step 4: Run them and confirm they pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `git add src/domain && git commit -m "feat: crew import mapping, date/rank parsing and preview"`

---

### Task 7: Merge engine

**Files:**
- Create: `src/domain/merge.ts`
- Test: `src/domain/merge.test.ts`

**Interfaces:**
- Consumes: `Tables`, `TableName`, `SyncRecord`, `TABLE_NAMES` (Task 2).
- Produces:
  - `interface MergeItem { table: TableName; id: string; kind: 'add' | 'update' | 'delete' | 'conflict'; local?: SyncRecord; incoming: SyncRecord }`.
  - `interface MergePlan { items: MergeItem[]; summary: { added: number; updated: number; deleted: number; conflicts: number } }`.
  - `sameContent(a: SyncRecord, b: SyncRecord): boolean`: deep-equal, ignoring `updatedAt` and `updatedBy`.
  - `computeMerge(local: Tables, incoming: Tables, lastSync: string | undefined): MergePlan`.
  - `conflictKey(item: MergeItem): string` = `` `${table}:${id}` ``.
  - `resolveMerge(plan: MergePlan, decisions: { conflicts: Record<string, 'local' | 'incoming'>; applyDeletions: boolean }, now: string, deviceId: string): { table: TableName; record: SyncRecord }[]`.
- **Rules** (spec §4.7):
  - With `lastSync` undefined, both sides count as changed.
  - A side has changed when its `updatedAt > lastSync`.
  - An incoming tombstone that is not present locally → `add`, but it is not counted in `summary.added`.
  - `resolveMerge` returns the incoming record for add, update and delete. For a conflict it returns the chosen side with `updatedAt = now` and `updatedBy = deviceId`. Deletes are left out when `applyDeletions` is false.
  - An unresolved conflict throws `Error('Unresolved conflict: <key>')`.

- [ ] **Step 1: Write the failing tests.** `lastSync = '2026-10-20T00:00:00.000Z'`. Helper `rec(id, updatedAt, patch?)` builds a crew record; `T(crew)` builds `Tables` with only crew.

```ts
expect(computeMerge(T([]), T([rec('a', '2026-10-22')]), L).summary).toEqual({ added: 1, updated: 0, deleted: 0, conflicts: 0 });
const tomb = computeMerge(T([]), T([rec('a', '2026-10-22', { deleted: true })]), L);
expect(tomb.items[0].kind).toBe('add'); expect(tomb.summary.added).toBe(0);
expect(computeMerge(T([rec('a', '2026-10-19')]), T([rec('a', '2026-10-22')]), L).items).toEqual([]); // same content
expect(computeMerge(T([rec('a', '2026-10-19')]), T([rec('a', '2026-10-22', { nationality: 'Croatian' })]), L).items[0].kind).toBe('update');
expect(computeMerge(T([rec('a', '2026-10-22', { nationality: 'Croatian' })]), T([rec('a', '2026-10-19')]), L).items).toEqual([]);
expect(computeMerge(T([rec('a', '2026-10-21', { nationality: 'A' })]), T([rec('a', '2026-10-22', { nationality: 'B' })]), L).items[0].kind).toBe('conflict');
expect(computeMerge(T([rec('a', '2026-10-18', { nationality: 'A' })]), T([rec('a', '2026-10-19', { nationality: 'B' })]), L).items[0].kind).toBe('update');
expect(computeMerge(T([rec('a', '2026-10-19', { nationality: 'A' })]), T([rec('a', '2026-10-18', { nationality: 'B' })]), L).items).toEqual([]);
const del = computeMerge(T([rec('a', '2026-10-19')]), T([rec('a', '2026-10-22', { deleted: true })]), L);
expect(del.items[0].kind).toBe('delete'); expect(del.summary.deleted).toBe(1);
expect(computeMerge(T([rec('a', '2026-10-19', { nationality: 'A' })]), T([rec('a', '2026-10-18', { nationality: 'B' })]), undefined).items[0].kind).toBe('conflict');
const cp = computeMerge(T([rec('a', '2026-10-21', { nationality: 'A' })]), T([rec('a', '2026-10-22', { nationality: 'B' })]), L);
const out = resolveMerge(cp, { conflicts: { 'crew:a': 'local' }, applyDeletions: false }, '2026-10-25T10:00:00.000Z', 'dev-B');
expect(out[0].record).toMatchObject({ nationality: 'A', updatedAt: '2026-10-25T10:00:00.000Z', updatedBy: 'dev-B' });
expect(resolveMerge(del, { conflicts: {}, applyDeletions: false }, 'x', 'd')).toEqual([]);
expect(resolveMerge(del, { conflicts: {}, applyDeletions: true }, 'x', 'd')).toHaveLength(1);
expect(() => resolveMerge(cp, { conflicts: {}, applyDeletions: true }, 'x', 'd')).toThrow('Unresolved conflict: crew:a');
```

`rec()` dates are written as full ISO strings (`'2026-10-22T00:00:00.000Z'`); they are shortened above. `L` is `lastSync`.

- [ ] **Step 2: Run them and confirm they fail.** Run: `npx vitest run src/domain/merge.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `merge.ts`.**
- [ ] **Step 4: Run them and confirm they pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `git add src/domain && git commit -m "feat: backup merge engine with conflicts and tombstones"`

---

### Task 8: Backup encryption envelope

**Files:**
- Create: `src/backup/crypto.ts`, `src/backup/envelope.ts`
- Test: `src/backup/envelope.test.ts`

**Interfaces:**
- Consumes: `Tables`, `TABLE_NAMES` (Task 2).
- Produces:
  - `interface KdfParams { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string }` (base64).
  - `encryptBytes(plain: Uint8Array, password: string, aad: Uint8Array, opts?: { iterations?: number }): Promise<{ kdf: KdfParams; iv: string; ciphertext: string }>` (default 600000 iterations).
  - `decryptBytes(env: { kdf: KdfParams; iv: string; ciphertext: string }, password: string, aad: Uint8Array): Promise<Uint8Array>`.
  - `interface BackupHeader { format: 'masterpiece-backup'; version: 1; kind: 'full' | 'handover'; deviceId: string; deviceName: string; exportedAt: string }`.
  - `interface BackupPayload { tables: Tables }`.
  - `sealBackup(header: BackupHeader, payload: BackupPayload, password: string, opts?: { iterations?: number }): Promise<string>`: JSON text of `{ ...header, kdf, iv, ciphertext }`.
  - `readHeader(text: string): BackupHeader`: no password needed.
  - `openBackup(text: string, password: string): Promise<{ header: BackupHeader; payload: BackupPayload }>`.
  - `validatePassword(pw: string): string | null`.
  - AAD = UTF-8 of `JSON.stringify` of the header with keys in the order format, version, kind, deviceId, deviceName, exportedAt. A tampered header therefore fails to decrypt.
  - Error classes with exact `message`:
    - `NotABackupError`: `This isn't a Masterpiece backup file.`
    - `NewerVersionError`: `This backup was made by a newer version of Masterpiece. Connect to the internet and reopen the app to update it, then try again.`
    - `WrongPasswordError`: `Wrong password, or the file is damaged. Nothing was changed.`
    - `DamagedFileError`: `The file is damaged and can't be read. Nothing was changed.`
    - Password rule: `Use at least 8 characters.`
- Before parsing, `readHeader` and `openBackup` strip a BOM and trim whitespace. After decrypting, the payload must have every `TABLE_NAMES` key as an array whose records have string `id` and `updatedAt`; otherwise `DamagedFileError`.

- [ ] **Step 1: Write the failing tests.**

```ts
const H: BackupHeader = { format: 'masterpiece-backup', version: 1, kind: 'full', deviceId: 'dev-A', deviceName: 'Android device', exportedAt: '2026-10-25T10:00:00.000Z' };
const P = { tables: { ships: [], crew: [crewRec({ surname: 'Šašić' })], voyages: [], certificates: [], clockChanges: [] } };
const text = await sealBackup(H, P, 'lozinka-ćevapi', { iterations: 1000 });
expect(await openBackup(text, 'lozinka-ćevapi')).toEqual({ header: H, payload: P });
expect(await openBackup('﻿' + text + '\r\n', 'lozinka-ćevapi')).toEqual({ header: H, payload: P });
expect(readHeader(text)).toEqual(H);
await expect(openBackup(text, 'wrong-password')).rejects.toBeInstanceOf(WrongPasswordError);
const j = JSON.parse(text);
await expect(openBackup(JSON.stringify({ ...j, ciphertext: flipChar(j.ciphertext) }), 'lozinka-ćevapi')).rejects.toBeInstanceOf(WrongPasswordError);
await expect(openBackup(JSON.stringify({ ...j, deviceName: 'Evil' }), 'lozinka-ćevapi')).rejects.toBeInstanceOf(WrongPasswordError);
await expect(openBackup('{"foo":1}', 'x')).rejects.toBeInstanceOf(NotABackupError);
await expect(openBackup('not json', 'x')).rejects.toBeInstanceOf(NotABackupError);
await expect(openBackup(JSON.stringify({ ...j, version: 2 }), 'x')).rejects.toBeInstanceOf(NewerVersionError);
const bad = await sealBackup(H, { tables: { ships: [{ nope: 1 }] } } as never, 'pw-12345678', { iterations: 1000 });
await expect(openBackup(bad, 'pw-12345678')).rejects.toBeInstanceOf(DamagedFileError);
expect(atob(j.kdf.salt).length).toBe(16);
expect(atob(j.iv).length).toBe(12);
expect(JSON.parse(await sealBackup(H, P, 'pw-12345678')).kdf.iterations).toBe(600000);
expect(validatePassword('1234567')).toBe('Use at least 8 characters.');
expect(validatePassword('12345678')).toBeNull();
```

- [ ] **Step 2: Run them and confirm they fail.** Run: `npx vitest run src/backup/envelope.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `crypto.ts` (WebCrypto `crypto.subtle`) and `envelope.ts`.**
- [ ] **Step 4: Run them and confirm they pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `git add src/backup && git commit -m "feat: encrypted backup envelope"`

---

### Task 9: Database and records

**Files:**
- Create: `src/db/schema.ts`, `src/db/settings.ts`, `src/db/records.ts`, `src/db/ships.ts`, `src/db/storage.ts`, `src/domain/profileCopy.ts`, `src/test/setupDb.ts` (imports `fake-indexeddb/auto`)
- Modify: `vite.config.ts` (add `setupFiles: ['src/test/setupDb.ts']` to `test`)
- Test: `src/db/records.test.ts`, `src/db/ships.test.ts`, `src/domain/profileCopy.test.ts`

**Interfaces:**
- Consumes: Task 2 types.
- Produces:
  - `class MasterpieceDB extends Dexie` with tables `ships` (`'id'`), `crew`, `voyages`, `certificates`, `clockChanges` (each `'id, shipId'`), `settings` (`'key'`) and `snapshots` (`'id, createdAt'`). Version 1.
  - `openDb(name?: string): MasterpieceDB` (default `'masterpiece'`) and `getDb(): MasterpieceDB` (singleton).
  - `getSettings(db): Promise<Settings>`: creates defaults once: `deviceId` = uuid, `deviceName = guessDeviceName(navigator.userAgent)`, `backupReminderDays: 7`, `lastSync: {}`, `theme: 'day'`.
  - `updateSettings(db, patch: Partial<Settings>): Promise<Settings>`.
  - `guessDeviceName(ua: string): string`: `'Android device'` if the user agent contains `Android`, else `'Laptop'`.
  - `createRecord<T extends SyncRecord>(db, table: TableName, fields: Omit<T, keyof BaseRecord>): Promise<T>`: `scope: 'ship'`, `updatedBy` = deviceId.
  - `updateRecord<T extends SyncRecord>(db, table, id, patch: Partial<T>): Promise<T>`.
  - `softDelete(db, table, id): Promise<void>`.
  - `listForShip<T>(db, table: Exclude<TableName, 'ships'>, shipId): Promise<T[]>`: non-deleted only.
  - `listShips(db): Promise<ShipProfile[]>`: non-deleted only.
  - `allTables(db): Promise<Tables>`: includes deleted records.
  - `replaceAllTables(db, t: Tables): Promise<void>`.
  - `putRecords(db, items: { table: TableName; record: SyncRecord }[]): Promise<void>`: one transaction.
  - `createShip(db, name: string, offsetMinutes: number, now?: Date): Promise<ShipProfile>`: creates the ship and its first `ClockChange` (effectiveAt = now), and sets `activeShipId` if none.
  - `deleteShip(db, shipId): Promise<void>`: soft-deletes the ship and every record with that shipId. If the ship was active, `activeShipId` becomes the first remaining ship or `undefined`.
  - `deleteSummary(db, shipId): Promise<{ crew: number; certificates: number; voyages: number; clockChanges: number }>`.
  - `copyShip(db, sourceId: string, newName: string, opts: { includeCertificates: boolean }): Promise<ShipProfile>`.
  - `class StorageFullError extends Error`, with message `Storage on this device is full. The change was not saved. Export a backup and free up space.` Every write maps `QuotaExceededError` to it.
  - `requestPersistentStorage(): Promise<'granted' | 'denied' | 'unsupported'>`.
  - In `profileCopy.ts`:
    - `copyParticulars(p: Particulars, newName: string): Particulars`: clears `imo`, `callSign`, `mmsi`; sets `name`.
    - `certificateShell(c: Certificate): Omit<Certificate, keyof BaseRecord | 'shipId'>`: keeps `key` and `name`; clears `number`, `issuedBy`, `issueDate`, `expiryDate`, `nextSurveyDue`, `remarks`.
  - `copyShip` copies the source's current offset into a new initial `ClockChange`. It never copies crew, voyages or clock history.

- [ ] **Step 1: Write the failing tests.** Each test uses `openDb('t-' + crypto.randomUUID())`.

```ts
const s1 = await getSettings(db), s2 = await getSettings(db);
expect(s2.deviceId).toBe(s1.deviceId);
expect(s1).toMatchObject({ backupReminderDays: 7, theme: 'day', lastSync: {} });
expect(guessDeviceName('Mozilla/5.0 (Linux; Android 14; Pixel 7)')).toBe('Android device');
expect(guessDeviceName('Mozilla/5.0 (Windows NT 10.0)')).toBe('Laptop');
const ship = await createShip(db, 'MV OCEAN STAR', 180, new Date('2026-10-25T08:00:00Z'));
expect((await getSettings(db)).activeShipId).toBe(ship.id);
expect((await listForShip<ClockChange>(db, 'clockChanges', ship.id))[0]).toMatchObject({ toOffsetMinutes: 180, effectiveAt: '2026-10-25T08:00:00.000Z' });
const c = await createRecord<CrewMember>(db, 'crew', { shipId: ship.id, ...draft });
expect(c).toMatchObject({ deleted: false, scope: 'ship', updatedBy: s1.deviceId });
vi.useFakeTimers({ now: new Date('2026-10-26T00:00:00Z'), toFake: ['Date'] });
const u = await updateRecord<CrewMember>(db, 'crew', c.id, { nationality: 'Croatian' });
expect(u.updatedAt).toBe('2026-10-26T00:00:00.000Z');
expect(u.createdAt).toBe(c.createdAt);
vi.useRealTimers();
await softDelete(db, 'crew', c.id);
expect(await listForShip(db, 'crew', ship.id)).toEqual([]);
expect((await allTables(db)).crew[0].deleted).toBe(true);
// ships.test.ts
const b = await createShip(db, 'MV SEA BREEZE', 0);
await createRecord(db, 'crew', { shipId: ship.id, ...draft });
expect(await deleteSummary(db, ship.id)).toEqual({ crew: 1, certificates: 0, voyages: 0, clockChanges: 1 });
await deleteShip(db, ship.id);
expect((await listShips(db)).map(s => s.particulars.name)).toEqual(['MV SEA BREEZE']);
expect((await getSettings(db)).activeShipId).toBe(b.id);
// copy
const src = await createShip(db, 'MV OCEAN STAR', 180);
await updateRecord<ShipProfile>(db, 'ships', src.id, { particulars: { ...src.particulars, imo: '9074729', loa: 229 } });
await createRecord<Certificate>(db, 'certificates', { shipId: src.id, key: 'loadLine', name: 'International Load Line', number: 'LL-1', issuedBy: 'DNV', issueDate: '2024-03-15', expiryDate: '2029-03-14', remarks: '' });
await createRecord(db, 'crew', { shipId: src.id, ...draft });
const cp = await copyShip(db, src.id, 'MV OCEAN PEARL', { includeCertificates: true });
expect(cp.particulars).toMatchObject({ name: 'MV OCEAN PEARL', imo: '', loa: 229 });
expect(await listForShip(db, 'crew', cp.id)).toEqual([]);
expect((await listForShip<Certificate>(db, 'certificates', cp.id))[0]).toMatchObject({ key: 'loadLine', number: '', expiryDate: undefined });
expect((await listForShip<ClockChange>(db, 'clockChanges', cp.id))[0].toOffsetMinutes).toBe(180);
// storage full
vi.spyOn(db.crew, 'put').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
await expect(updateRecord(db, 'crew', c.id, { nationality: 'x' })).rejects.toBeInstanceOf(StorageFullError);
```

- [ ] **Step 2: Run them and confirm they fail.** Run: `npx vitest run src/db src/domain/profileCopy.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the modules.** Use `new Date().toISOString()` for timestamps, so fake timers control them.
- [ ] **Step 4: Run them and confirm they pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: IndexedDB records, ships, copy profile, storage errors"`

---

### Task 10: Snapshots and migration safety

**Files:**
- Create: `src/db/snapshots.ts`
- Test: `src/db/snapshots.test.ts`

**Interfaces:**
- Consumes: Task 9 `MasterpieceDB`, `allTables`, `replaceAllTables`.
- Produces:
  - `takeSnapshot(db, reason: SnapshotReason, note?: string): Promise<Snapshot>`: keeps the newest 5 by `createdAt`.
  - `listSnapshots(db): Promise<{ id: string; createdAt: string; reason: SnapshotReason; note?: string; counts: Record<TableName, number> }[]>`: newest first.
  - `restoreSnapshot(db, id: string): Promise<void>`:
    1. Read the target's data.
    2. Take a `'manual'` snapshot with note `'Before restore'`.
    3. `replaceAllTables` with the target data. Settings are untouched.
  - `snapshotInUpgrade(tx: Transaction, reason?: SnapshotReason): Promise<void>`: for Dexie `version(n).upgrade()`. It reads every syncable table through `tx` and writes one snapshot (default `'before-update'`).

- [ ] **Step 1: Write the failing tests.**

```ts
for (let i = 0; i < 6; i++) { vi.setSystemTime(new Date(Date.UTC(2026, 9, 25, i))); await takeSnapshot(db, 'manual', `n${i}`); }
expect((await listSnapshots(db)).map(s => s.note)).toEqual(['n5', 'n4', 'n3', 'n2', 'n1']);
// restore: crew added after the snapshot disappears, a deleted flag comes back
const snap = await takeSnapshot(db, 'manual');
await createRecord(db, 'crew', { shipId, ...draft });
await restoreSnapshot(db, snap.id);
expect((await allTables(db)).crew).toEqual(snap.data.crew);
expect((await listSnapshots(db))[0].note).toBe('Before restore');
// restoring the oldest of 5 still works (the target is read before pruning)
const oldest = (await listSnapshots(db)).at(-1)!;
await expect(restoreSnapshot(db, oldest.id)).resolves.toBeUndefined();
// migration
const name = 'mig-' + crypto.randomUUID();
const v1 = openDb(name); const s = await createShip(v1, 'MV OCEAN STAR', 0); v1.close();
class V2 extends MasterpieceDB { constructor() { super(name); this.version(2).stores({ crew: 'id, shipId, surname' }).upgrade(tx => snapshotInUpgrade(tx)); } }
const v2 = new V2(); await v2.open();
const snaps = await listSnapshots(v2);
expect(snaps[0].reason).toBe('before-update');
expect(snaps[0].counts.ships).toBe(1);
```

`vi.useFakeTimers({ toFake: ['Date'] })` is used for the timed loop. `MasterpieceDB`'s constructor takes `name` and declares version 1.

- [ ] **Step 2: Run them and confirm they fail.** Run: `npx vitest run src/db/snapshots.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `snapshots.ts`.**
- [ ] **Step 4: Run them and confirm they pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `git add src/db && git commit -m "feat: snapshots, restore and migration snapshot"`

---

### Task 11: Backup service (export, handover, import)

**Files:**
- Create: `src/backup/service.ts`, `src/backup/fileName.ts`, `src/backup/passwordCache.ts`, `src/backup/reminder.ts`, `src/backup/share.ts`
- Test: `src/backup/service.test.ts`, `src/backup/fileName.test.ts`, `src/backup/reminder.test.ts`

**Interfaces:**
- Consumes:
  - Task 7: `computeMerge`, `resolveMerge`, `MergePlan`.
  - Task 8: `sealBackup`, `openBackup`, `BackupHeader`.
  - Task 9: `allTables`, `putRecords`, `getSettings`, `updateSettings`.
  - Task 10: `takeSnapshot`.
  - Task 3: `toShipLocal`, `shipOffsetAt`.
- Produces:
  - `backupFileName(kind: 'full' | 'handover', shipName: string, shipLocalDateTime: string): string`.
  - `collectHandover(t: Tables, shipId: string): Tables`: ship-scope records only; `ships` filtered by id, the other tables by shipId.
  - `exportBackup(db, kind: 'full' | 'handover', password: string, opts: { shipId: string; iterations?: number }): Promise<{ fileName: string; text: string }>`:
    - The file name uses the chosen ship's name and its current ship's time.
    - A full export sets `lastExportAt` and `firstExportDone: true`.
  - `interface PreparedImport { header: BackupHeader; plan: MergePlan }`.
  - `prepareImport(db, text: string, password: string): Promise<PreparedImport>`: uses `lastSync[header.deviceId]`.
  - `applyImport(db, p: PreparedImport, decisions: { conflicts: Record<string, 'local' | 'incoming'>; applyDeletions: boolean }): Promise<void>`:
    1. Take a `'before-import'` snapshot.
    2. `resolveMerge`, then `putRecords`.
    3. Set `lastSync[header.deviceId] = header.exportedAt`.
    4. If `activeShipId` is unset, set it to the first non-deleted ship.
  - `rememberPassword(pw: string): void`, `getRememberedPassword(): string | undefined`, `forgetPassword(): void`. In-memory only, kept in a module variable.
  - `isBackupDue(s: Pick<Settings, 'lastExportAt' | 'backupReminderDays'>, hasShips: boolean, now: Date): boolean`. No ships → false. Never exported → true. Otherwise due when more than `backupReminderDays` × 24 h have passed.
  - `shareOrDownload(fileName: string, text: string): Promise<'shared' | 'downloaded'>`. If `navigator.canShare?.({ files: [file] })`, use `navigator.share`; otherwise use an `<a download>` click. The MIME type is `application/octet-stream`. This is covered by e2e, not by unit tests.

- [ ] **Step 1: Write the failing tests.** Use `iterations: 1000` and two fake-indexeddb databases, `A` and `B`.

```ts
// fileName.test.ts — Review Focus 4
expect(backupFileName('full', 'M/V Ocean Star', '2026-10-25T14:32')).toBe('masterpiece-full-m-v-ocean-star-2026-10-25-1432.mpbak');
expect(backupFileName('handover', 'Šibenik Express', '2026-10-25T09:05')).toBe('masterpiece-handover-sibenik-express-2026-10-25-0905.mpbak');
expect(backupFileName('full', '///', '2026-10-25T09:05')).toBe('masterpiece-full-ship-2026-10-25-0905.mpbak');
// reminder.test.ts
const now = new Date('2026-10-25T12:00:00Z');
expect(isBackupDue({ backupReminderDays: 7 }, false, now)).toBe(false);
expect(isBackupDue({ backupReminderDays: 7 }, true, now)).toBe(true);
expect(isBackupDue({ backupReminderDays: 7, lastExportAt: '2026-10-17T12:00:00.000Z' }, true, now)).toBe(true);
expect(isBackupDue({ backupReminderDays: 7, lastExportAt: '2026-10-19T12:00:00.000Z' }, true, now)).toBe(false);
// service.test.ts
const { text } = await exportBackup(A, 'full', 'pw-12345678', { shipId: shipA.id, iterations: 1000 });
const p = await prepareImport(B, text, 'pw-12345678');
await applyImport(B, p, { conflicts: {}, applyDeletions: true });
expect(await allTables(B)).toEqual(await allTables(A));
expect((await getSettings(A)).lastExportAt).toBeDefined();
expect((await getSettings(B)).lastSync[(await getSettings(A)).deviceId]).toBe(p.header.exportedAt);
expect((await listSnapshots(B))[0].reason).toBe('before-import');
// Review Focus 3: importing the same file twice
const again = await prepareImport(B, text, 'pw-12345678');
expect(again.plan.items).toEqual([]);
expect(again.plan.summary).toEqual({ added: 0, updated: 0, deleted: 0, conflicts: 0 });
// handover: A has ships A1 and A2; export A1 only
const h = await exportBackup(A, 'handover', 'relief-pass', { shipId: shipA.id, iterations: 1000 });
const { payload } = await openBackup(h.text, 'relief-pass');
expect(payload.tables.ships.map(s => s.id)).toEqual([shipA.id]);
expect(Object.values(payload.tables).flat().every(r => r.scope === 'ship' && (r.id === shipA.id || (r as { shipId?: string }).shipId === shipA.id))).toBe(true);
expect(readHeader(h.text).kind).toBe('handover');
const before = (await getSettings(A)).lastExportAt;
await exportBackup(A, 'handover', 'relief-pass', { shipId: shipA.id, iterations: 1000 });
expect((await getSettings(A)).lastExportAt).toBe(before);
// conflict across two devices
await updateRecord(A, 'crew', crewId, { nationality: 'Croatian' });
await updateRecord(B, 'crew', crewId, { nationality: 'Montenegrin' });
const t2 = (await exportBackup(A, 'full', 'pw-12345678', { shipId: shipA.id, iterations: 1000 })).text;
expect((await prepareImport(B, t2, 'pw-12345678')).plan.summary.conflicts).toBe(1);
```

- [ ] **Step 2: Run them and confirm they fail.** Run: `npx vitest run src/backup`. Expected: FAIL in the new files.
- [ ] **Step 3: Implement the five modules.**
- [ ] **Step 4: Run them and confirm they pass.** Run: `npx vitest run src/backup`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add src/backup && git commit -m "feat: full/handover export and merging import"`

---

### Task 12: App lock rules: 4-digit passcode and fingerprint

**Files:**
- Create: `src/security/pin.ts`, `src/security/fingerprint.ts`
- Modify: `src/domain/types.ts` (adds `FingerprintCredential`; `PinSettings` gains `fingerprint?: FingerprintCredential`)
- Test: `src/security/pin.test.ts`, `src/security/fingerprint.test.ts`

**Interfaces:**
- Consumes: `PinHash`, `LockoutState`, `PinSettings` (Task 2).
- Produces in `types.ts`: `interface FingerprintCredential { credentialId: string /*base64url*/; publicKey: string /*SPKI, base64*/; alg: -7 | -257 }`.
- Produces in `pin.ts` (the passcode is **exactly 4 digits**, per the user's decision):
  - `isValidPin(pin: string): boolean` (`/^\d{4}$/`).
  - `hashPin(pin: string, opts?: { iterations?: number }): Promise<PinHash>`: PBKDF2-SHA-256, 100000 iterations by default, random 16-byte salt.
  - `verifyPin(pin: string, h: PinHash): Promise<boolean>`: constant-time comparison.
  - `registerFailure(s: LockoutState, now: Date): LockoutState`: the 5th failure locks for 30 s, the 6th for 60 s, the 7th and later for 300 s.
  - `registerSuccess(): LockoutState` (`{ failures: 0 }`).
  - `lockRemainingMs(s: LockoutState, now: Date): number`.
  - `shouldRelock(hiddenAt: string | undefined, now: Date, relockMinutes: number): boolean`: true when more than `relockMinutes` have passed.
- Produces in `fingerprint.ts` (WebAuthn platform authenticator, fully offline, with local verification and no server):
  - `isMobileDevice(userAgent: string): boolean`: `/Android|iPhone|iPad/i`.
  - `isFingerprintAvailable(): Promise<boolean>`: true only when **all** hold: `isMobileDevice(navigator.userAgent)` (laptops use the passcode only, per the user's decision), `window.PublicKeyCredential` exists, and `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()` resolves true.
  - `registerFingerprint(): Promise<FingerprintCredential>`: `navigator.credentials.create({ publicKey: { rp: { name: 'Masterpiece' }, user: { id: <random 16 bytes>, name: 'masterpiece', displayName: 'Masterpiece' }, challenge: <random 32 bytes>, pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' }, attestation: 'none', timeout: 60000 } })`. It stores `rawId` as base64url, `response.getPublicKey()` as base64 SPKI, and `response.getPublicKeyAlgorithm()`.
  - `unlockWithFingerprint(cred: FingerprintCredential): Promise<boolean>`: calls `navigator.credentials.get` with `allowCredentials: [{ type: 'public-key', id }]`, `userVerification: 'required'`, a random 32-byte challenge and a 60 s timeout, then returns `verifyAssertion(...)`. A cancelled, failed or timed-out prompt returns `false` and never throws.
  - Pure, unit-tested helpers:
    - `parseAuthenticatorData(bytes: Uint8Array): { rpIdHash: Uint8Array; userPresent: boolean; userVerified: boolean }`: UP is flag bit 0, UV is bit 2.
    - `derToRawEcdsa(der: Uint8Array): Uint8Array`: 64-byte r‖s for WebCrypto ES256.
    - `verifyAssertion(input: { cred: FingerprintCredential; authenticatorData: Uint8Array; clientDataJSON: Uint8Array; signature: Uint8Array; expectedChallenge: Uint8Array; expectedOrigin: string; expectedRpId: string }): Promise<boolean>`. It returns true only if **every** check passes:
      - `clientData.type === 'webauthn.get'`;
      - `clientData.challenge` (base64url) equals `expectedChallenge`;
      - `clientData.origin === expectedOrigin`;
      - `rpIdHash` equals SHA-256(`expectedRpId`);
      - both `userPresent` and `userVerified` are set;
      - the signature over `authenticatorData ‖ SHA-256(clientDataJSON)` verifies with the stored key (ES256 via `derToRawEcdsa`, RS256 PKCS1-v1_5 SHA-256).
- **Limitation, stated in the app:**
  - The lock stops casual access but does not encrypt the data on the device.
  - Android shows its own fingerprint prompt, and may offer the phone's own screen lock as an alternative there. That choice belongs to the phone, not the app.

- [ ] **Step 1: Write the failing tests.**

```ts
// pin.test.ts
expect(isValidPin('2580')).toBe(true);
expect(['123', '12345', '12a4', '', ' 258'].some(isValidPin)).toBe(false);
const h = await hashPin('2580', { iterations: 1000 });
expect(await verifyPin('2580', h)).toBe(true);
expect(await verifyPin('2581', h)).toBe(false);
expect((await hashPin('2580', { iterations: 1000 })).salt).not.toBe(h.salt);
let s: LockoutState = { failures: 0 }; const t0 = new Date('2026-10-25T12:00:00Z');
for (let i = 0; i < 4; i++) s = registerFailure(s, t0);
expect(lockRemainingMs(s, t0)).toBe(0);
s = registerFailure(s, t0); expect(lockRemainingMs(s, t0)).toBe(30_000);
s = registerFailure(s, t0); expect(lockRemainingMs(s, t0)).toBe(60_000);
s = registerFailure(s, t0); expect(lockRemainingMs(s, t0)).toBe(300_000);
s = registerFailure(s, t0); expect(lockRemainingMs(s, t0)).toBe(300_000);
expect(lockRemainingMs(s, new Date(t0.getTime() + 300_001))).toBe(0);
expect(shouldRelock('2026-10-25T12:00:00.000Z', new Date('2026-10-25T12:04:00Z'), 5)).toBe(false);
expect(shouldRelock('2026-10-25T12:00:00.000Z', new Date('2026-10-25T12:06:00Z'), 5)).toBe(true);
expect(shouldRelock(undefined, t0, 5)).toBe(false);

// fingerprint.test.ts — build a real ES256 key with crypto.subtle.generateKey, export SPKI as the stored cred,
// hand-build authenticatorData (rpIdHash = SHA-256('localhost') ‖ flags ‖ 4-byte counter) and clientDataJSON
// ({ type: 'webauthn.get', challenge: b64url(ch), origin: 'http://localhost:4173' }), sign authData ‖ SHA-256(clientDataJSON),
// convert WebCrypto's raw r‖s signature to DER for the input (a test helper rawToDer).
expect(isMobileDevice('Mozilla/5.0 (Linux; Android 14; Pixel 7)')).toBe(true);
expect(isMobileDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(false);
expect(parseAuthenticatorData(authData(0x05))).toMatchObject({ userPresent: true, userVerified: true });
expect(parseAuthenticatorData(authData(0x01))).toMatchObject({ userPresent: true, userVerified: false });
expect(derToRawEcdsa(rawToDer(raw))).toEqual(raw);   // including r/s with a leading 0x00 pad byte
expect(await verifyAssertion(good)).toBe(true);
expect(await verifyAssertion({ ...good, expectedChallenge: otherChallenge })).toBe(false);
expect(await verifyAssertion({ ...good, expectedOrigin: 'https://evil.example' })).toBe(false);
expect(await verifyAssertion({ ...good, expectedRpId: 'example.com' })).toBe(false);
expect(await verifyAssertion({ ...good, authenticatorData: authData(0x01) /* UV not set, re-signed */ , signature: sigFor(authData(0x01)) })).toBe(false);
expect(await verifyAssertion({ ...good, signature: flipByte(good.signature) })).toBe(false);
expect(await verifyAssertion({ ...good, clientDataJSON: enc({ type: 'webauthn.create', challenge, origin }) })).toBe(false);
```

- [ ] **Step 2: Run them and confirm they fail.** Run: `npx vitest run src/security`. Expected: FAIL.
- [ ] **Step 3: Implement `pin.ts`, `fingerprint.ts` and the type additions.** `registerFingerprint` and `unlockWithFingerprint` are thin wrappers over the browser API; they are covered by Task 21's e2e test with a virtual authenticator.
- [ ] **Step 4: Run them and confirm they pass.** Run: `npx vitest run src/security && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: passcode and fingerprint lock rules"`

---

### Task 13: App shell: state, router, header, themes, first ship, errors, update banner

**Files:**
- Create: `src/app/AppState.tsx`, `src/app/router.ts`, `src/ui/useLive.ts`, `src/ui/theme.css`, `src/ui/print.css`, `src/ui/components/Header.tsx`, `src/ui/components/Nav.tsx`, `src/ui/components/UpdateBanner.tsx`, `src/ui/components/ErrorToast.tsx`, `src/ui/components/LogoMark.tsx`, `src/ui/screens/FirstShip.tsx`
- Modify: `src/app/App.tsx`, `src/main.tsx`, `public/icon.svg` (and re-run `scripts/make-icons.mjs` to regenerate the three PNGs), `vite.config.ts` (manifest `theme_color` and `background_color` both `'#0B2545'`)
- Test: `e2e/helpers.ts`, `e2e/shell.spec.ts`

**Interfaces:**
- Consumes: Task 9 (`getDb`, `getSettings`, `updateSettings`, `createShip`, `listShips`, `listForShip`, `requestPersistentStorage`, `StorageFullError`), Task 3 (`shipOffsetAt`, `toShipLocal`, `formatOffset`, `OFFSET_OPTIONS`, `deviceOffsetMinutes`), Task 1 (`onUpdateAvailable`, `applyUpdate`).
- Produces:
  - `useLive<T>(query: () => Promise<T>, deps: unknown[]): T | undefined`: a Dexie `liveQuery` subscription.
  - `useAppState(): { db: MasterpieceDB; settings: Settings; activeShip?: ShipProfile; offsetMinutes: number; nowUtc: Date; shipToday: string; persistence: 'granted' | 'denied' | 'unsupported' }`. `nowUtc` ticks every 30 s.
  - `reportError(err: unknown): void`: shows `ErrorToast`. For `StorageFullError` the toast has an **Export backup** link to `#/settings`.
  - **Routes** (hash): `#/`, `#/ship/particulars`, `#/ship/crew`, `#/ship/crew/new`, `#/ship/crew/:id`, `#/ship/crew/import`, `#/ship/certificates`, `#/ship/certificates/new`, `#/ship/certificates/:id`, `#/ship/voyage`, `#/ship/time`, `#/profiles`, `#/settings`, `#/settings/import`.
  - `navigate(path: string): void` and `useRoute(): { path: string; params: Record<string, string> }`.
  - **Copy and labels:**
    - Header: `<h1>Masterpiece</h1>`, the ship name, and a clock element `data-testid="ship-clock"` with the text `HH:mm LT (UTC±hh:mm)`.
    - Theme button: `aria-label` is `Theme: Day`, `Theme: Night` or `Theme: High contrast`. It cycles day → night → contrast and sets `<html data-theme>` to `day`, `night` or `contrast`.
    - Main nav links: `Home`, `Ship`, `Profiles`, `Settings`. Ship sub-nav: `Particulars`, `Crew`, `Certificates`, `Voyage`, `Ship's time`.
    - **Logo (user-chosen: logo v2, "M on the sea at sunrise")** in `LogoMark.tsx` (`{ size: number; mode: 'day' | 'night' }`). It is inline SVG with viewBox `0 0 100 100`, clipped to a rounded tile `rect width=100 height=100 rx=22`. Copy the geometry exactly from the mockup artboard "Logo v2" (https://claude.ai/artifact/7aEGBDGRCemA7uUWVE638x):
      - **Sky:** `rect height=62`, linear gradient top→bottom `#FFF1C2` → `#D6EAFF` (0.55) → `#9CCBFF`, plus a radial glow (cx 0.5, cy 0.2, r 0.5, white → `#FFF8E1` transparent).
      - **Sun:** `circle cx=50 cy=20 r=7.5 fill=#FFFDF2`.
      - **Far sea:** `rect y=60 height=40 fill=#2E6DB4`.
      - **Horizon:** `path d="M0 60 H100"`, white at 0.85 opacity, width 0.8.
      - **M:** `path d="M24 77 L24 32 L50 57 L76 32 L76 77"`, no fill, stroke `#0B2545`, width 10, round joins and caps. Underneath it, a white halo of the same path at width 15, 0.9 opacity.
      - **Front waves:** `path d="M0 78 Q12.5 72 25 78 T50 78 T75 78 T100 78 V100 H0 Z" fill=#0B2545`, with a crest line of the same curve in `#7AB8FF`, width 2.5.
      - **Small sizes (≤ 64 px):** omit the glow, the horizon line, the halo and the small wave accents, and thicken the M to width 12–13.
      - **Night:** sky `#0B1622` → `#1E3550`, moon `circle cx=50 cy=20 r=6 fill=#E6EDF5 opacity=.85`, far sea `#12243A`, horizon `#5FD4CE`, M `#E6EDF5` (no halo), front waves `#0E1B2B`, crest `#5FD4CE`.
      - Use unique gradient and clip ids per instance (for example via a counter), because several logos can be on one page.
      - `role="img"`, `aria-label="Masterpiece logo"`.
      - **Header brand:** the 24 px small-size version before "Masterpiece".
      - `public/icon.svg` is the Day tile. The maskable icon adds 20% padding of `#0B2545`. Regenerate the PNGs from it.
    - **Welcome screen (FirstShip.tsx, shown when no ships exist)**, matching the mockup "Welcome page — Day/Night":
      - A top band (Day: navy `#0B2545`; Night: page background) with a 120 px logo tile and `<h1>Masterpiece</h1>`.
      - The tagline, exactly: `Your ship's office in your pocket. Crew, certificates and paperwork — fully offline.`
      - Primary button `Create your first ship`, 56 px high. It reveals the form:
        - heading `Create your first ship`;
        - label `Ship name`;
        - select `Ship's time (UTC offset)` (default `deviceOffsetMinutes()`);
        - button `Create ship`.
      - Secondary link `Import a backup` → `#/settings/import`, 56 px high, styled as an outline button.
      - The helper text, exactly: `New phone or taking over from your relief? Import their backup or handover file.`
      - The footer note with a padlock icon, exactly: `Your data stays on this device. No account needed.`
    - Update banner: `New version available — Update`, where **Update** is a button that calls `applyUpdate()`.
    - **"What's new" (user decision):**
      - A repo-root file `release.json` holds `{ "version": "<semver>", "whatsNew": "<one short sentence>" }`, and its `version` must equal `package.json`'s.
      - A small Vite plugin in `vite.config.ts` writes it to `dist/version.json`. JSON is not in the Workbox `globPatterns`, so the file is never precached.
      - When `onUpdateAvailable` fires, `src/app/releaseInfo.ts` runs `fetchReleaseInfo(): Promise<{ version: string; whatsNew: string } | null>`. It does `fetch('./version.json', { cache: 'no-store' })` and returns null on any failure or malformed JSON.
      - `updateBannerText(info: { version: string; whatsNew: string } | null): string` gives `Version <version> — <whatsNew>` when info is present, and otherwise `New version available`. The **Update** button follows the text.
      - Unit tests: `updateBannerText` both ways, and `fetchReleaseInfo` with a stubbed fetch for ok, 404, network error and malformed JSON.
      - For this task, `release.json` starts as `{ "version": "0.1.0", "whatsNew": "First version of Masterpiece." }`. Set `package.json` to `0.1.0` too.
    - **Update checks:** besides the check on app start, `swUpdate.ts` calls the service worker registration's `update()` every 60 minutes while `navigator.onLine`, and once on each `online` event. Use the `onRegisteredSW(swUrl, registration)` callback of `registerSW`; when offline, skip the check. The spec decision is to let a phone app that stays open for days still find updates. Unit-test the scheduling with fake timers and a stub registration: it calls `update` after 60 min when online, does not call it when offline, and calls it immediately on `online`.
  - **Visual style "Bridge Console"** (user-chosen; spec §4.9). Reference mockups are at https://claude.ai/artifact/7aEGBDGRCemA7uUWVE638x: artboards "Day mode — Home" and "A · Bridge Console — Night mode".
    - **Fonts:** IBM Plex Sans 400/500/600 (body) and IBM Plex Mono 500 (clock and rank codes), bundled with `@fontsource/ibm-plex-sans@^5.3.0` and `@fontsource/ibm-plex-mono@^5.3.0`. These are imported in `main.tsx`, so they are precached. No Google Fonts link.
    - **Shared shapes and layout (all themes):**
      - Cards and rows use radius 10–12 px; badges are pills.
      - Header: brand line, ship name, clock (Plex Mono), theme button 44×44.
      - Bottom nav bar: Home / Ship / Profiles / Settings, each with an inline stroke icon; the active one uses `--nav-active`.
      - Ship sub-nav: a horizontal chip row, the active chip filled `--accent`.
    - Every theme defines the same CSS variables on `:root[data-theme="…"]`:
      - `--bg`, `--surface`, `--line`, `--text`, `--muted`
      - `--bar-bg`, `--bar-text`, `--bar-muted` (header and bottom bar), `--nav-active`
      - `--accent`, `--on-accent`, `--amber`, `--on-amber`, `--red`, `--on-red`
  - **Day theme (white with blue):**
    - Page and cards: `--bg #FFFFFF`, `--surface #F3F6FA`, `--line #D5DEE8`, `--text #0B1622`, `--muted #4A6380`.
    - Navy header and bottom bar: `--bar-bg #0B2545`, `--bar-text #FFFFFF`, `--bar-muted #B8C7D9`, `--nav-active #7AB8FF`.
    - Blue buttons: `--accent #1D5FD1`, `--on-accent #FFFFFF`.
    - Badges: `--amber #F2B33D` (`--on-amber #241703`), `--red #C81E1E` (`--on-red #FFFFFF`).
  - **Night theme (dark navy, the Bridge Console mockup):**
    - Page and cards: `--bg #0B1622`, `--surface #12243A`, `--line #1E3550`, `--text #E6EDF5`, `--muted #9FB3C8`.
    - Bars: `--bar-bg #0E1B2B`, `--bar-text #E6EDF5`, `--bar-muted #9FB3C8`, `--nav-active #5FD4CE`.
    - Accent: `--accent #5FD4CE`, `--on-accent #04211F`.
    - Badges: `--amber #F2B33D` (`--on-amber #241703`), `--red #FF6B5E` (`--on-red #1A0503`).
    - No red night palette (user decision).
  - **High contrast:** black on white, bars black with white text, `font-weight: 600`, minimum touch target 48 px.
  - **Print:** `@media print` forces background `#ffffff` and text `#000000` and hides nav, header buttons and banners, whatever the theme.
  - **e2e helpers** in `e2e/helpers.ts`:
    - `freshApp(page, opts?: { time?: string })`: installs `page.clock` at `opts.time ?? '2026-10-25T09:00:00Z'`, then goes to `./`.
    - `setupShip(page, name = 'MV OCEAN STAR', offset = 'UTC+03:00', opts?: { skipLock?: boolean })`: clicks `Create your first ship` on the welcome screen, then fills the form and clicks `Create ship`. With `skipLock` (default `true`), it clicks `Skip for now` if the Task 21 protect step appears. Before Task 21 exists, that step never appears.
    - `expectNoHorizontalScroll(page)`: sets a 360×740 viewport and asserts `document.documentElement.scrollWidth <= 360`.

- [ ] **Step 1: Write the failing e2e tests** in `e2e/shell.spec.ts`:

```ts
test('first ship and header clock', async ({ page }) => {
  await freshApp(page);
  await expect(page.getByRole('heading', { name: 'Masterpiece' })).toBeVisible();
  await expect(page.getByText("Your ship's office in your pocket. Crew, certificates and paperwork — fully offline.")).toBeVisible();
  await expect(page.getByRole('img', { name: 'Masterpiece logo' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Import a backup' })).toHaveAttribute('href', '#/settings/import');
  await expect(page.getByText('Your data stays on this device. No account needed.')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await setupShip(page);
  await expect(page.getByRole('banner')).toContainText('MV OCEAN STAR');
  await expect(page.getByTestId('ship-clock')).toHaveText('12:00 LT (UTC+03:00)');
  await expectNoHorizontalScroll(page);
});
test('theme cycles, persists, and prints black on white', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.getByRole('button', { name: 'Theme: Day' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
  const [bg, fg] = await page.evaluate(() => [getComputedStyle(document.body).backgroundColor, getComputedStyle(document.body).color]);
  expect(bg).toBe('rgb(11, 22, 34)');      // night: dark navy #0B1622
  expect(fg).toBe('rgb(230, 237, 245)');   // #E6EDF5
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
  await page.emulateMedia({ media: 'print' });
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(255, 255, 255)');
  expect(await page.evaluate(() => getComputedStyle(document.body).color)).toBe('rgb(0, 0, 0)');
});
```

- [ ] **Step 2: Run them and confirm they fail.** Run: `npx playwright test e2e/shell.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the shell.** Store the theme in `Settings.theme` and apply it to `<html>` before the first paint (read from settings on boot). Call `requestPersistentStorage()` once on boot. Wire `reportError` to `window.onunhandledrejection`.
- [ ] **Step 4: Run them and confirm they pass,** with the smoke tests. Run: `npx playwright test e2e/shell.spec.ts e2e/smoke.spec.ts && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Manual check of the update banner.** Run `npm run build && npm run preview` and open the app. Change the `<h1>` text, rebuild, then reload once. Expected: the banner `New version available — Update` appears, and **Update** reloads into the new version. Revert the text change.
- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat: app shell, header clock, themes, first ship, update banner"`

---

### Task 14: Ship profiles and vessel particulars screens

**Files:**
- Create: `src/ui/components/Field.tsx`, `src/ui/components/ConfirmDialog.tsx`, `src/ui/screens/Profiles.tsx`, `src/ui/screens/Particulars.tsx`
- Test: `e2e/profiles.spec.ts`

**Interfaces:**
- Consumes: Task 9 (`listShips`, `createShip`, `updateRecord`, `deleteShip`, `deleteSummary`, `copyShip`, `updateSettings`), Task 2 (`validateParticulars`), Task 13 (`useAppState`, `useLive`, `reportError`, e2e helpers).
- Produces:
  - `Field` component: `{ label: string; value: string; onInput: (v: string) => void; type?: 'text' | 'number' | 'date' | 'datetime-local'; error?: FieldError }`. It renders a `<label>`-associated input. Errors are shown with `role="alert"`; warnings with class `warning` and no `role`.
  - `ConfirmDialog`: `{ title: string; body: ComponentChildren; confirmLabel: string; onConfirm(): void; onCancel(): void }`, rendered as `<dialog>`.
  - **Particulars** labels, in order: `Ship name`, `IMO number`, `Call sign`, `MMSI`, `Flag`, `Port of registry`, `GT`, `NT`, `DWT (summer)`, `LOA (m)`, `Beam (m)`, `Year built`, `Owners`, `Managers (ISM company)`, `P&I club`, `Classification society`. Button `Save`; it is disabled while any `error` severity exists, and warnings do not block it. After saving, the status text `Saved`.
  - **Profiles:**
    - Each ship row: name, an `Active` badge on the active ship, and buttons `Make active`, `Rename`, `Copy`, `Delete`. Button `New ship` opens a dialog with `Ship name` and `Ship's time (UTC offset)`.
    - The **Copy** dialog has `New ship name`, the checkbox `Copy certificate list (names only)` and the button `Copy ship`.
    - The **Delete** dialog title is `Delete <name>?`. Its body reads `This removes <n> crew, <n> certificates and <n> voyages from this device. A backup made earlier still contains them.` The button is `Delete ship`.

- [ ] **Step 1: Write the failing e2e tests.**

```ts
test('particulars validation and save', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.getByRole('link', { name: 'Ship' }).click(); await page.getByRole('link', { name: 'Particulars' }).click();
  await page.getByLabel('IMO number').fill('9074728');
  await expect(page.getByText("IMO check digit doesn't match — please re-check the number.")).toBeVisible();
  await page.getByLabel('GT').fill('-5');
  await expect(page.getByRole('alert')).toHaveText('Must be a positive number.');
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  await page.getByLabel('GT').fill('32500'); await page.getByLabel('LOA (m)').fill('229');
  await page.getByRole('button', { name: 'Save' }).click(); await expect(page.getByText('Saved')).toBeVisible();
  await page.reload(); await expect(page.getByLabel('IMO number')).toHaveValue('9074728');
  await expectNoHorizontalScroll(page);
});
test('profiles: new, switch, copy, rename, delete', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  // set LOA 229 on MV OCEAN STAR via Particulars (as above), then:
  await page.getByRole('link', { name: 'Profiles' }).click();
  await page.getByRole('button', { name: 'New ship' }).click();
  await page.getByLabel('Ship name').fill('MV SEA BREEZE'); await page.getByRole('button', { name: 'Create ship' }).click();
  await page.getByRole('listitem').filter({ hasText: 'MV SEA BREEZE' }).getByRole('button', { name: 'Make active' }).click();
  await expect(page.getByRole('banner')).toContainText('MV SEA BREEZE');
  await page.getByRole('listitem').filter({ hasText: 'MV OCEAN STAR' }).getByRole('button', { name: 'Copy' }).click();
  await page.getByLabel('New ship name').fill('MV OCEAN PEARL'); await page.getByRole('button', { name: 'Copy ship' }).click();
  // make MV OCEAN PEARL active → Particulars: IMO empty, LOA 229
  await page.getByRole('listitem').filter({ hasText: 'MV SEA BREEZE' }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('dialog')).toContainText('This removes 0 crew, 0 certificates and 0 voyages from this device.');
  await page.getByRole('button', { name: 'Delete ship' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'MV SEA BREEZE' })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});
```

Spell out the commented steps as real Playwright calls, using the same labels.

- [ ] **Step 2: Run them and confirm they fail.** Run: `npx playwright test e2e/profiles.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the components and screens.**
- [ ] **Step 4: Run them and confirm they pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: ship profiles and particulars screens"`

---

### Task 15: Crew list screen

**Files:**
- Create: `src/ui/components/BandBadge.tsx`, `src/ui/screens/Crew.tsx`, `src/ui/screens/CrewEdit.tsx`
- Test: `e2e/crew.spec.ts`

**Interfaces:**
- Consumes: Task 4 (`onboardAt`, `rejoinDraft`, `fullName`), Task 2 (`validateCrewMember`, `crewDocBand`, `RANKS`, `rankLabel`), Task 9 records, Task 14 `Field` and `ConfirmDialog`.
- Produces:
  - `BandBadge`: `{ band: Band; kind: 'crew' | 'certificate' }`. Renders nothing for `none` or `ok`. Otherwise it has a `data-band` attribute and one of these texts: crew `Expires soon` / `Expired`; certificate `Due soon` / `Overdue`.
  - **Crew list:**
    - Date input `As at` (default: ship's today) and toggle buttons `Onboard` (default) and `All`. `Onboard` shows `onboardAt(crew, asAt)`. `All` shows every non-deleted record and ignores the date. Badges are always computed against the `As at` date.
    - Button links `Add crew member` and `Import from Excel`.
    - Rows show rank, full name and the badge. Row buttons: `Edit`, `Sign off`, `Re-join` (only when signed off), `Delete`.
  - **Sign off** dialog: `Sign-off date`, `Sign-off port`, button `Sign off`. **Re-join** dialog: `Sign-on date`, `Sign-on port`, button `Re-join`.
  - **CrewEdit** labels: `Surname`, `Given names`, `Rank` (select from `RANKS`), `Rank (other)` (shown only when Other is selected), `Nationality`, `Date of birth`, `Place of birth`, `Passport no.`, `Passport expiry`, `Seaman's book no.`, `Seaman's book expiry`, `Sign-on date`, `Sign-on port`. Button `Save`.

- [ ] **Step 1: Write the failing e2e tests.** The clock is `2026-10-25T09:00:00Z` (ship's today `2026-10-25`).

```ts
test('crew bands, sign off, as-at, re-join', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.goto('./#/ship/crew/new');
  await page.getByLabel('Surname').fill('PETROVIĆ'); await page.getByLabel('Given names').fill('Ivan');
  await page.getByLabel('Rank').selectOption({ label: 'Master' });
  await page.getByLabel('Date of birth').fill('2027-01-01');
  await expect(page.getByRole('alert')).toHaveText('Date of birth must be in the past.');
  await page.getByLabel('Date of birth').fill('1985-01-05');
  await page.getByLabel('Passport expiry').fill('2027-03-01');      // within 6 months → amber
  await page.getByLabel("Seaman's book expiry").fill('2030-01-01');
  await page.getByLabel('Sign-on date').fill('2026-06-01');
  await page.getByRole('button', { name: 'Save' }).click();
  const row = page.getByRole('listitem').filter({ hasText: 'Ivan PETROVIĆ' });
  await expect(row.getByText('Expires soon')).toBeVisible();
  await row.getByRole('button', { name: 'Sign off' }).click();
  await page.getByLabel('Sign-off date').fill('2026-10-10'); await page.getByLabel('Sign-off port').fill('Santos');
  await page.getByRole('dialog').getByRole('button', { name: 'Sign off' }).click();
  await expect(row).toHaveCount(0);                                  // Onboard as at today
  await page.getByLabel('As at').fill('2026-10-10'); await expect(row).toHaveCount(1);
  await page.getByLabel('As at').fill('2026-10-25'); await page.getByRole('button', { name: 'All' }).click();
  await row.getByRole('button', { name: 'Re-join' }).click();
  await page.getByLabel('Sign-on date').fill('2026-10-20'); await page.getByLabel('Sign-on port').fill('Rotterdam');
  await page.getByRole('dialog').getByRole('button', { name: 'Re-join' }).click();
  await expect(row).toHaveCount(2);
  await page.getByRole('button', { name: 'Onboard' }).click(); await expect(row).toHaveCount(1);
  await expectNoHorizontalScroll(page);
});
```

Also add one test where the passport expiry is `2026-10-01` and the row shows `Expired`.

- [ ] **Step 2: Run them and confirm they fail.** Run: `npx playwright test e2e/crew.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the screens.**
- [ ] **Step 4: Run them and confirm they pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: crew list with as-at date, bands, sign off and re-join"`

---

### Task 16: Crew import wizard

**Files:**
- Create: `src/ui/screens/CrewImport.tsx`
- Test: `e2e/crewImport.spec.ts`, `e2e/fixtures/makeCrewXlsx.ts`

**Interfaces:**
- Consumes:
  - Task 5: `readSpreadsheet`, `UnsupportedFileError`, `UnreadableFileError`, `detectHeaderRow`.
  - Task 6: `applySavedMapping`, `toSavedMapping`, `buildPreview`, `revalidateRow`.
  - Task 9: `createRecord`, `updateRecord`.
  - Task 10: `takeSnapshot`.
  - Task 15: `CrewEdit` fields for the inline fix.
- Produces, in order on screen:
  - File input `Crew list file` (accepts `.xlsx,.xls,.csv`).
  - Select `Sheet`; number input `Header row` (1-based).
  - Per-column select, labelled by the column's header text, with options `— ignore —` plus field labels.
  - Select `Date format`, with options `Day first (DD.MM.YYYY)` and `Year first (YYYY-MM-DD)`.
  - Date input `Sign-on date for rows without one` (default: ship's today).
  - Preview list items: the status text `New`, `Update`, `No changes` or `Error`, the error messages, a `Fix` button on error rows (opens the inline CrewEdit form with a `Done` button), and a `Skip` checkbox.
  - Button `Import <n> crew`, where *n* counts the new and update rows (with changes) that are not skipped and have no error. It is disabled while *n* = 0.
- **On import:**
  1. Take a `'before-import'` snapshot.
  2. Create the new records and update the matched ones with the changed fields only.
  3. Save the mapping with `toSavedMapping` to `ship.crewImportMapping`.
  4. Go to `#/ship/crew` with the status `Imported <n> crew.`.
- `UnsupportedFileError` and `UnreadableFileError` messages are shown with `role="alert"`.

- [ ] **Step 1: Write the failing e2e tests.**
  - `makeCrewXlsx(path, bookType: 'xlsx' | 'biff8' = 'xlsx')` uses SheetJS (`import * as XLSX from 'xlsx'`, `XLSX.writeFile`) to write a sheet with these rows:
    1. `['CREW LIST']`
    2. `['MV OCEAN STAR']`
    3. *(empty row)*
    4. header: `['No.', 'Surname', 'Given names', 'Rank', 'Date of birth', 'Passport No']`
    5. `['1', 'PETROVIĆ', 'Ivan', 'Master', '05.01.1985', '012345678']`
    6. `['2', "O'BRIEN", 'Jean-Luc', 'A/B', '31.02.1990', 'X1']`
    7. `['3', 'ŠAŠIĆ', 'Marko', 'C/O', '12.12.1990', 'P77']`
    8. *(empty row)*
    9. `['Total crew: 3']`

```ts
test('import crew from Excel, fix error, re-import shows no changes', async ({ page }, info) => {
  const file = info.outputPath('crew.xlsx'); await makeCrewXlsx(file);
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/crew/import');
  await page.getByLabel('Crew list file').setInputFiles(file);
  await expect(page.getByLabel('Header row')).toHaveValue('4');
  await expect(page.getByRole('listitem').filter({ hasText: 'New' })).toHaveCount(2);
  const err = page.getByRole('listitem').filter({ hasText: "O'BRIEN" });
  await expect(err).toContainText('Enter a valid date.');
  await expect(page.getByRole('button', { name: 'Import 2 crew' })).toBeEnabled();
  await err.getByRole('button', { name: 'Fix' }).click();
  await page.getByLabel('Date of birth').fill('1990-02-28'); await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Import 3 crew' }).click();
  await expect(page.getByText('Imported 3 crew.')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: /PETROVIĆ|O'BRIEN|ŠAŠIĆ/ })).toHaveCount(3);
  await page.goto('./#/ship/crew/import'); await page.getByLabel('Crew list file').setInputFiles(file);
  await expect(page.getByRole('listitem').filter({ hasText: 'No changes' })).toHaveCount(2); // the O'BRIEN row still has its bad date in the file
  await expectNoHorizontalScroll(page);
});
test('old .xls crew list imports the same way', async ({ page }, info) => {
  const xls = info.outputPath('crew.xls'); await makeCrewXlsx(xls, 'biff8');
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/crew/import');
  await page.getByLabel('Crew list file').setInputFiles(xls);
  await expect(page.getByLabel('Header row')).toHaveValue('4');
  await expect(page.getByRole('listitem').filter({ hasText: 'New' })).toHaveCount(2);
});
test('unsupported and unreadable files are explained', async ({ page }, info) => {
  const pdf = info.outputPath('crew.pdf'); await fs.writeFile(pdf, '%PDF-1.4');
  const bad = info.outputPath('locked.xlsx'); await fs.writeFile(bad, 'not a workbook');
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/crew/import');
  await page.getByLabel('Crew list file').setInputFiles(pdf);
  await expect(page.getByRole('alert')).toHaveText("This file type isn't supported. Use an Excel file (.xlsx or .xls) or a CSV file.");
  await page.getByLabel('Crew list file').setInputFiles(bad);
  await expect(page.getByRole('alert')).toContainText('password-protected');
});
```

- [ ] **Step 2: Run them and confirm they fail.** Run: `npx playwright test e2e/crewImport.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `CrewImport.tsx`.**
- [ ] **Step 4: Run them and confirm they pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: crew import wizard from Excel/CSV"`

---

### Task 17: Certificates screen

**Files:**
- Create: `src/ui/screens/Certificates.tsx`, `src/ui/screens/CertificateEdit.tsx`
- Test: `e2e/certificates.spec.ts`

**Interfaces:**
- Consumes: Task 2 (`CERTIFICATES`, `validateCertificate`, `certificateBand`), Task 15 `BandBadge` (`kind: 'certificate'`), Task 14 `Field`, Task 9 records.
- Produces:
  - **List:** sorted red first, then amber, then the rest, then by name. Button link `Add certificate`. Each row shows name, number, expiry and the badge; tapping it opens the edit screen.
  - **Edit** labels:
    - `Certificate`: a select grouped with `<optgroup>` per catalogue group, plus `Other`.
    - `Certificate name`: shown only for Other.
    - `Number`, `Issued by`, `Issue date`, `Expiry date`, `Next survey due`, `Remarks`.
    - Buttons `Save` and `Delete`.

- [ ] **Step 1: Write the failing e2e test.** The clock is `2026-10-25T09:00:00Z`.

```ts
test('certificate warnings and validation', async ({ page }) => {
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/certificates/new');
  await page.getByLabel('Certificate').selectOption({ label: 'International Load Line' });
  await page.getByLabel('Issue date').fill('2026-05-01'); await page.getByLabel('Expiry date').fill('2026-04-01');
  await expect(page.getByRole('alert')).toHaveText("Expiry date can't be before the issue date.");
  await page.getByLabel('Expiry date').fill('2026-12-24');         // 60 days → amber
  await page.getByRole('button', { name: 'Save' }).click();
  await page.goto('./#/ship/certificates/new');
  await page.getByLabel('Certificate').selectOption({ label: 'Other' });
  await page.getByLabel('Certificate name').fill('Fumigation exemption');
  await page.getByLabel('Expiry date').fill('2026-10-01');         // past → red
  await page.getByRole('button', { name: 'Save' }).click();
  const items = page.getByRole('listitem');
  await expect(items.nth(0)).toContainText('Fumigation exemption'); await expect(items.nth(0)).toContainText('Overdue');
  await expect(items.nth(1)).toContainText('International Load Line'); await expect(items.nth(1)).toContainText('Due soon');
  await expectNoHorizontalScroll(page);
});
```

- [ ] **Step 2: Run it and confirm it fails.** Run: `npx playwright test e2e/certificates.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the screens.**
- [ ] **Step 4: Run it and confirm it passes.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: certificates register screen"`

---

### Task 18: Voyage and ship's time screens

**Files:**
- Create: `src/ui/screens/Voyage.tsx`, `src/ui/screens/ShipTime.tsx`
- Test: `e2e/voyageTime.spec.ts`

**Interfaces:**
- Consumes: Task 3 (`shipOffsetAt`, `toShipLocal`, `shipLocalToInstant`, `nextScheduledChange`, `formatOffset`, `OFFSET_OPTIONS`), Task 9 records, Task 14 `Field` and `ConfirmDialog`.
- Produces:
  - **Voyage** labels: `Voyage no.`, `Last port`, `Next port`, `ETA (local)` (datetime-local), `ETA UTC offset` (select, default the current ship's offset), `Cargo`, `Charterers`, `Agents at next port`; button `Save`.
    - Button `Start new voyage` opens a confirm dialog with the button `Start new voyage`. It marks the current voyage `active: false` and creates a blank active one.
    - Heading `Previous voyages` with a list of voyage no. and ports.
    - If there is no voyage yet, the form is blank and `Save` creates an active voyage.
  - **Ship's time:**
    - Text `Ship's time HH:mm (UTC±hh:mm)`.
    - Buttons `Advance 1 h` and `Retard 1 h`: a change effective now, ±60 minutes, clamped to the valid range.
    - Select `Set offset` with button `Apply`.
    - Section `Schedule clock change`: datetime-local `Change at (ship's time)`, select `New offset`, button `Schedule`. The time is converted with the offset in effect now.
    - Heading `History`: list of changes, newest first, each as `<ship-local date time> → UTC±hh:mm`. Future ones are marked `Scheduled` and have a `Cancel` button (soft delete).

- [ ] **Step 1: Write the failing e2e tests.** The clock is `2026-10-25T09:00:00Z`, ship at +03:00.

```ts
test('ship time: advance, schedule, takes effect', async ({ page }) => {
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/time');
  await page.getByRole('button', { name: 'Advance 1 h' }).click();
  await expect(page.getByTestId('ship-clock')).toHaveText('13:00 LT (UTC+04:00)');
  await page.getByLabel("Change at (ship's time)").fill('2026-10-26T02:00');
  await page.getByLabel('New offset').selectOption({ label: 'UTC+05:00' });
  await page.getByRole('button', { name: 'Schedule' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Scheduled' })).toContainText('UTC+05:00');
  await page.clock.fastForward('14:00:00');                      // past 2026-10-25T22:00Z
  await expect(page.getByTestId('ship-clock')).toContainText('(UTC+05:00)');
  await expectNoHorizontalScroll(page);
});
test('voyage save and start new', async ({ page }) => {
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/voyage');
  await page.getByLabel('Voyage no.').fill('V-2611'); await page.getByLabel('Next port').fill('Rotterdam');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Start new voyage' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start new voyage' }).click();
  await expect(page.getByLabel('Voyage no.')).toHaveValue('');
  await expect(page.getByRole('listitem').filter({ hasText: 'V-2611' })).toBeVisible();
});
```

- [ ] **Step 2: Run them and confirm they fail.** Run: `npx playwright test e2e/voyageTime.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the screens.**
- [ ] **Step 4: Run them and confirm they pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: voyage and ship's time screens"`

---

### Task 19: Settings, backup export/import and snapshots UI

**Files:**
- Create: `src/ui/screens/Settings.tsx`, `src/ui/screens/ImportBackup.tsx`, `src/ui/components/PasswordDialog.tsx`
- Test: `e2e/backup.spec.ts`

**Interfaces:**
- Consumes:
  - Task 11: `exportBackup`, `prepareImport`, `applyImport`, `shareOrDownload`, `rememberPassword`, `getRememberedPassword`.
  - Task 8: `readHeader`, `validatePassword`, error classes.
  - Task 10: `listSnapshots`, `restoreSnapshot`.
  - Task 9: `updateSettings`, `listShips`.
- Produces:
  - **Settings sections:**
    - `Backup`: button `Export full backup`; select `Ship` plus button `Export handover file`; link `Import backup` → `#/settings/import`.
    - `Restore snapshot`: a list of date, reason and counts, each with a `Restore` button and a confirm dialog with button `Restore`.
    - `Backup reminder (days)`, `Device name`.
    - `About`: `Masterpiece <__APP_VERSION__>`.
  - **PasswordDialog** fields:
    - `Backup password` and `Repeat password` (export only).
    - Checkbox `Remember until the app is closed`, ticked by default.
    - Button `Export` or `Open`.
    - On the first export (`!firstExportDone`) it shows the text `Keep this password safe. If you forget it, nobody can open this backup — not even Masterpiece.`
    - A handover export uses a separate password and never fills in the remembered password.
  - **Import screen:**
    1. File input `Backup file`.
    2. Text `From <deviceName>, exported <YYYY-MM-DD HH:mm> UTC`, shown in UTC because a fresh device has no ship's time yet.
    3. Password field `Password` and button `Open`.
    4. Errors are shown with `role="alert"`, using the error class messages.
    5. Review: the line `<a> new · <u> updated · <d> deleted · <c> conflicts`.
    6. Each conflict is shown side by side with radios `Keep this device's version` and `Use the file's version`. Changed fields are shown by label.
    7. Deletions are listed with the checkbox `Apply <d> deletions` (unticked by default).
    8. Button `Apply import`, disabled until every conflict has a choice.
    9. Afterwards, the status `Import complete.` and a redirect to `#/`.

- [ ] **Step 1: Write the failing e2e tests.**

```ts
test('full backup round trip on a wiped device', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  // add one crew member PETROVIĆ via #/ship/crew/new (as in Task 15)
  await page.goto('./#/settings');
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export full backup' }).click();
  await expect(page.getByText('Keep this password safe.')).toBeVisible();
  await page.getByLabel('Backup password').fill('lozinka-ćevapi'); await page.getByLabel('Repeat password').fill('lozinka-ćevapi');
  await page.getByRole('button', { name: 'Export' }).click();
  const file = await (await dl).path();
  expect((await dl).suggestedFilename()).toMatch(/^masterpiece-full-mv-ocean-star-2026-10-25-\d{4}\.mpbak$/);
  await page.evaluate(() => new Promise(r => { const q = indexedDB.deleteDatabase('masterpiece'); q.onsuccess = q.onerror = q.onblocked = r; }));
  await page.reload();
  await page.getByRole('link', { name: 'Import a backup' }).click();
  await page.getByLabel('Backup file').setInputFiles(file);
  await page.getByLabel('Password').fill('wrong-password'); await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('alert')).toHaveText('Wrong password, or the file is damaged. Nothing was changed.');
  await page.getByLabel('Password').fill('lozinka-ćevapi'); await page.getByRole('button', { name: 'Open' }).click();
  // 1 ship + 1 crew + 1 clock change
  await expect(page.getByText('3 new · 0 updated · 0 deleted · 0 conflicts')).toBeVisible();
  await page.getByRole('button', { name: 'Apply import' }).click();
  await expect(page.getByRole('banner')).toContainText('MV OCEAN STAR');
  await page.goto('./#/ship/crew'); await expect(page.getByRole('listitem').filter({ hasText: 'PETROVIĆ' })).toBeVisible();
});
test('handover file holds one ship; conflict across two devices', async ({ browser }) => {
  // device A (context A): ships MV OCEAN STAR (+ crew PETROVIĆ) and MV SEA BREEZE; export handover for MV OCEAN STAR with password 'relief-pass-1'
  // device B (fresh context): import the handover → Profiles lists only MV OCEAN STAR
  // A: export full (pw 'pw-12345678') → B import, apply. Then edit PETROVIĆ nationality on A to 'Croatian', on B to 'Montenegrin'.
  // A: export full → B import → summary contains '1 conflicts'; choose 'Use the file's version' → Apply import → B crew edit shows 'Croatian'
});
test('snapshot restore', async ({ page }) => {
  // after an import (Task 11 creates 'before-import'), Settings → Restore snapshot lists it; Restore → confirm → data returns to the pre-import state
});
```

Spell out the commented steps as Playwright calls, using the labels above. Each device is a separate `browser.newContext()` with `freshApp`.

- [ ] **Step 2: Run them and confirm they fail.** Run: `npx playwright test e2e/backup.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the screens and dialog.** Export calls `shareOrDownload`. In Playwright (desktop) `canShare` is false, so the download path runs.
- [ ] **Step 4: Run them and confirm they pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: settings, encrypted export/import with review, snapshot restore"`

---

### Task 20: Home screen and alerts

**Files:**
- Create: `src/domain/alerts.ts`, `src/ui/screens/Home.tsx`
- Test: `src/domain/alerts.test.ts`, `e2e/home.spec.ts`

**Interfaces:**
- Consumes: Task 2 (`crewDocBand`, `certificateBand`), Task 4 (`onboardAt`, `fullName`), Task 3 (`nextScheduledChange`, `toShipLocal`, `formatOffset`), Task 11 (`isBackupDue`), Task 13 (`useAppState`).
- Produces:
  - `interface Alert { kind: 'crewDoc' | 'certificate'; band: 'amber' | 'red'; title: string; detail: string; href: string }`.
  - `collectAlerts(input: { crew: CrewMember[]; certificates: Certificate[]; today: string }): Alert[]`:
    - Crew: only crew onboard at `today`. Title is the full name; detail is `Passport expires <date>` or `Seaman's book expires <date>` (`expired` instead of `expires` when red). `href` is `#/ship/crew/<id>`.
    - Certificates: title is the name. Detail when amber: `Expires <date>` or `Survey due <date>`. Detail when red: `Expired <date>` or `Survey overdue <date>`. `href` is `#/ship/certificates/<id>`.
    - When both dates of one record are flagged, the detail uses the worse band; on a tie, the earlier date.
    - Order: red first, then by date ascending. Deleted records are excluded.
  - **Home content:**
    - Backup banner when due: `No backup yet. Export one now.` or `Last backup <n> days ago. Export a backup now.`, with button link `Export full backup` → `#/settings`.
    - When persistence is `denied`: `This browser may clear Masterpiece's data when storage runs low. Install the app and export backups regularly.`
    - Section `Alerts`, with linked items.
    - When there is an upcoming change: `Clock change <DD Mon HH:mm> → UTC±hh:mm`.
    - Link `Ship's data` → `#/ship/particulars`.

- [ ] **Step 1: Write the failing tests.**

```ts
// alerts.test.ts — today '2026-10-25'
const a = collectAlerts({ today: '2026-10-25',
  crew: [crew({ givenNames: 'Ivan', surname: 'PETROVIĆ', passportExpiry: '2027-01-10', signOnDate: '2026-06-01' }),
         crew({ givenNames: 'Old', surname: 'GONE', passportExpiry: '2026-01-01', signOnDate: '2026-01-01', signOffDate: '2026-05-01' })],
  certificates: [cert({ name: 'International Load Line', expiryDate: '2026-10-01' }), cert({ name: 'IOPP', expiryDate: '2030-01-01', nextSurveyDue: '2026-12-01' }), cert({ name: 'ISSC', expiryDate: '2026-09-01', deleted: true })] });
expect(a.map(x => [x.band, x.title])).toEqual([['red', 'International Load Line'], ['amber', 'IOPP'], ['amber', 'Ivan PETROVIĆ']]);
expect(a[1].detail).toBe('Survey due 2026-12-01');
expect(a[2].detail).toBe('Passport expires 2027-01-10');
expect(a[0].detail).toBe('Expired 2026-10-01');
```

```ts
// home.spec.ts
test('home shows backup reminder and alerts', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await expect(page.getByText('No backup yet. Export one now.')).toBeVisible();
  // add certificate 'International Load Line' expiry 2026-10-01 (Task 17 screen), go Home
  await expect(page.getByRole('region', { name: 'Alerts' }).getByRole('link')).toContainText(['International Load Line']);
  await expectNoHorizontalScroll(page);
});
```

The alert details use ISO dates in the domain layer. Home displays them in the same form.

- [ ] **Step 2: Run them and confirm they fail.** Run: `npx vitest run src/domain/alerts.test.ts && npx playwright test e2e/home.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `alerts.ts` and `Home.tsx`.** The `Alerts` section uses `<section aria-label="Alerts">`.
- [ ] **Step 4: Run them and confirm they pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: home screen with backup reminder and expiry alerts"`

---

### Task 21: App lock UI (fingerprint on phones, 4-digit passcode everywhere)

**Files:**
- Create: `src/ui/screens/LockScreen.tsx`, `src/ui/components/AppLockSettings.tsx`, `src/ui/screens/ProtectApp.tsx`
- Modify: `src/app/App.tsx` (lock gate and first-start protect step), `src/ui/screens/Settings.tsx` (adds the `App lock` section)
- Test: `e2e/lock.spec.ts`

**Interfaces:**
- Consumes: Task 12 (`isValidPin`, `hashPin`, `verifyPin`, `registerFailure`, `registerSuccess`, `lockRemainingMs`, `shouldRelock`, `isFingerprintAvailable`, `registerFingerprint`, `unlockWithFingerprint`), Task 9 (`updateSettings`), Task 13 (`useAppState`, welcome flow).
- **User decisions:**
  - **Phones** unlock with the fingerprint first, with the 4-digit passcode as the fallback.
  - **Laptops** use the 4-digit passcode only.
  - The lock is offered right after the first ship is created, and stays on until it is turned off in Settings.
- Produces:
  - **First-start protect step (`ProtectApp.tsx`).** It is shown once, after the first ship is created on the welcome screen, and again whenever no lock has been set up and `settings.lockPrompted` is not true.
    - Heading `Protect Masterpiece`.
    - Text `Set a 4-digit passcode to open the app.` On phones with a fingerprint sensor it adds ` You can also unlock with your fingerprint.`
    - Fields `New passcode` and `Repeat passcode`.
    - On a phone with a fingerprint sensor (`isFingerprintAvailable()`), the checkbox `Also unlock with fingerprint`, ticked by default.
    - Buttons `Turn on app lock` and `Skip for now`.
    - Either button sets `settings.lockPrompted = true`, so the step is not shown again.
    - Turning the lock on with the fingerprint box ticked calls `registerFingerprint()`. If that fails, the passcode is still saved and the message `Fingerprint couldn't be set up. You can try again in Settings.` is shown.
  - **Settings section `App lock`:**
    - When off: button `Turn on app lock` (the same fields as the protect step).
    - When on: `Change passcode`, the toggle `Unlock with fingerprint` (shown only when `isFingerprintAvailable()`), `Lock after (minutes in background)` (default 5) and `Turn off app lock`.
    - Exact texts:
      - `The lock stops casual access. It does not encrypt the data on this device — your phone's screen lock and encryption are the real protection.`
      - `If you can't unlock (forgotten passcode and no fingerprint), the only way back in is to erase all data on this device and restore a backup.`
    - Invalid passcode: `Use exactly 4 digits.` Mismatch: `The passcodes don't match.`
  - **Lock screen (`LockScreen.tsx`):**
    - The 64 px logo, heading `Masterpiece is locked`, and the active ship name.
    - **With a fingerprint enrolled** (phone): on mount it calls `unlockWithFingerprint()` straight away, showing the button `Unlock with fingerprint` (to retry) and the link-button `Use passcode`. If the fingerprint returns false it switches to the passcode view with the text `Fingerprint not recognised — enter your passcode.`
    - **Passcode view:** input `Passcode` (`inputmode="numeric"`, `maxlength="4"`, `autocomplete="off"`). It submits automatically at the 4th digit; there is also a button `Unlock`.
      - Wrong passcode → `Wrong passcode.`
      - Locked out → `Too many attempts. Try again in <n> s.` (the countdown updates every second). Fingerprint failures do not count towards the lockout.
    - Button `Forgot passcode?` opens a confirm dialog with the button `Erase everything`. It deletes the Dexie database, then calls `location.reload()`.
  - **Gate:**
    - The lock shows on app start when a passcode is set.
    - On `visibilitychange` to hidden, record `hiddenAt` in memory. On visible, lock if `shouldRelock` is true.
    - The lockout state is persisted in `settings.pin.lockout`, so a reload does not reset it.
    - `Settings` gains `lockPrompted?: boolean`.

- [ ] **Step 1: Write the failing e2e tests.**

```ts
test('protect step and passcode lock (laptop: no fingerprint offered)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await freshApp(page); await setupShip(page);
  await expect(page.getByRole('heading', { name: 'Protect Masterpiece' })).toBeVisible();
  await expect(page.getByLabel('Also unlock with fingerprint')).toHaveCount(0);
  await page.getByLabel('New passcode').fill('123'); await page.getByLabel('Repeat passcode').fill('123');
  await page.getByRole('button', { name: 'Turn on app lock' }).click();
  await expect(page.getByRole('alert')).toHaveText('Use exactly 4 digits.');
  await page.getByLabel('New passcode').fill('2580'); await page.getByLabel('Repeat passcode').fill('2580');
  await page.getByRole('button', { name: 'Turn on app lock' }).click();
  await page.reload(); await expect(page.getByRole('heading', { name: 'Masterpiece is locked' })).toBeVisible();
  for (let i = 0; i < 5; i++) await page.getByLabel('Passcode').fill('0000');   // auto-submits at 4 digits
  await expect(page.getByText(/Too many attempts\. Try again in \d+ s\./)).toBeVisible();
  await page.clock.fastForward(31_000);
  await page.getByLabel('Passcode').fill('2580');
  await expect(page.getByRole('banner')).toContainText('MV OCEAN STAR');
  const setVis = (v: string) => page.evaluate(v => { Object.defineProperty(document, 'visibilityState', { value: v, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }, v);
  await setVis('hidden'); await page.clock.fastForward('06:00'); await setVis('visible');
  await expect(page.getByRole('heading', { name: 'Masterpiece is locked' })).toBeVisible();
  await page.getByRole('button', { name: 'Forgot passcode?' }).click();
  await page.getByRole('button', { name: 'Erase everything' }).click();
  await expect(page.getByRole('button', { name: 'Create your first ship' })).toBeVisible();
});

test('phone: fingerprint first, passcode as fallback', async ({ page }, info) => {
  test.skip(info.project.name !== 'android');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await freshApp(page); await setupShip(page);
  await expect(page.getByLabel('Also unlock with fingerprint')).toBeChecked();
  await page.getByLabel('New passcode').fill('2580'); await page.getByLabel('Repeat passcode').fill('2580');
  await page.getByRole('button', { name: 'Turn on app lock' }).click();
  await page.reload();                                                      // fingerprint prompt runs on open and succeeds
  await expect(page.getByRole('banner')).toContainText('MV OCEAN STAR');
  await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: false });
  await page.reload();
  await expect(page.getByText('Fingerprint not recognised — enter your passcode.')).toBeVisible();
  await page.getByLabel('Passcode').fill('2580');
  await expect(page.getByRole('banner')).toContainText('MV OCEAN STAR');
});

test('skip for now does not ask again', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Protect Masterpiece' })).toHaveCount(0);
  await expect(page.getByRole('banner')).toContainText('MV OCEAN STAR');
});
```

Task 13's `setupShip` helper must leave the protect step visible; it doesn't dismiss it. Earlier e2e specs that use `setupShip` click `Skip for now`, through the helper's new option `setupShip(page, name, offset, { skipLock = true })`. The default skips, so Tasks 13–20 need no change; this test passes `{ skipLock: false }`.

- [ ] **Step 2: Run them and confirm they fail.** Run: `npx playwright test e2e/lock.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the protect step, the lock screen, the settings section and the gate.** Update the `setupShip` helper as above.
- [ ] **Step 4: Run them and confirm they pass,** together with the earlier e2e specs. Run: `npx playwright test`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: app lock with fingerprint and 4-digit passcode"`

---

### Task 22: Contracts and relief planning

**Files:**
- Create: `src/domain/contracts.ts`, `src/ui/screens/Reliefs.tsx`
- Modify: `src/domain/types.ts`, `src/domain/validation.ts`, `src/domain/fieldDictionary.ts`, `src/domain/alerts.ts`, `src/ui/screens/CrewEdit.tsx`, `src/ui/screens/Particulars.tsx`, `src/app/router.ts`, `src/ui/components/Nav.tsx`, `src/ui/screens/Home.tsx`
- Test: `src/domain/contracts.test.ts`, plus additions to `src/domain/validation.test.ts`, `src/domain/fieldDictionary.test.ts`, `src/domain/alerts.test.ts`; `e2e/reliefs.spec.ts`

**Interfaces:**
- Consumes: Task 2 (`addMonths`, `addDays`, `Band`), Task 4 (`onboardAt`, `fullName`), Task 15 `BandBadge`, Task 20 `collectAlerts`.
- Produces in `types.ts`:
  - `CrewMember` gains `contractMonths?: number; reliefPlannedDate?: string; reliefPlannedPort?: string`.
  - `ShipProfile` gains `maxMonthsOnboard?: number`.
- Produces in `contracts.ts`:
  - `DEFAULT_MAX_MONTHS_ONBOARD = 11`.
  - `contractEndDate(m): string | undefined`: `addMonths(signOnDate, contractMonths)` when `contractMonths > 0`.
  - `daysOnboard(m, asAt: string): number`:
    - 0 if `asAt < signOnDate`;
    - otherwise the end date is the earlier of `asAt` and `signOffDate`, and the result is (end − sign-on) in days + 1.
  - `contractBand(m, ref): Band`: `'none'` without an end date; red if end < ref; amber if end ≤ ref + 30 days; otherwise ok.
  - `onboardLimitDate(m, maxMonths): string` = `addMonths(signOnDate, maxMonths)`.
  - `onboardLimitBand(m, ref, maxMonths = 11): Band`: red if ref ≥ limit; amber if ref ≥ limit − 30 days; otherwise ok.
- Validation (`validateCrewMember`):
  - `contractMonths`, if set, must be an integer 1–24. Message: `Enter whole months between 1 and 24.`
  - `reliefPlannedDate`, if set, must be a valid date.
- Field dictionary: `crew.byRank.<rank>.contractEndDate` and `crew.byRank.<rank>.daysOnboard` (as at the reference date).
- `collectAlerts` input gains `maxMonthsOnboard: number`. New alert kinds:
  - `'contract'`: amber `Contract ends <date>`, red `Contract ended <date> — relief overdue`.
  - `'onboardLimit'`: amber `Reaches <n>-month onboard limit <date>`, red `Over <n>-month onboard limit since <date>`.
  - Both have `href` `#/ship/reliefs` and cover onboard crew only.
- **UI:**
  - CrewEdit adds `Contract length (months)`, `Planned relief date` and `Planned relief port`.
  - Particulars adds section heading `Crew policy` with field `Maximum months onboard` (blank means 11). Error: `Enter a number from 1 to 11.`
  - New route `#/ship/reliefs`, with ship sub-nav link `Reliefs`. It lists onboard crew (as at ship's today), sorted by contract end ascending, with no-contract crew last.
  - Each row shows rank, full name, `Onboard <n> days`, then `Contract ends <date>` or `No contract length`, then `Relief <date> <port>` when planned.
  - Badges: contract `Relief due soon` / `Relief overdue`; limit `Near onboard limit` / `Onboard limit reached` (rendered with `data-band`).
  - Home shows the new alerts.

- [ ] **Step 1: Write the failing tests.**

```ts
const m = crew({ signOnDate: '2026-06-01', contractMonths: 6 });
expect(contractEndDate(m)).toBe('2026-12-01');
expect(contractEndDate({ ...m, contractMonths: undefined })).toBeUndefined();
expect(daysOnboard(m, '2026-06-01')).toBe(1);
expect(daysOnboard(m, '2026-10-25')).toBe(147);
expect(daysOnboard({ ...m, signOffDate: '2026-07-01' }, '2026-10-25')).toBe(31);
expect(daysOnboard(m, '2026-05-01')).toBe(0);
expect(contractBand(m, '2026-11-01')).toBe('amber');   // end = ref + 30
expect(contractBand(m, '2026-10-31')).toBe('ok');
expect(contractBand(m, '2026-12-01')).toBe('amber');   // ends today
expect(contractBand(m, '2026-12-02')).toBe('red');
const j = crew({ signOnDate: '2026-01-01' });          // limit 2026-12-01 at 11 months
expect(onboardLimitBand(j, '2026-12-01', 11)).toBe('red');
expect(onboardLimitBand(j, '2026-11-01', 11)).toBe('amber');
expect(onboardLimitBand(j, '2026-10-31', 11)).toBe('ok');
expect(onboardLimitBand(j, '2026-10-01', 9)).toBe('red');  // limit 2026-10-01
expect(validateCrewMember({ ...draft, contractMonths: 25 }, '2026-10-25')[0]).toMatchObject({ field: 'contractMonths', message: 'Enter whole months between 1 and 24.' });
expect(resolveField('crew.byRank.master.contractEndDate', ctxWithContract)).toBe('2026-12-01');
expect(resolveField('crew.byRank.master.daysOnboard', ctxWithContract, { asAt: '2026-10-25' })).toBe(147);
const al = collectAlerts({ today: '2026-11-15', maxMonthsOnboard: 11, certificates: [], crew: [m] });
expect(al).toContainEqual(expect.objectContaining({ kind: 'contract', band: 'amber', detail: 'Contract ends 2026-12-01', href: '#/ship/reliefs' }));
```

```ts
// e2e/reliefs.spec.ts — clock 2026-10-25T09:00:00Z
test('reliefs view shows overdue relief and onboard limit', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  // add crew PETROVIĆ Ivan, Master, sign-on 2025-11-20, Contract length (months) 9, Planned relief date 2026-11-05, port Santos
  await page.goto('./#/ship/reliefs');
  const row = page.getByRole('listitem').filter({ hasText: 'Ivan PETROVIĆ' });
  await expect(row).toContainText('Contract ends 2026-08-20');
  await expect(row.getByText('Relief overdue')).toBeVisible();
  await expect(row.getByText('Onboard limit reached')).toBeVisible();  // 2025-11-20 + 11 months = 2026-10-20
  await expect(row).toContainText('Relief 2026-11-05 Santos');
  await page.goto('./#/ship/particulars'); await page.getByLabel('Maximum months onboard').fill('12');
  await expect(page.getByRole('alert')).toHaveText('Enter a number from 1 to 11.');
  await expectNoHorizontalScroll(page);
});
```

Spell out the commented step as real Playwright calls, using the Task 15 labels plus the new ones.

- [ ] **Step 2: Run them and confirm they fail.** Run: `npx vitest run src/domain && npx playwright test e2e/reliefs.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the domain module, the type and validation additions, the dictionary and alert additions, and the UI.
- [ ] **Step 4: Run them and confirm they pass.** Run: `npm test && npx playwright test e2e/reliefs.spec.ts e2e/crew.spec.ts e2e/home.spec.ts && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: contracts, days onboard and relief planning"`

---

### Task 23: Crew certificate register

**Files:**
- Create: `src/domain/crewDocs.ts`, `src/ui/screens/CrewDocumentEdit.tsx`, `src/ui/screens/Expiring.tsx`
- Modify:
  - Domain: `src/domain/types.ts`, `src/domain/catalogues.ts`, `src/domain/fieldDictionary.ts`, `src/domain/alerts.ts`
  - Database and backup: `src/db/schema.ts`, `src/db/records.ts`, `src/backup/envelope.ts`
  - Screens: `src/ui/screens/CrewEdit.tsx`, `src/ui/screens/Crew.tsx`
  - Shell: `src/app/router.ts`, `src/ui/components/Nav.tsx`
- Test: `src/domain/crewDocs.test.ts`, `src/db/migrationV2.test.ts`, plus additions to `src/backup/envelope.test.ts` and `src/domain/fieldDictionary.test.ts`; `e2e/crewDocs.spec.ts`

**Interfaces:**
- Consumes: Task 2 (`expiryBand`, `crewDocBand`, `worstBand`), Task 4 (`onboardAt`, `fullName`, `rejoinDraft`), Task 9 (`createRecord`, `softDelete`, `listForShip`), Task 10 (`snapshotInUpgrade`), Task 15 (`BandBadge`, the Re-join and Delete flows), Task 18 (active voyage).
- Produces in `types.ts`:
  - `type CrewDocType = 'coc' | 'endorsement' | 'gmdss' | 'medical' | 'yellowFever' | 'bst' | 'aff' | 'pscrb' | 'frb' | 'mfa' | 'medicalCare' | 'securityAwareness' | 'dsd' | 'sso' | 'ecdis' | 'brm' | 'erm' | 'highVoltage' | 'usVisa' | 'schengenVisa' | 'other'`.
  - `interface CrewDocument extends BaseRecord { shipId: string; crewId: string; type: CrewDocType; typeOther?: string; grade: string; number: string; issuedBy: string; issueDate: string; expiryDate?: string; remarks: string }`.
  - `TableName` adds `'crewDocuments'`, which is appended to `TABLE_NAMES` (the generic merge, backup and snapshot code picks it up).
- Produces in `catalogues.ts`: `CREW_DOC_TYPES: readonly { key: CrewDocType; label: string; group: string; graded: boolean }[]` in spec §4.14 order. Labels:
  - Competency: `Certificate of Competency (CoC)`, `Flag endorsement`, `GMDSS certificate`
  - Health: `Medical fitness certificate`, `Yellow fever certificate`
  - STCW courses: `Basic safety training`, `Advanced fire fighting`, `Survival craft and rescue boats`, `Fast rescue boats`, `Medical first aid`, `Medical care`, `Security awareness`, `Designated security duties`, `Ship security officer`, `ECDIS`, `Bridge resource management`, `Engine-room resource management`, `High voltage`
  - Visas: `US C1/D visa`, `Schengen visa`
  - `Other`
  - `graded` is true for coc, endorsement and gmdss.
- Produces in `crewDocs.ts`:
  - `docLabel(d): string`.
  - `docBand(d, ref): Band`: `expiryBand(d.expiryDate, ref, { days: 90 })`.
  - `crewMemberBand(m: CrewMember, docs: CrewDocument[], ref): Band`: the worst of `crewDocBand(m, ref)` and the `docBand` of each non-deleted doc with `crewId === m.id`.
  - `carryOverDocuments(docs, fromCrewId, signOnDate): Omit<CrewDocument, keyof BaseRecord | 'crewId'>[]`: non-deleted docs of `fromCrewId` with no expiry or `expiryDate ≥ signOnDate`.
  - `interface ExpiringItem { crewId: string; name: string; rank: string; what: string; expiryDate: string; band: Band }`.
  - `expiringBefore(input: { crew: CrewMember[]; docs: CrewDocument[]; today: string; until: string }): ExpiringItem[]`:
    - Covers crew onboard at `today`: passport (`what: 'Passport'`), seaman's book (`"Seaman's book"`) and each doc (`docLabel`).
    - Includes items with `expiryDate ≤ until`, sorted by expiry date ascending, then name.
- **Database:** `MasterpieceDB` adds `version(2).stores({ crewDocuments: 'id, shipId, crewId' }).upgrade(tx => snapshotInUpgrade(tx))`. Every version-1 table stays the same.
- **Backup compatibility:**
  - `openBackup` requires the five original tables. Tables added later (`crewDocuments`) default to `[]` when absent.
  - The envelope version stays 1.
- **Cascades:**
  - Crew delete (Task 15) also soft-deletes the member's documents.
  - Re-join (Task 15) creates `carryOverDocuments` copies with the new `crewId`.
  - `deleteShip` covers `crewDocuments` by `shipId`.
- **Field dictionary:** `crew.byRank.<rank>.doc.<type>.<field>`, where field is number, grade, issuedBy, issueDate or expiryDate. It reads that crew member's latest non-deleted doc of that type, by `issueDate`, then `createdAt`.
- **Alerts:** onboard crew's docs. Title is the full name. Detail is `<label> expires <date>` (amber) or `<label> expired <date>` (red). `href` is `#/ship/crew/<crewId>`.
- **UI:**
  - CrewEdit (existing member) gains section heading `Documents`: rows show label, number, expiry and BandBadge (`kind: 'crew'`), plus button `Add document`.
  - The document edit route is `#/ship/crew/:id/documents/new` or `…/documents/:docId`. Labels:
    - `Document` (select, grouped);
    - `Document name` (Other only);
    - `Grade / capacity` (graded types only);
    - `Number`, `Issued by`, `Issue date`, `Expiry date`, `Remarks`;
    - buttons `Save` and `Delete`.
    - Validation: expiry before issue gives `Expiry date can't be before the issue date.`
  - The crew list badge uses `crewMemberBand`.
  - New route `#/ship/expiring`, with sub-nav link `Expiring`:
    - heading `Expiring before next port`;
    - with an active voyage that has an ETA: text `Next port <port>, ETA <date>`, and `until` = the ETA date;
    - otherwise: text `No next port ETA set — showing the next 90 days.`, and `until` = today + 90;
    - rows: rank, name, what, expiry and badge.

- [ ] **Step 1: Write the failing tests.**

```ts
// crewDocs.test.ts — ref '2026-10-25'
const med = doc({ crewId: 'c1', type: 'medical', expiryDate: '2027-01-01' });
const bst = doc({ crewId: 'c1', type: 'bst' });                       // no expiry
const visa = doc({ crewId: 'c1', type: 'usVisa', expiryDate: '2026-09-01' });
const gone = doc({ crewId: 'c1', type: 'ecdis', deleted: true });
expect(carryOverDocuments([med, bst, visa, gone], 'c1', '2026-10-20').map(d => d.type)).toEqual(['medical', 'bst']);
expect(docBand(doc({ expiryDate: '2027-01-23' }), '2026-10-25')).toBe('amber'); // +90 inclusive
expect(docBand(doc({ expiryDate: '2027-01-24' }), '2026-10-25')).toBe('ok');
expect(crewMemberBand(crew({ id: 'c1', passportExpiry: '2030-01-01', seamansBookExpiry: '2030-01-01' }), [med], '2026-10-25')).toBe('amber');
expect(crewMemberBand(crew({ id: 'c1', passportExpiry: '2030-01-01', seamansBookExpiry: '2030-01-01' }), [visa], '2026-10-25')).toBe('red');
const items = expiringBefore({ today: '2026-10-25', until: '2027-01-10',
  crew: [crew({ id: 'c1', givenNames: 'Ivan', surname: 'PETROVIĆ', passportExpiry: '2026-12-01', seamansBookExpiry: '2030-01-01', signOnDate: '2026-06-01' })],
  docs: [med, bst, doc({ crewId: 'c1', type: 'coc', expiryDate: '2026-11-15' })] });
expect(items.map(i => [i.what, i.expiryDate])).toEqual([['Certificate of Competency (CoC)', '2026-11-15'], ['Passport', '2026-12-01'], ['Medical fitness certificate', '2027-01-01']]);
// envelope.test.ts — a version-1 payload without crewDocuments still opens
const old = await sealBackup(H, { tables: { ships: [], crew: [], voyages: [], certificates: [], clockChanges: [] } } as never, 'pw-12345678', { iterations: 1000 });
expect((await openBackup(old, 'pw-12345678')).payload.tables.crewDocuments).toEqual([]);
// migrationV2.test.ts — open a v1-only DB, write a ship, close; open MasterpieceDB (v2) on the same name
expect((await listSnapshots(v2))[0]).toMatchObject({ reason: 'before-update' });
expect((await listSnapshots(v2))[0].counts.ships).toBe(1);
await createRecord<CrewDocument>(v2, 'crewDocuments', { shipId, crewId: 'c1', type: 'medical', grade: '', number: 'M-1', issuedBy: '', issueDate: '2025-01-01', expiryDate: '2027-01-01', remarks: '' });
expect(await listForShip(v2, 'crewDocuments', shipId)).toHaveLength(1);
// fieldDictionary.test.ts
expect(resolveField('crew.byRank.master.doc.coc.number', ctxWithDocs)).toBe('CoC-123');
```

`migrationV2.test.ts` builds the v1 database with a local test-only Dexie subclass that declares only the version-1 stores.

```ts
// e2e/crewDocs.spec.ts — clock 2026-10-25T09:00:00Z
test('documents: warning, expiring before next port, carry-over on re-join', async ({ page }) => {
  // set up a ship, add crew PETROVIĆ Ivan (Master, sign-on 2026-06-01, passport and SB expiry 2030-01-01)
  // on his edit screen: Add document → Document 'Medical fitness certificate', Number 'M-1', Expiry date 2026-12-24 → Save
  // crew list row shows 'Expires soon'
  // Voyage: Next port 'Rotterdam', ETA (local) 2027-01-05T08:00 → Save
  // #/ship/expiring shows 'Next port Rotterdam, ETA 2027-01-05' and a row containing 'Medical fitness certificate'
  // Sign off 2026-10-26 Santos; set As at 2026-10-26; Re-join sign-on 2026-11-01 Rotterdam → the new contract's Documents section lists 'Medical fitness certificate'
  // expectNoHorizontalScroll on the Expiring screen
});
```

Spell out the commented steps as Playwright calls with the labels above.

- [ ] **Step 2: Run them and confirm they fail.** Run: `npx vitest run src && npx playwright test e2e/crewDocs.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the types, catalogue, domain module, database v2, envelope compatibility, cascades, dictionary, alerts and UI.
- [ ] **Step 4: Run them and confirm they pass.** Run: `npm test && npx playwright test && npm run typecheck`. Expected: PASS. The full e2e suite is needed because the database version changed.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: crew certificate register with expiry warnings"`

---

### Task 24: Crew list print and Excel export

**Files:**
- Create: `src/domain/crewList.ts`, `src/ui/screens/CrewListPrint.tsx`
- Modify: `src/domain/types.ts`, `src/domain/dates.ts`, `src/backup/share.ts`, `src/backup/fileName.ts`, `src/ui/screens/Crew.tsx`, `src/app/router.ts`, `src/ui/print.css`
- Test: `src/domain/crewList.test.ts`, plus an addition to `src/domain/dates.test.ts`; `e2e/crewListPrint.spec.ts`

**Interfaces:**
- Consumes:
  - Task 4: `onboardAt`, `fullName`.
  - Task 2: `rankLabel`.
  - Task 22: `contractEndDate`.
  - Task 23: the CrewDocument with type `coc`, latest by `issueDate`.
  - Task 11: `shareOrDownload`, `backupFileName`'s slug rule.
  - Task 5: `readSpreadsheet`, which is used in tests.
- Produces:
  - `ShipProfile` gains `crewListColumns?: CrewListColumn[]`.
  - `formatDisplayDate(iso: string): string` in `dates.ts`: `'1985-01-05'` → `'05-JAN-1985'`, and `''` → `''`.
  - `slugify(s: string): string`, exported from `fileName.ts` and reused by `backupFileName`.
  - `shareOrDownload(fileName: string, data: string | Blob)`, widened from `text: string`.
  - `type CrewListColumn = 'no' | 'surname' | 'givenNames' | 'rank' | 'nationality' | 'dateOfBirth' | 'placeOfBirth' | 'passportNo' | 'passportExpiry' | 'seamansBookNo' | 'seamansBookExpiry' | 'signOnDate' | 'signOnPort' | 'cocNumber' | 'contractEnd'`.
  - `CREW_LIST_COLUMNS: readonly { key: CrewListColumn; label: string; byDefault: boolean }[]`, in the type's order, with labels `No.`, `Surname`, `Given names`, `Rank`, `Nationality`, `Date of birth`, `Place of birth`, `Passport no.`, `Passport expiry`, `Seaman's book no.`, `Seaman's book expiry`, `Sign-on date`, `Sign-on port`, `CoC no.`, `Contract end`. `byDefault` is true for the first 9 and for signOnDate and signOnPort.
  - `buildCrewList(input: { crew: CrewMember[]; docs: CrewDocument[]; columns: CrewListColumn[]; asAt: string; filter: 'onboard' | 'all' }): { headers: string[]; rows: string[][] }`:
    - Rows come in `onboardAt` order (for `all`, the same sort applied to every non-deleted record).
    - Columns follow `CREW_LIST_COLUMNS` order whatever order `columns` lists them in.
    - `No.` is 1…n; dates use `formatDisplayDate`; rank uses `rankLabel`.
  - `crewListWorkbook(input: { ship: ShipProfile; port: string; date: string; table: { headers: string[]; rows: string[][] } }): ArrayBuffer`. One sheet named `Crew list`, with these rows:
    1. `['CREW LIST']`
    2. `['Vessel', name, 'IMO', imo]`
    3. `['Call sign', callSign, 'Flag', flag]`
    4. `['Port', port, 'Date', formatDisplayDate(date)]`
    5. `[]`
    6. headers, then the table rows
  - `crewListFileName(shipName: string, date: string): string` = `` `crew-list-${slugify(shipName)}-${date}.xlsx` ``.
- **UI:**
  - The crew list gets buttons `Print crew list` and `Export to Excel`. Both open `#/ship/crew/print` carrying the current As at and filter.
  - The print screen has an options panel (`class="no-print"`):
    - `Port` (default: active voyage next port) and `Date` (default: As at);
    - one checkbox per column, using the column label. Changes save to `ship.crewListColumns`;
    - buttons `Print` (`window.print()`) and `Export to Excel` (`shareOrDownload`).
  - The sheet (`data-testid="crew-list-sheet"`) contains:
    - heading `CREW LIST`;
    - lines `Vessel <name>   IMO <imo>   Call sign <cs>   Flag <flag>` and `Port <port>   Date <DD-MMM-YYYY>`;
    - the table;
    - `Master: <master full name or blank>` with a signature line;
    - a box labelled `Ship's stamp`;
    - footer `Printed with Masterpiece`.
  - A4 landscape applies on this screen only, through a named `@page`. Print media hides `.no-print`, the header and the nav.

- [ ] **Step 1: Write the failing tests.**

```ts
expect(formatDisplayDate('1985-01-05')).toBe('05-JAN-1985');
expect(formatDisplayDate('')).toBe('');
const def = CREW_LIST_COLUMNS.filter(c => c.byDefault).map(c => c.key);
const t = buildCrewList({ crew: [ab, master, offSigned], docs: [cocDoc], columns: def, asAt: '2026-10-25', filter: 'onboard' });
expect(t.headers).toEqual(['No.', 'Surname', 'Given names', 'Rank', 'Nationality', 'Date of birth', 'Place of birth', 'Passport no.', 'Passport expiry', 'Sign-on date', 'Sign-on port']);
expect(t.rows.map(r => r[3])).toEqual(['Master', 'AB']);             // rank order, signed-off excluded
expect(t.rows[0]).toEqual(['1', 'PETROVIĆ', 'Ivan', 'Master', 'Serbian', '05-JAN-1985', 'Kotor', '012345678', '01-MAR-2030', '01-JUN-2026', 'Rotterdam']);
expect(buildCrewList({ crew: [ab, master, offSigned], docs: [cocDoc], columns: ['cocNumber', 'surname'], asAt: '2026-10-25', filter: 'all' }).headers).toEqual(['Surname', 'CoC no.']);
expect(buildCrewList({ crew: [master], docs: [cocDoc], columns: ['surname', 'cocNumber'], asAt: '2026-10-25', filter: 'all' }).rows[0]).toEqual(['PETROVIĆ', 'CoC-123']);
const wb = crewListWorkbook({ ship, port: 'Rotterdam', date: '2026-10-25', table: t });
const [sheet] = await readSpreadsheet('x.xlsx', wb);
expect(sheet.name).toBe('Crew list');
expect(sheet.rows[0][0]).toBe('CREW LIST');
expect(sheet.rows[3]).toEqual(['Port', 'Rotterdam', 'Date', '25-OCT-2026']);
expect(sheet.rows[5]).toEqual(t.headers);
expect(crewListFileName('M/V Ocean Star', '2026-10-25')).toBe('crew-list-m-v-ocean-star-2026-10-25.xlsx');
```

```ts
// e2e/crewListPrint.spec.ts — clock 2026-10-25T09:00:00Z
test('print crew list and export to Excel', async ({ page }) => {
  // ship MV OCEAN STAR (IMO 9074729 via Particulars), crew PETROVIĆ Ivan Master + one AB; Voyage next port Rotterdam
  await page.goto('./#/ship/crew'); await page.getByRole('button', { name: 'Print crew list' }).click();
  const sheet = page.getByTestId('crew-list-sheet');
  await expect(sheet.getByRole('heading', { name: 'CREW LIST' })).toBeVisible();
  await expect(sheet).toContainText('MV OCEAN STAR'); await expect(sheet).toContainText('Port Rotterdam');
  await expect(sheet.getByRole('row')).toHaveCount(3);                 // header + 2 crew
  await page.getByLabel('Place of birth').uncheck();
  await expect(sheet.getByRole('columnheader', { name: 'Place of birth' })).toHaveCount(0);
  await page.reload(); await expect(page.getByLabel('Place of birth')).not.toBeChecked();
  const dl = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export to Excel' }).click();
  expect((await dl).suggestedFilename()).toBe('crew-list-mv-ocean-star-2026-10-25.xlsx');
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('button', { name: 'Print' })).toBeHidden();
  await expect(sheet).toBeVisible();
});
```

Spell out the commented setup with the earlier tasks' labels.

- [ ] **Step 2: Run them and confirm they fail.** Run: `npx vitest run src/domain && npx playwright test e2e/crewListPrint.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the domain module, the widened share function, the screen and the print CSS.
- [ ] **Step 4: Run them and confirm they pass.** Run: `npm test && npx playwright test e2e/crewListPrint.spec.ts e2e/backup.spec.ts && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: printable crew list and Excel export"`

---

### Task 25: GitHub Pages deploy, README and full verification

**Files:**
- Create: `.github/workflows/deploy.yml`, `README.md`

**Interfaces:**
- Consumes: the npm scripts from Task 1.
- Produces:
  - **Workflow:** on `push` to `main` and `workflow_dispatch`.
    - Permissions: `contents: read`, `pages: write`, `id-token: write`.
    - Job `build`: `actions/checkout@v4`, `actions/setup-node@v4` (node 22, npm cache), `npm ci`, `npm test`, `npm run build`, `actions/upload-pages-artifact@v3` (path `dist`).
    - Job `deploy` (needs build): `actions/deploy-pages@v4`, environment `github-pages`.
  - **Release steps** (README section `Releasing a new version`):
    1. Bump `version` in `package.json` and `release.json`.
    2. Write the one-sentence `whatsNew`.
    3. Merge to `main` only after the owner approves the plain-language summary.
    4. To roll back: revert the merge commit on `main`.
  - **README** sections:
    - What Masterpiece is (2 lines).
    - Install on Android: Chrome → ⋮ → *Install app*.
    - Install on a laptop: the Chrome/Edge address-bar install icon.
    - Moving data between devices: export, send the file, import.
    - Backups and passwords: a forgotten password cannot be recovered.
    - Handover file for your relief.
    - Development: `npm i`, `npm run dev`, `npm test`, `npm run test:e2e`.

- [ ] **Step 1: Run the whole suite.** Run: `npm run typecheck && npm test && npm run test:e2e`. Expected: all pass. Fix any failures before continuing.
- [ ] **Step 2: Check the build output uses relative paths.** Run: `npm run build && grep -q '"start_url":"."' dist/manifest.webmanifest && test -f dist/sw.js && ! grep -q 'src="/' dist/index.html && echo OK`. Expected: `OK`.
- [ ] **Step 3: Write `deploy.yml` and `README.md`.**
- [ ] **Step 4: Validate the workflow YAML.** Run: `node -e "require('fs').readFileSync('.github/workflows/deploy.yml','utf8').includes('deploy-pages') || process.exit(1)"`. Expected: exit 0. A real deploy is verified once the GitHub repo is connected, and is out of scope here.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "chore: GitHub Pages deploy workflow and README"`

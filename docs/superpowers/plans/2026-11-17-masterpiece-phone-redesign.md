# Phone Redesign (Piece 7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** one coherent, token-based look across the whole app on the phone, with four themes (Day, Dark, Night red, High contrast), Night red switching on automatically by ship's time, a Today Home, the bottom bar Home · Ship · Forms · Budget · More with a Ship hub, and one complete Due screen.

**Architecture:**
- **Tokens:** one set of CSS custom properties at the top of `src/ui/theme.css`, with one block per theme. Every rule in `theme.css`, `print.css` and the piece CSS files uses only the tokens. The piece CSS files stay lazy with their chunks.
- **Themes:** the stored base theme plus a pure scheduling module (`src/ui/themeSchedule.ts`) give the effective theme. `AppState` puts it on `<html data-theme>` and `meta theme-color`, and mirrors what the inline script in `index.html` needs to paint the right theme first.
- **Shell:** a new header (ship pill, clock, theme button), the new bottom bar, a Ship hub at `/ship`, More at `/more`, and a lazy Due screen at `/due`. The `ShipNav` chip row is removed.
- **Home and hub:** both read the ship's records once through one hook, `useShipRecords`, and turn them into text with pure view functions.

**Tech Stack:** Preact 11, TypeScript, Vite 8, Dexie 4, Vitest, Playwright 1.63 (preinstalled; never run `playwright install`). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-17-masterpiece-phone-redesign-design.md`. It is binding. §12 (the designer's calls the user accepted) wins over anything earlier in the spec that it changes. The approved mockups are in the session scratchpad, at `mockups/Main.dc.html`, `HomeNight.dc.html`, `ShipHub.dc.html` and `ShipNight.dc.html`. Their inline styles are the visual reference for anything this plan and the spec leave open (§12.11). Two things in the mockups are overruled by §12.9: they have a search button, which is not built, and the hub mockup has no theme button, which the hub does get. The phone review is at `.superpowers/app-review-2026-11-17.md`.

## Global Constraints

- All of `.superpowers/sdd/2026-10-25-masterpiece-base/global-constraints.md` still applies, except where the spec changes the visual style (fonts and logo geometry stay).
- **Phone only:** 360–412 px wide. No horizontal page scroll at 360 px on any screen (`expectNoHorizontalScroll`).
- **Startup bytes:** gzip (node zlib, default level) of the entry script plus every `modulepreload` in `dist/index.html`, and of the stylesheet links.
  - The baseline, main d10e002, is **108,386 B JS and 6,030 B CSS**.
  - The limit is **110,386 B JS** (+2.0 kB) and **9,030 B CSS** (+3.0 kB).
  - Measure it with the command below after `npm run build`. Every task that touches `src/` reports both numbers.

  ```bash
  node -e "const fs=require('fs'),z=require('zlib');const h=fs.readFileSync('dist/index.html','utf8');const g=f=>z.gzipSync(fs.readFileSync('dist/'+f)).length;const js=[...h.matchAll(/<script type=\"module\"[^>]*src=\"\.\/([^\"]+)\"|<link rel=\"modulepreload\"[^>]*href=\"\.\/([^\"]+)\"/g)].map(m=>m[1]||m[2]);const css=[...h.matchAll(/<link rel=\"stylesheet\"[^>]*href=\"\.\/([^\"]+)\"/g)].map(m=>m[1]);console.log('js',js.reduce((s,f)=>s+g(f),0),'css',css.reduce((s,f)=>s+g(f),0))"
  ```
- **Lazy chunks stay lazy.**
  - Home, the hub and the header must not pull in the budget, survey, forms-engine, library or tools chunks. Use type-only imports of their types, as `src/domain/types.ts` does.
  - Budget alerts keep loading on demand, as today.
  - The Due screen (with today's Expiring list) is a lazy chunk of its own.
- **Data:**
  - No Dexie schema version change.
  - New settings fields have defaults and are read through `normaliseSettings`.
  - Theme settings are device-local. They stay out of backups, snapshots and handovers, as `theme` does today.
  - No change to calculations, stored record shapes or file formats.
- **Tokens (exact names and values):**
  - Spec §6: type, spacing, radius, target and palette, copied into Task 1.
  - Dark and High contrast keep today's values and gain the semantic tokens (§12.7).
  - After Task 8, no rule outside the token blocks names a colour, font size or radius directly.
- **Status is never colour alone:**
  - overdue is a filled pill;
  - due soon is an outlined pill;
  - valid is a ✓ and a word;
  - every chip carries words ("5 d over", "in 14 d").
- **Night red:** nothing bright, white or blue anywhere, as far as CSS can reach (spec §5).
- **Targets and type:**
  - Every tappable control is at least 44 px; list rows and tiles are 48 px or more (`--target: 48px`).
  - Inputs are 16 px or more, everywhere.
- **Print** stays black on white whatever the theme. `print.css` wins.
- **No function lost.** Every route in `ROUTES` today still opens the same screen. `/ship/expiring` opens Due on the *Before next port* view.
- **Tests:**
  - Existing e2e tests that assert nav labels, chips or routes are rewritten to the new shell, never deleted without a replacement.
  - Fixtures are made up. Names such as `MV OCEAN STAR`, `R. EXAMPLE` and `J. SAMPLE` are fine. No real ship, company or crew data, anywhere.
- **Screenshots** at 360 px in all four themes go to the session scratchpad (`SCREENSHOT_DIR`). They are never committed.
- **UI copy (exact, English):**
  - theme labels: `Day`, `Dark`, `Night red`, `High contrast`;
  - `Night red automatically`, `From`, `To`;
  - Home: `Due`, `See all N`, `✓ Nothing due`, `Voyage V-112` (overline), `No voyage`, `Start voyage`, `ETA in`, `On board`, `Next clock change: −1 h`;
  - Due views: `All due`, `Before next port`;
  - Due groups: `Overdue`, `Due soon`;
  - chips: `in N d`, `today`, `N d over`;
  - hub tile names: `Crew`, `Crew documents`, `Certificates`, `Contracts & reliefs`, `Voyage`, `Ship's time`, `Draft survey`, `Particulars`;
  - More rows: `Tools`, `Library`, `Profiles`, `Settings`, `Backup and restore`, `App lock`;
  - bottom bar: `Home`, `Ship`, `Forms`, `Budget`, `More`.
- **Commands:**
  - `npx vitest run <files>`;
  - `npm run typecheck`;
  - `npx playwright test <specs> --trace off`;
  - `npm run build`.
  A task is done only when the full `npx vitest run` and `npm run typecheck` pass, and its listed e2e specs pass.

## Review Focus

1. **Night red leaks.** The places to check:
   - native controls: select popups and `<option>`, the date and time picker indicator, checkbox and radio, autofill backgrounds;
   - `::selection`, the caret and the Android tap highlight;
   - focus rings;
   - dialogs and `::backdrop`, toasts and banners;
   - charts, the library's PDF canvas, images and the search highlight;
   - the logo on the lock screen and first run;
   - `meta theme-color` and the manifest.

   Expected: in Night red every painted colour is black or a red, PDF pages and images are filtered, and the status bar is #000000. This is pinned by `expectRedOnly` (Task 1 helper), which is called on the screens each task touches (Tasks 1, 3–8), and by the `meta theme-color` test (Task 1).
2. **The theme boundary.** The cases to check:
   - a window that crosses midnight (23:59 → 00:00 stays red);
   - exactly at From (red) and at To (not red);
   - From equal to To (never red);
   - an override made at 05:59 ends at 06:00 that morning, not a day later;
   - a clock change that jumps ship's time across a boundary, forward or back;
   - an app reopened days later with an old override.

   Expected: the effective theme always equals the rule in §12.5 for the ship's time now. This is pinned in Task 2 (unit table plus e2e with `page.clock`).
3. **Old routes still open.**
   - Every path in today's `ROUTES` (crew, certificate and survey ids, `/ship/particulars`, `/budget/add` from the manifest shortcut) opens its screen.
   - `/ship/expiring` replaces itself with `/due/port`, so Back does not bounce.
   - The right tab is lit on every route.

   This is pinned in Task 3 (redirect) and Task 4 (`activeTab` over every route, plus e2e).
4. **First paint from a stale or broken mirror.** The cases to check:
   - localStorage blocked;
   - a legacy `'night'` value;
   - corrupt `mp-night` JSON;
   - a mirror saved before a clock change;
   - after "Erase everything".

   Expected: it never throws, and at worst one wrong frame. This is pinned in Task 2 (script parity test with broken inputs, e2e with app JS blocked at night).
5. **Home and hub on thin or odd data.** The cases to check:
   - no voyage;
   - a voyage with no ETA or no ports;
   - an ETA in the past;
   - an ETA in another offset than the ship's;
   - no crew, no surveys;
   - long names at 360 px;
   - switching ship while Home is open.

   Expected: one plain line for each missing thing, never `NaN`, `undefined` or an empty chip, and the old ship's numbers never shown under the new ship's name. This is pinned in Task 5 (unit tests of the view functions, plus e2e).

---

## File Structure

- **Tokens and themes:**
  - `src/ui/theme.css`: the token blocks, then the component layers.
  - `src/ui/print.css`: print on the new tokens.
  - `src/ui/theme.ts`: theme list, labels, cycle, `BAR_BG`, `applyTheme`, `mirrorTheme`, `logoMode`, `readTheme`.
  - `src/ui/themeSchedule.ts` (new, pure): the night window, boundaries, override, the effective theme, the button label, the mirror.
  - `src/ui/tokens.test.ts` (new): the CSS hygiene tests.
- **Settings and state:**
  - `src/domain/types.ts`: `Theme`, `Settings` fields.
  - `src/db/settings.ts`: `normaliseSettings`, defaults.
  - `src/app/AppState.tsx`: `theme` (effective) and `shipNow`, override expiry, the focus re-check.
  - `src/app/main.tsx`, `src/app/eraseDevice.ts`, `index.html`, `vite.config.ts` (manifest).
- **Due:**
  - `src/domain/alerts.ts`: structured fields.
  - `src/ui/dueView.ts` (new, pure).
  - `src/ui/components/DueRow.tsx` (new).
  - `src/ui/screens/Due.tsx` (new, lazy), which takes over `Expiring.tsx`; `Expiring.tsx` is removed.
  - `src/app/router.ts`: new routes and `redirectFor`.
- **Shell:**
  - `src/ui/components/Header.tsx`, `ShipSwitcher.tsx` (new), `Nav.tsx` (`ShipNav` removed, `activeTab` added), `SectionBar.tsx` (new).
  - `src/ui/screens/ShipHub.tsx` (new), `More.tsx` (new).
  - `src/ui/icons.tsx` (new): inline 24 px outline icons, 1.75 stroke, taken from the mockups.
  - `src/app/App.tsx`.
- **Home and hub data:**
  - `src/ui/useShipRecords.ts` (new).
  - `src/ui/overviewView.ts` (new, pure): the voyage card, ETA, shift text, hub statuses, particulars completeness.
  - `src/ui/screens/Home.tsx`, `src/ui/homeView.ts`.
- **Tests:**
  - `e2e/helpers.ts`: `expectRedOnly`, `expectTargets`, `expectInputFonts`, `openShipSection`, `setTheme`.
  - `e2e/screenshots.spec.ts` (new; runs only when `SCREENSHOT_DIR` is set).
  - `e2e/theme.spec.ts` (new), `e2e/due.spec.ts` (new), `e2e/nav.spec.ts` (new).
  - Updates to the existing specs.

---

### Task 1: Tokens and the four themes

**Files:**
- Modify: `src/ui/theme.css` (lines 1–150: the theme blocks and the base), `src/ui/print.css`, `src/ui/theme.ts`, `src/domain/types.ts:281-283`, `src/db/settings.ts`, `src/app/AppState.tsx`, `src/main.tsx`, `index.html`, `vite.config.ts`, `src/ui/components/LogoMark.tsx`, `src/ui/screens/{LockScreen,FirstShip,ProtectApp}.tsx`, `src/ui/components/Header.tsx` (the icon for the new themes only)
- Test: `src/ui/theme.test.ts`, `src/ui/tokens.test.ts` (new), `src/db/settings.test.ts`, `src/ui/components/LogoMark.test.ts`, `e2e/shell.spec.ts`, `e2e/helpers.ts`, `e2e/screenshots.spec.ts` (new)
- Update the tests that store `theme: 'night'` (`src/db/settings.test.ts`, `snapshots.test.ts`, `migrationV*.test.ts` where typed) to `'dark'`.

**Interfaces:**
- Produces:
  ```ts
  // domain/types.ts
  export type Theme = 'day' | 'dark' | 'red' | 'contrast';
  // ui/theme.ts
  export const THEME_STORAGE_KEY = 'mp-theme';            // the base theme, as today
  export const NIGHT_STORAGE_KEY = 'mp-night';            // Task 2 fills it
  export const THEMES: readonly Theme[];                  // ['day', 'dark', 'red', 'contrast'], the button's order
  export const THEME_LABELS: Record<Theme, string>;       // Day, Dark, Night red, High contrast
  export const BAR_BG: Record<Theme, string>;             // day '#0B2545', dark '#0E1B2B', red '#000000', contrast '#000000'
  export function nextTheme(theme: Theme): Theme;
  export function readTheme(value: unknown): Theme;       // 'night' → 'dark'; anything unknown → 'day'
  export function applyTheme(theme: Theme): void;         // <html data-theme>, and meta[name=theme-color] = BAR_BG[theme]
  export function mirrorTheme(base: Theme, night: string | null): void;  // localStorage, wrapped in try/catch; null removes mp-night
  export function logoMode(theme: Theme): 'day' | 'night' | 'red';
  // db/settings.ts
  export function normaliseSettings(raw: Settings): Settings;  // theme via readTheme; Task 2 adds the night defaults
  // LogoMark: mode 'red' = the MonoLogo geometry in currentColor, with role="img" and aria-label="Masterpiece logo"
  ```
  For Task 1, `AppState` calls `applyTheme(settings.theme)` and `mirrorTheme(settings.theme, null)`. Task 2 replaces those calls with the effective theme.
- CSS tokens, used by every later task:
  - type: `--fs-display/--lh-display` (36/40), `--fs-figure/--lh-figure` (28/32), `--fs-title` (22/28), `--fs-heading` (18/24), `--fs-body` (16/24), `--fs-label` (14/20), `--fs-caption` (12/16);
  - weights: `--fw-regular` 400, `--fw-medium` 500, `--fw-strong` 600 (High contrast raises regular and medium to 600, as today);
  - spacing: `--sp-1` … `--sp-7` (4, 8, 12, 16, 24, 32, 48);
  - radius: `--r-sm` 8, `--r-md` 12, `--r-lg` 20, `--r-pill` 999;
  - `--target: 48px` in every theme;
  - per theme: `--surface-0/1/2`, `--line`, `--text`, `--text-muted`, `--bar-bg`, `--bar-text`, `--bar-muted`, `--bar-line`, `--nav-bg`, `--nav-text`, `--nav-active`, `--nav-pill`, `--accent`, `--on-accent`, `--ok`, `--ok-bg`, `--warn`, `--warn-bg`, `--danger`, `--danger-bg`, `--on-danger`, `--focus`, `--mark-bg`, `--mark-text`, `--chart-1` … `--chart-5`, `--media-filter`, `--picker-filter`, `--shadow-2`.

**Token values** (the spec §6 table; Dark and High contrast per §12.7; the bar and nav values come from the mockups):

| Token | Day | Dark (today's navy) | Night red | High contrast (today's) |
|---|---|---|---|---|
| surface-0 / 1 / 2 | #FFFFFF / #F3F6FA / #E8EEF5 | #0B1622 / #12243A / #18283A | #000000 / #120000 / #1E0303 | #FFFFFF / #FFFFFF / #FFFFFF |
| line | #D5DEE8 | #1E3550 | #3A0A0A | #000000 |
| text / text-muted | #0B1622 / #4A6380 | #E6EDF5 / #9FB3C8 | #E04A3A / #D04030 | #000000 / #000000 |
| bar-bg / bar-text / bar-muted / bar-line | #0B2545 / #FFFFFF / #C9D6E5 / #3B5878 | #0E1B2B / #E6EDF5 / #9FB3C8 / color-mix(18% bar-text) | #000000 / #E04A3A / #D04030 / #3A0A0A | #000000 / #FFFFFF / #E6E6E6 / #FFFFFF |
| nav-bg / nav-text / nav-active / nav-pill | #FFFFFF / #4A6380 / #1D5FD1 / #E3ECFB | #0E1B2B / #9FB3C8 / #5FD4CE / color-mix(18% #5FD4CE) | #000000 / #D04030 / #FF5A45 / #2A0505 | #000000 / #E6E6E6 / #FFFFFF / transparent (underline, as today) |
| accent / on-accent | #1D5FD1 / #FFFFFF | #5FD4CE / #04211F | #C8372A / #000000 | #000000 / #FFFFFF |
| ok / ok-bg | #1E7A46 / #E3F4EA | #5CCB8A / #12301F | #D04030 / transparent | #000000 / #FFFFFF |
| warn / warn-bg | #8A5A00 / #FFF1D1 | #F2B33D / #3A2A08 | #E04A3A / #120000 | #000000 / #FFFFFF |
| danger / danger-bg / on-danger | #B3261E / #FDE7E5 / #FFFFFF | #FF6B5E / #3D1210 / #1A0503 | #FF5A45 / #4A0606 / #000000 | #C81E1E / #FFFFFF / #FFFFFF |
| focus | #1D5FD1 | #7AB8FF | #FF5A45 | #000000 (white on the bars) |
| mark-bg / mark-text | #FFD54A / #000000 | #FFD54A / #000000 | #4A0606 / #FF5A45 | #FFD54A / #000000 |
| chart-1…5 | #1D5FD1 #0F8B8D #8A5A00 #7B4FC9 #5E6B7A | #4FB8D6 #5CCB8A #F2B33D #B79CFF #9FB3C8 | all #E04A3A | all #000000 |
| media-filter | none | none | a filter chain that renders white as black and black as red (the builder tunes it against a screenshot) | none |
| picker-filter | none | none (the dark `color-scheme` draws it light) | a filter that tints the picker icon red | none |
| shadow-2 | 0 -2px 12px rgb(0 0 0 / .12) | same | none | none |

- [ ] **Step 1: Write the failing tests**
  - `theme.test.ts`:
    - `THEMES` is `['day','dark','red','contrast']` with labels `['Day','Dark','Night red','High contrast']`;
    - `nextTheme` cycles day→dark→red→contrast→day;
    - `readTheme('night') === 'dark'`, and `readTheme('purple') === 'day'`;
    - `logoMode`: day→'day', dark→'night', red→'red', contrast→'day';
    - `BAR_BG.red === '#000000'`;
    - the index.html script accepts `'day'`, `'dark'`, `'red'`, `'contrast'`, maps `'night'` to `'dark'`, and sets `meta[name=theme-color]`. Run the script with a stub `document` and `localStorage`, using `new Function`.
  - `tokens.test.ts`:
    - parse every `:root[data-theme='x']` block of `theme.css`;
    - the four blocks define exactly the same set of custom properties;
    - each per-theme token in the table above has the table's value;
    - no theme block contains a value whose hue is blue or green in the `red` block. Use `isRedOrBlack(hex)`, which is true when the colour is near black (each channel ≤ 0x20) or when g ≤ 0.45·r and b ≤ 0.45·r.
  - `settings.test.ts`:
    - a stored `{ theme: 'night' }` reads back from `getSettings` as `'dark'`;
    - `updateSettings` keeps it `'dark'`.
  - `LogoMark.test.ts`: mode `'red'` renders an svg with `role="img"`, `aria-label="Masterpiece logo"`, `stroke="currentColor"`, and no gradient or fill colour.
  - `e2e/shell.spec.ts`, theme tests rewritten:
    - the button cycles Day → Dark → Night red → High contrast → Day;
    - Dark body is `rgb(11, 22, 34)` on `rgb(230, 237, 245)`, as today;
    - Night red body is `rgb(0, 0, 0)` on `rgb(224, 74, 58)`;
    - `meta[name=theme-color]` is `#000000` in Night red and `#0B2545` in Day;
    - print is black on white in Night red;
    - the Settings select lists the four labels;
    - a legacy mirror `mp-theme = 'night'` paints Dark with the app JS blocked.
  - `e2e/helpers.ts`:
    - `expectRedOnly(page)` walks `html`, `body` and every element under them. It reads the computed `color`, `background-color`, the four border colours, `outline-color`, `fill`, `stroke`, `caret-color`, `accent-color` and `text-decoration-color`. It fails on any non-transparent value that is not `isRedOrBlack`. It also fails on any `canvas` or `img` whose computed `filter` is `none`.
    - `setTheme(page, theme)` picks it in the Settings select.
  - Call `expectRedOnly` in Night red on Home, Settings and the crew edit form (date inputs).
- [ ] **Step 2: Run the tests to verify they fail**

  Run: `npx vitest run src/ui src/db/settings.test.ts && npx playwright test e2e/shell.spec.ts --trace off`

  Expected: FAIL on the new theme names and tokens.
- [ ] **Step 3: Implement**
  - Write the four token blocks and the scale tokens at the top of `theme.css`.
  - Keep today's variable names for now as aliases defined from the new tokens (`--bg: var(--surface-0)`, `--surface: var(--surface-1)`, `--muted: var(--text-muted)`, `--amber: var(--warn)`, `--red: var(--danger)`, `--on-red: var(--on-danger)`, `--radius: var(--r-md)`, and so on), so the rest of the file keeps working. Task 8 removes the aliases.
  - Base rules, all on tokens:
    - `color-scheme` (light; dark for Dark and Night red);
    - `accent-color: var(--accent)` on `:root`;
    - `:focus-visible` uses `--focus`;
    - `::selection` uses `--accent` / `--on-accent`;
    - `caret-color: var(--text)`;
    - `-webkit-tap-highlight-color: transparent`;
    - `scrollbar-color: var(--line) var(--surface-0)`;
    - `::-webkit-calendar-picker-indicator { filter: var(--picker-filter) }`, with a red-tinting filter in Night red;
    - `input:-webkit-autofill` with `-webkit-text-fill-color: var(--text)` and `box-shadow: 0 0 0 1000px var(--surface-1) inset`;
    - `dialog::backdrop` from tokens.
  - `print.css` sets the new tokens (and, until Task 8, the old names) to black on white.
  - In `index.html`:
    - move `<meta name="theme-color">` above the script;
    - the script maps `'night'` to `'dark'`, accepts the four names and sets the meta from the same four `BAR_BG` values.
  - `main.tsx`: on success it no longer applies the stored theme (`AppState` does that in its layout effect). On failure it applies `'day'`, as today.
  - The manifest's `theme_color` and `background_color` become `#000000` (§12.10).
  - `LockScreen`, `FirstShip` and `ProtectApp` take the logo mode from the theme on `<html>` (`AppState.theme` once Task 2 lands; until then, `settings.theme`).
- [ ] **Step 4: Run the tests to verify they pass**

  Run: `npx vitest run && npm run typecheck && npx playwright test e2e/shell.spec.ts e2e/lock.spec.ts --trace off`

  Expected: PASS.
- [ ] **Step 5: Add `e2e/screenshots.spec.ts`**
  - It is skipped unless `process.env.SCREENSHOT_DIR` is set.
  - It sets up a made-up ship (crew, an expired passport, a certificate due in 14 days, a voyage with an ETA).
  - It captures each main screen at 360×780 in each theme to `${SCREENSHOT_DIR}/<screen>-<theme>.png`.
  - Its screen list is an array that later tasks extend.

  Run: `SCREENSHOT_DIR=<scratchpad>/shots npx playwright test e2e/screenshots.spec.ts --project=android --trace off`

  Expected: PNGs written, and nothing added to git.
- [ ] **Step 6: Measure startup bytes** (command in Global Constraints) and record them in the report.
- [ ] **Step 7: Commit** with the message `Add design tokens and the Dark, Night red and High contrast themes`

### Task 2: Automatic night and the theme settings

**Files:**
- Create: `src/ui/themeSchedule.ts`, `src/ui/themeSchedule.test.ts`, `e2e/theme.spec.ts`
- Modify: `src/domain/types.ts` (`Settings`), `src/db/settings.ts`, `src/app/AppState.tsx`, `src/ui/theme.ts`, `index.html`, `src/app/eraseDevice.ts`, `src/ui/components/Header.tsx` (the button only), `src/ui/screens/Settings.tsx` (`ThemeSection`), `src/ui/screens/{LockScreen,FirstShip,ProtectApp}.tsx` (the logo mode comes from `AppState.theme`)
- Test: `src/db/settings.test.ts`, `src/app/eraseDevice.test.ts`, `src/ui/theme.test.ts`

**Interfaces:**
- Consumes: Task 1's `Theme`, `nextTheme`, `applyTheme`, `mirrorTheme`, `NIGHT_STORAGE_KEY`, `readTheme`.
- Produces:
  ```ts
  // Settings gains (§12.5): theme stays the base theme.
  nightAuto: boolean;             // default false
  nightFrom: string;              // 'HH:MM', ship's time, default '18:00'
  nightTo: string;                // default '06:00'
  themeOverride?: { theme: Theme; until: string };   // until = ship-local 'YYYY-MM-DDTHH:mm' of the boundary it ends at

  // ui/themeSchedule.ts (pure; ship-local times are strings, so a clock change needs no special case)
  export type ThemeSettings = Pick<Settings, 'theme' | 'nightAuto' | 'nightFrom' | 'nightTo' | 'themeOverride'>;
  export function inNightWindow(hhmm: string, from: string, to: string): boolean;   // [from, to), may cross midnight; from === to → never
  export function nextBoundary(shipNow: string, from: string, to: string): string | undefined;  // next ship-local time inside-ness flips
  export function overrideActive(s: ThemeSettings, shipNow: string): boolean;        // nightAuto && override && shipNow < override.until
  export function effectiveTheme(s: ThemeSettings, shipNow: string): Theme;          // override if active, else red inside window when auto, else base
  export function themeTap(s: ThemeSettings, shipNow: string): Partial<Settings>;    // auto off: { theme: nextTheme(theme) }; auto on: { themeOverride: { theme: nextTheme(effective), until: nextBoundary } }
  export function themeButtonLabel(s: ThemeSettings, shipNow: string): string;       // auto off: 'Theme: Day'; auto on, no active override: 'Theme: Night red, automatic'; override active: 'Theme: Dark, until 06:00'
  export function nightMirror(s: ThemeSettings, offsetMinutes: number): string | null; // JSON {from,to,offset,override?,until?} when nightAuto, else null
  export const NIGHT_TIMES: readonly string[];  // '00:00' … '23:45', every 15 min, for the From/To selects
  // AppState gains:
  theme: Theme;      // the effective theme
  shipNow: string;   // toShipLocal(nowUtc, offsetMinutes).dateTime
  ```

**Behaviour:**
- **Effective theme:** `AppState` computes it from `settings` and `shipNow`. In its layout effect it calls `applyTheme(theme)` and `mirrorTheme(settings.theme, nightMirror(settings, offsetMinutes))`.
- **Expired override:** when `settings.themeOverride` exists and is not active, `AppState` writes `{ themeOverride: undefined }` once, through `updateSettings`.
- **Re-checks:**
  - `useNow` keeps its 30 s tick aligned to the wall clock, which already lands on every minute boundary, and its `visibilitychange` catch-up.
  - Add `focus` and `pageshow` listeners that do the same catch-up.
  - `nowUtc` already moves when the clock changes are written, which covers "when ship's time changes".
- **Header button:** writes `themeTap(...)`. Its `aria-label` is `themeButtonLabel(...)`, and its icon shows the effective theme. A small "A" mark (`aria-hidden`) shows while `nightAuto` is on and no override is active.
- **Settings, Display section:**
  - the Theme select (four labels, writes `{ theme, themeOverride: undefined }`);
  - a checkbox `Night red automatically`;
  - `From` and `To` selects of `NIGHT_TIMES`, shown while the checkbox is on, labelled "in ship's time". They are selects rather than `type="time"`, so no native time picker opens at night.
  - From equal to To shows the field error `From and To must differ.` and is not saved.
  - Any change to the checkbox or the times also clears `themeOverride`.
  - Helper text: `Between From and To in ship's time the app is Night red. The button at the top of every screen changes the theme until the next switch. Printing is always black on white.`
- **`index.html` script:**
  - reads `mp-theme` (the base theme) and `mp-night`;
  - when `mp-night` parses, works out the ship-local time from `Date.now()` and `offset`, then applies the override (until `until`) or the window;
  - every read is inside `try`;
  - the script stays under about 900 characters.
- **Normalising:** `normaliseSettings` fills missing night fields with the defaults. It drops an invalid `themeOverride` (unknown theme, or an `until` that is not a valid ship-local date-time) and an invalid `nightFrom` or `nightTo` (replaced by the defaults).
- **Erasing the device:** `eraseDevice` also removes `mp-night`.

- [ ] **Step 1: Write the failing unit tests** (`themeSchedule.test.ts`)
  - `inNightWindow`, as a table for 18:00–06:00:
    - `17:59` false, `18:00` true, `23:59` true, `00:00` true, `05:59` true, `06:00` false;
    - 06:00–18:00 (not crossing): `12:00` true, `18:00` false;
    - `('12:00','09:00','09:00')` false.
  - `nextBoundary`:
    - `('2026-11-17T05:59','18:00','06:00')` → `'2026-11-17T06:00'`;
    - `('2026-11-17T06:00', …)` → `'2026-11-17T18:00'`;
    - `('2026-11-17T23:30', …)` → `'2026-11-18T06:00'`;
    - `('2026-12-31T19:00', …)` → `'2027-01-01T06:00'`;
    - from === to → `undefined`.
  - `effectiveTheme`:
    - auto off → base, at any time;
    - auto on inside the window → `'red'`;
    - outside → base;
    - an override with `until` in the future wins;
    - an override at or past `until` is ignored;
    - an override with auto off is ignored.
  - `themeTap`:
    - auto off, base `'day'` → `{ theme: 'dark' }`;
    - auto on at `2026-11-17T05:59` inside the window (effective red) → `{ themeOverride: { theme: 'contrast', until: '2026-11-17T06:00' } }`.
  - Clock change: with an override until `06:00`, ship's time jumping from `05:30` to `06:30` makes the override inactive and the theme the base; from `06:30` back to `05:30`, with no override, the theme is `'red'`.
  - `themeButtonLabel`: the three forms above, exactly.
  - `nightMirror`: null when auto is off; the JSON round-trips.
  - The parity test (in `theme.test.ts`): for a table of (stored settings, offset, `Date.now()`), the inline script run with stubs sets the same `data-theme` as `effectiveTheme`. Add rows for corrupt JSON, a missing `offset`, a `'night'` base, and `localStorage` throwing. Those rows set the base theme or nothing, and never throw.
  - `settings.test.ts`: an old record without the night fields reads back with `false`, `'18:00'` and `'06:00'`; a bad override is dropped.
  - `eraseDevice.test.ts`: `mp-night` is removed.
- [ ] **Step 2: Write the failing e2e tests** (`e2e/theme.spec.ts`)
  - **Auto on:**
    - Ship at UTC+03:00, clock installed at `17:59` ship's time. Turn on `Night red automatically` (18:00–06:00); the theme is still Day.
    - Run the clock 60 s: `data-theme` is `red`, the button reads `Theme: Night red, automatic`, and `expectRedOnly` passes on Home.
  - **Override:**
    - At `05:58` in the window, tap the button: Night red → High contrast, labelled `Theme: High contrast, until 06:00`.
    - Run to `06:00`: the theme is the base (Day), the button reads `Theme: Day, automatic`, and the stored settings have no `themeOverride`.
  - **Clock change:** schedule a +1 h clock change at `17:30` ship's time with auto on at `17:20`, and run the clock past it: `data-theme` is `red`, because ship's time is now 18:30+.
  - **First paint:** with auto on at `19:00`, block `**/assets/*.js` and reload: `<html data-theme="red">` and `meta[name=theme-color]` is `#000000` before any app script.
  - **Auto off:** a tap changes the base theme and survives a reload, as today.
  - **Validation:** setting From = To shows `From and To must differ.`
  - `expectNoHorizontalScroll` on Settings.
- [ ] **Step 3: Run the tests to verify they fail**

  Run: `npx vitest run src/ui src/db src/app && npx playwright test e2e/theme.spec.ts --trace off`

  Expected: FAIL.
- [ ] **Step 4: Implement** as above.
- [ ] **Step 5: Run the tests to verify they pass**

  Run: `npx vitest run && npm run typecheck && npx playwright test e2e/theme.spec.ts e2e/shell.spec.ts e2e/lock.spec.ts --trace off`

  Expected: PASS. Then measure startup bytes.
- [ ] **Step 6: Commit** with the message `Switch to Night red automatically by ship's time`

### Task 3: Alert dates and the Due screen

**Files:**
- Create: `src/ui/dueView.ts`, `src/ui/dueView.test.ts`, `src/ui/components/DueRow.tsx`, `src/ui/screens/Due.tsx`, `e2e/due.spec.ts`
- Modify: `src/domain/alerts.ts`, `src/domain/alerts.test.ts`, `src/app/router.ts`, `src/app/router.test.ts`, `src/app/App.tsx`, `src/ui/theme.css` (the Due section, on tokens)
- Delete: `src/ui/screens/Expiring.tsx`. Its list moves into `Due.tsx` unchanged in logic, with `expiringBefore` and `expiringWindow`.
- Update: `e2e/crewDocs.spec.ts` and `e2e/home.spec.ts` where they open Expiring.

**Interfaces:**
- Produces:
  ```ts
  // domain/alerts.ts: Alert gains (title and detail unchanged, for print and the existing tests)
  due: string;                                   // the 'YYYY-MM-DD' the detail names
  what: string;                                  // 'Passport' | "Seaman's book" | docLabel(d) | 'Ship certificate' | 'Survey' | 'Contract end' | `${months}-month limit`
  person?: { rank: string; name: string };       // rankLabel(m); `${givenNames[0]}. ${surname}`, or surname alone when there are no given names
  reliefPlanned?: string;                        // contract alerts: m.reliefPlannedDate when set
  // ui/dueView.ts
  export function daysBetween(from: string, to: string): number;      // whole days, to − from
  export function dueChipText(due: string, today: string): string;   // 'in 14 d' | 'today' | '5 d over'
  export function shortDate(iso: string, today: string): string;     // '12 Nov'; '12 Nov 2027' when the year differs
  export interface DueRowView { key: string; href: string; band: 'amber' | 'red'; title: string; meta: string; chip: string }
  export function dueRow(alert: Alert, today: string): DueRowView;
  export function groupDue(alerts: Alert[]): { overdue: Alert[]; soon: Alert[] };  // red / amber, order kept
  export const NOTHING_DUE = '✓ Nothing due';
  export const CREW_DOC_KINDS: readonly AlertKind[];  // ['crewDoc', 'crewCertificate']
  // components/DueRow.tsx
  export function DueRow({ row }: { row: DueRowView }): JSX.Element;   // the whole row is the link
  // screens/Due.tsx (lazy chunk)
  export function Due(): JSX.Element;   // reads the route: '/due' all, '/due/port' before next port, '/ship/crew-documents' crew documents
  // router.ts
  // ROUTES gains '/due', '/due/port', '/ship/crew-documents'
  export function redirectFor(path: string): string | undefined;   // '/ship/expiring' → '/due/port'
  // useRoute: on a redirect, location.replace('#' + target), so the old entry leaves the history
  ```
- **`dueRow` rules:**
  - With `person`, the title is `${what} · ${rank} ${name}`, and the meta is:
    - crew documents: `Expired 12 Nov` or `Expires 12 Dec`;
    - contracts: `Relief planned 5 Dec` or `Relief not planned`;
    - the onboard limit: `Reached 3 Nov` or `Reaches 3 Dec`.
  - Without `person` (certificates), the title is `alert.title` and the meta is `${what} · ${shortDate(due)}`.
  - The chip is `dueChipText`. The band picks the style: red is filled with `--danger`/`--on-danger` on a `--danger-bg` row; amber is outlined with `--warn` on a `--warn-bg` row. Night red draws warn rows as `--surface-1` with a `--line` border, as in the mockup.

**Due screen:**
- The heading is `Due`. Under it sits a segmented pair of links, `All due` (`#/due`) and `Before next port` (`#/due/port`), with `aria-current` on the one shown.
- **All due:**
  - `collectAlerts` for the active ship, under the headings `Overdue` and `Due soon`, as `DueRow`s;
  - `NOTHING_DUE` when there are none;
  - it prints, with rows as text and chips in words.
- **Before next port:** today's Expiring list and window text, unchanged in logic and restyled. Its list keeps `aria-label="Expiring"`.
- **Crew documents** (`/ship/crew-documents`):
  - heading `Crew documents`;
  - All due filtered to `CREW_DOC_KINDS`;
  - a link `Before next port` to `#/due/port`.

  This settles the spec's "Crew documents" builder's call: it is its own route, and a filtered view.
- The Ship chip `Expiring` now points to `#/due/port`. The chip row goes in Task 4.

- [ ] **Step 1: Write the failing unit tests**
  - `alerts.test.ts`:
    - every alert in the existing fixtures gets `due` equal to the date in its `detail`, and the right `what`;
    - a passport alert has `person: { rank: '2nd Officer', name: 'R. EXAMPLE' }`;
    - a contract alert with `reliefPlannedDate` carries it;
    - order and `title`/`detail` are unchanged (the existing assertions stay).
  - `dueView.test.ts`:
    - `dueChipText('2026-12-01','2026-11-17') === 'in 14 d'`, `('2026-11-17','2026-11-17') === 'today'`, `('2026-11-12','2026-11-17') === '5 d over'`;
    - across a month end and a year end;
    - `shortDate('2026-11-12','2026-11-17') === '12 Nov'`, `shortDate('2027-01-03','2026-11-17') === '3 Jan 2027'`;
    - `dueRow` for each kind gives the exact title and meta above;
    - `groupDue` keeps the order.
  - `router.test.ts`:
    - `matchRoute('#/due/port').path === '/due/port'`;
    - `redirectFor('/ship/expiring') === '/due/port'`, and undefined for every other path in `ROUTES`.
- [ ] **Step 2: Write the failing e2e tests** (`e2e/due.spec.ts`)
  - A ship certificate expiring in 14 days and an expired passport (made up) both appear on `#/due`: the passport under `Overdue` with chip `5 d over`, the certificate under `Due soon` with chip `in 14 d` and meta `Ship certificate · 1 Dec`.
  - `#/ship/expiring` lands on `#/due/port` with `Before next port` current, and `page.goBack()` returns to the screen before, not to the redirect.
  - `#/ship/crew-documents` lists the passport and not the certificate.
  - An empty ship shows `✓ Nothing due`.
  - Print emulation: black on white, and the rows show their words.
  - `expectRedOnly` in Night red, and `expectNoHorizontalScroll`.
  - The `crewDocs.spec.ts` expiring tests are moved onto `#/due/port` with the same assertions. The heading `Expiring before next port` becomes the `Before next port` view check.
- [ ] **Step 3: Run the tests to verify they fail**

  Run: `npx vitest run src/domain/alerts.test.ts src/ui/dueView.test.ts src/app/router.test.ts && npx playwright test e2e/due.spec.ts --trace off`

  Expected: FAIL.
- [ ] **Step 4: Implement.** Register `/due`, `/due/port` and `/ship/crew-documents` with `lazyScreen(() => import('../ui/screens/Due').then((m) => m.Due))`.
- [ ] **Step 5: Run the tests to verify they pass**

  Run: `npx vitest run && npm run typecheck && npx playwright test e2e/due.spec.ts e2e/crewDocs.spec.ts e2e/home.spec.ts --trace off`

  Expected: PASS. Measure startup bytes: the Expiring screen leaves the main chunk.
- [ ] **Step 6: Commit** with the message `Add the Due screen with every alert, ship certificates included`

### Task 4: Shell: header, ship switcher, bottom bar, Ship hub and More

**Files:**
- Create: `src/ui/icons.tsx`, `src/ui/components/ShipSwitcher.tsx`, `src/ui/components/SectionBar.tsx`, `src/ui/screens/ShipHub.tsx`, `src/ui/screens/More.tsx`, `src/ui/components/Nav.test.ts`, `e2e/nav.spec.ts`
- Modify: `src/ui/components/Header.tsx`, `src/ui/components/Nav.tsx` (remove `ShipNav` and `SHIP_LINKS`), `src/app/router.ts`, `src/app/App.tsx`, `src/ui/screens/Settings.tsx` (section ids and `?at=`), `index.html` (viewport meta), `src/ui/theme.css` (shell, hub, More and section bar; remove the `.ship-nav`/`.chips` rules that only the chip row used)
- Update the e2e specs that use the chip row or the old tabs: `shell`, `certificates`, `crew`, `crewDocs`, `profiles`, `reliefs`, `survey`, `voyageTime`, `backup`, `lock`, `crewImport`, `crewListPrint`, `forms`. Add `openShipSection` to `e2e/helpers.ts`.

**Interfaces:**
- Consumes: Task 2's `themeTap`/`themeButtonLabel`; Task 3's `/ship/crew-documents`.
- Produces:
  ```ts
  // router.ts: ROUTES gains '/ship' and '/more' (before the '/ship/...' patterns, which have more segments anyway)
  // Nav.tsx
  export type Tab = 'home' | 'ship' | 'forms' | 'budget' | 'more';
  export function activeTab(path: RoutePath): Tab | undefined;
  //   '/' and '/due*' → home; '/ship' and '/ship/*' → ship; '/forms*' → forms; '/budget*' → budget;
  //   '/more', '/tools*', '/library*', '/profiles', '/settings*' → more
  // ShipHub.tsx
  export const HUB_TILES: readonly { id: HubTile; name: string; href: string; icon: IconName }[];
  //   crew '#/ship/crew', crewDocuments '#/ship/crew-documents', certificates '#/ship/certificates',
  //   reliefs '#/ship/reliefs', voyage '#/ship/voyage', time '#/ship/time', survey '#/ship/survey', particulars '#/ship/particulars'
  export type HubTile = 'crew' | 'crewDocuments' | 'certificates' | 'reliefs' | 'voyage' | 'time' | 'survey' | 'particulars';
  export function ShipHub(): JSX.Element;   // Task 5 adds the status lines
  // SectionBar.tsx: shown by Shell on every '/ship/*' route except '/ship'
  export function sectionFor(path: RoutePath): string;   // the HUB_TILES name that owns the path ('/ship/crew/:id/documents/new' → 'Crew'; '/ship/survey/data' → 'Draft survey')
  // icons.tsx
  export type IconName = 'home' | 'ship' | 'forms' | 'budget' | 'more' | 'crew' | 'idCard' | 'certificate' | 'swap' | 'compass' | 'clock' | 'draft' | 'plus' | 'convert' | 'book' | 'chevron' | 'check' | 'sun' | 'moon' | 'contrast' | 'lock' | 'backup' | 'tools' | 'settings' | 'profiles';
  export function Icon({ name, size }: { name: IconName; size?: number }): JSX.Element;  // 24 px default, stroke 1.75, currentColor, aria-hidden
  ```

**Behaviour:**
- **Header** (56 px, spec §7 and §12.9):
  - the ship pill: a `button` with the ship's name and a chevron, `aria-haspopup="dialog"`;
  - the clock: `data-testid="ship-clock"`, Mono, `--fs-label`. It shows `12:00 LT`, with ` (UTC+03:00)` in a visually hidden span, so the zone is still read out and the existing `ship-clock` assertions keep passing;
  - the theme button (44 px; 48 in High contrast).
  - No logo, no `Masterpiece` title, no search.
  - The header pads by `env(safe-area-inset-top)`.
- **Ship switcher:**
  - a modal `<dialog>` bottom sheet (`--r-lg` top corners) with the heading `Switch ship`;
  - one button per ship; the active one has `aria-pressed="true"` and a ✓;
  - choosing a ship writes `activeShipId` (as Profiles' "Make active" does) and closes the sheet;
  - a `Manage ship profiles` link goes to `#/profiles`;
  - Escape and the backdrop close it, and focus returns to the pill.
- **Bottom bar:**
  - `<nav aria-label="Main">`, five links: Home `#/`, Ship `#/ship`, Forms `#/forms`, Budget `#/budget`, More `#/more`;
  - `aria-current="page"` from `activeTab`;
  - the active icon sits in a 56×28 `--nav-pill`; colours are `--nav-*`;
  - 64 px tall, plus `env(safe-area-inset-bottom)`.
- **Ship hub** (`/ship`):
  - `<h2>Ship</h2>`, then `<nav aria-label="Ship sections">` with a 2-column grid of the eight tiles;
  - each tile is an `<a>` with `aria-labelledby` pointing at its name and `aria-describedby` pointing at its status, so its accessible name is exactly the tile name;
  - min-height 112 px, `--surface-1`, `--r-md`;
  - an accent icon (on-accent in Night red, as drawn).
- **Section bar:** on Ship section screens, a 48 px row at the top of `main`, `<nav aria-label="Ship section">`, with a link `‹ Ship` to `#/ship` and the section name. No global back arrow.
- **More** (`/more`):
  - `<h2>More</h2>` and a list of 56 px rows with an icon, a name and a chevron: `Tools` `#/tools`, `Library` `#/library`, `Profiles` `#/profiles`, `Settings` `#/settings`, `Backup and restore` `#/settings?at=backup`, `App lock` `#/settings?at=lock`;
  - Settings gives its sections the ids `settings-backup`, `settings-lock` and `settings-display`. On open with `?at=<x>` it scrolls that section into view and focuses its heading (`tabIndex=-1`).
- **Viewport meta:** `width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content`. `.page` pads by `env(safe-area-inset-left/right)`.

- [ ] **Step 1: Write the failing unit tests**
  - `Nav.test.ts`:
    - `activeTab` for every `RoutePath` in `ROUTES`: each gets the tab above, and none is `undefined`, so a test fails when a route is added without a tab;
    - `sectionFor` for every `/ship/*` route returns one of the `HUB_TILES` names.
  - `router.test.ts`: `matchRoute('#/ship').path === '/ship'`, `matchRoute('#/more').path === '/more'`, and `matchRoute('#/settings?at=lock').path === '/settings'`.
- [ ] **Step 2: Write the failing e2e tests** (`e2e/nav.spec.ts`; the `shell.spec.ts` navigation test is replaced by it)
  - The Main nav has the links `['Home','Ship','Forms','Budget','More']`.
  - Ship opens `#/ship`, with eight tiles named exactly as in Global Constraints.
  - Each tile opens its screen (heading check), shows `‹ Ship`, keeps the Ship tab lit, and `‹ Ship` returns to the hub.
  - More lists its six rows. Each opens its screen with the More tab lit; `App lock` scrolls to the `App lock` heading.
  - The ship pill opens `Switch ship`; choosing a second made-up ship changes the banner text; `Manage ship profiles` opens Profiles.
  - Old routes open: `#/ship/particulars`, `#/ship/crew/new`, `#/budget/add`, `#/tools`, `#/library`, `#/profiles`, `#/settings`.
  - An unknown route falls back to Home.
  - The header has no logo image and no `Masterpiece` heading.
  - `expectNoHorizontalScroll` on the hub, More and the open switcher.
  - `expectRedOnly` on the hub, More and the switcher sheet in Night red.
- [ ] **Step 3: Rewrite the existing specs**
  - Add the helper `openShipSection(page, name)`, which clicks Main → `Ship`, then the `Ship sections` link `{ name, exact: true }`.
  - Replace every chip-row click with it.
  - `Profiles` and `Settings` tab clicks become More → row.
  - The chip-list assertions in `reliefs.spec.ts` and `shell.spec.ts` become the hub tile list.
  - In `crewListPrint.spec.ts:204` the expected number of `Masterpiece logo` images becomes 0 on screen (the print footer's stays `aria-hidden`).
- [ ] **Step 4: Run the tests to verify they fail**

  Run: `npx vitest run src/ui/components/Nav.test.ts src/app/router.test.ts && npx playwright test e2e/nav.spec.ts --trace off`

  Expected: FAIL.
- [ ] **Step 5: Implement.**
- [ ] **Step 6: Run the tests to verify they pass**

  Run: `npx vitest run && npm run typecheck && npx playwright test --trace off`

  This is the full e2e run, because every spec navigates. Expected: PASS. Measure startup bytes.
- [ ] **Step 7: Commit** with the message `Add the new header, bottom bar, Ship hub and More`

### Task 5: Today Home and the hub's status lines

**Files:**
- Create: `src/ui/useShipRecords.ts`, `src/ui/overviewView.ts`, `src/ui/overviewView.test.ts`
- Modify: `src/ui/screens/Home.tsx`, `src/ui/homeView.ts` (and its test), `src/ui/screens/ShipHub.tsx`, `src/ui/theme.css` (the Home and tile sections)
- Test: `e2e/home.spec.ts` (rewritten), `e2e/nav.spec.ts` (status lines)

**Interfaces:**
- Consumes: Task 3's `dueRow`, `DueRow`, `NOTHING_DUE`, `CREW_DOC_KINDS`; Task 4's `HUB_TILES`, `HubTile`, `Icon`.
- Produces:
  ```ts
  // useShipRecords.ts: one useLive read of the active ship's records (type-only import of DraftSurvey)
  export interface ShipRecords { crew: CrewMember[]; certificates: Certificate[]; crewDocuments: CrewDocument[]; voyages: Voyage[]; surveys: DraftSurvey[] }
  export function useShipRecords(shipId: string): ShipRecords | undefined;   // listForShip on 'crew', 'certificates', 'crewDocuments', 'voyages', 'draftSurveys'
  // overviewView.ts (pure)
  export function etaCountdown(eta: Date, now: Date): string;     // '2 d 5 h' | '5 h 12 min' | '42 min' | 'Passed'
  export function etaLocalText(etaLocal: string): string;         // '2026-11-19T14:00' → '19 Nov 14:00 LT'
  export function shiftText(deltaMinutes: number): string;        // −60 → '−1 h' (U+2212), 30 → '+30 min', 90 → '+1 h 30 min'
  export interface VoyageCardView {
    overline: string;                       // 'Voyage V-112' | 'Voyage' (no number) | 'No voyage'
    route?: string;                         // 'Santos → Qingdao', '—' for a missing port; absent when both are missing
    eta?: { countdown: string; local: string } | { missing: 'ETA not set' };   // absent with no voyage
    onBoard: number;
    clockChange?: string;                   // 'Next clock change: −1 h'
  }
  export function voyageCard(input: { voyage?: Voyage; crew: CrewMember[]; today: string; now: Date; clockChanges: ClockChange[]; offsetMinutes: number }): VoyageCardView;
  export const PARTICULARS_FIELDS: readonly (keyof Particulars)[];  // the 16 fields the SMS-form auto-fill reads: name, imo, callSign, mmsi, flag, portOfRegistry, gt, nt, dwt, loa, beam, yearBuilt, owners, managers, pandi, classSociety
  export function particularsToFill(p: Particulars): number;       // blank text after trim, or a number that is undefined
  export interface TileStatus { text: string; tone: 'plain' | 'ok' | 'warn' | 'danger' }
  export function hubStatuses(input: ShipRecords & { ship: ShipProfile; alerts: Alert[]; today: string; now: Date; clockChanges: ClockChange[]; offsetMinutes: number }): Record<HubTile, TileStatus>;
  ```
- **Hub status lines** (spec §7 table):

  | Tile | Status line and tone |
  |---|---|
  | Crew | `21 on board`, plain |
  | Crew documents | red crew-document alerts give `N expired` (danger); otherwise amber ones give `N due` (warn); otherwise `✓ None due` (ok) |
  | Certificates | certificate alerts: red gives `N overdue` (danger); amber gives `N due in D d`, where D is the nearest (warn); none gives `✓ None due` (ok) |
  | Contracts & reliefs | contract and onboard-limit alerts: red gives `N overdue` (danger); amber gives `N due in 30 d` (warn); none gives `✓ None due` (ok) |
  | Voyage | `V-112 · ETA 19 Nov`, or `V-112 · ETA not set`, or `No voyage` |
  | Ship's time | `UTC+03:00 · −1 h at 22:00` when the next change is on the ship's today, `… on 26 Oct` when it is later, or `UTC+03:00` alone |
  | Draft survey | `Last: initial, 14 Nov` (the newest live survey, its `date`, else the ship-local date of `createdAt`), or `No surveys` |
  | Particulars | `✓ Complete` (ok) or `N to fill` (warn) |

  Danger and warn statuses render as the filled and outlined pills. Ok renders as ✓ and a word in `--ok`.

**Home** (spec §7 and §12.1, top to bottom):
- `<h2 class="visually-hidden">Home</h2>`, then the flash status.
- The backup banner and the persistence banner, as today, restyled. The backup banner is dismissible: `Not now` hides it until the next app start (component state only).
- **Voyage card**, from `voyageCard`:
  - overline, route (`--fs-heading`);
  - figures in `--fs-figure` Mono: `ETA in` with countdown and local time, and `On board` with the count and the clock-change caption;
  - with no voyage: `No voyage` and a `Start voyage` link to `#/ship/voyage` in place of the ETA column.
- **Due** (`<section aria-label="Due">`):
  - `<h2>Due</h2>` and `See all N` to `#/due`, shown when N > 0;
  - the first three `collectAlerts` as `DueRow`s;
  - `✓ Nothing due` in `--ok` when there are none.
- **Forms in progress** and **Budget alerts:** compact 48 px rows, shown only when they have something. Budget alerts stay lazy and `no-print`.
- **Tiles:** a 3×2 grid, `margin-top: auto`, so it sits at the bottom above the nav:
  - `Crew` `#/ship/crew`
  - `Fill form` `#/forms`
  - `Draft survey` `#/ship/survey`
  - `+ Expense` `#/budget/add` (accent-filled; accessible name `+ Expense`)
  - `Converter` `#/tools`
  - `Library` `#/library`

  Each tile is 76 px, icon over label, `no-print`.
- `Ship's data`, the Tools/Budget/Library cards and the separate clock-change line are removed. The clock change now lives on the card and the Ship's time tile.
- The Home `.screen` is a flex column at least as tall as the space between the bars, so the tiles reach the bottom.

- [ ] **Step 1: Write the failing unit tests** (`overviewView.test.ts`)
  - `etaCountdown`: 2 d 5 h, exactly 1 d (`1 d 0 h`), 5 h 12 min, 42 min, 0 min, and past → `Passed`.
  - `etaLocalText('2026-11-19T14:00') === '19 Nov 14:00 LT'`.
  - `shiftText(-60) === '−1 h'` (U+2212), `30 → '+30 min'`, `90 → '+1 h 30 min'`.
  - `voyageCard`:
    - no voyage → `{ overline: 'No voyage', onBoard }`;
    - a voyage with an empty `voyageNo` → `'Voyage'`;
    - both ports empty → no `route`;
    - one port empty → `—`;
    - an empty `etaLocal` → `{ missing: 'ETA not set' }`;
    - an ETA given in UTC+08:00 on a UTC+03:00 ship counts down to the right instant;
    - `onBoard` counts only the crew onboard on `today`;
    - the clock-change caption uses `next.toOffsetMinutes − offsetMinutes`.
  - `particularsToFill`: all 16 filled → 0; blank `pandi` and undefined `gt` → 2; whitespace counts as blank.
  - `hubStatuses`: every row of the table above, from made-up records.
- [ ] **Step 2: Write the failing e2e tests** (`e2e/home.spec.ts` rewritten; each old assertion is kept in new form)
  - Made-up data (`MV OCEAN STAR`; crew including 2nd Officer R. EXAMPLE with an expired passport; a certificate due in 14 days; voyage V-112 Santos → Qingdao with an ETA) gives a card with `Voyage V-112`, `Santos → Qingdao`, a countdown, and the on-board count.
  - Due shows three rows and `See all N`, and the first row is the passport with `5 d over`.
  - A ship certificate row is on Home (`in 14 d`), and it opens the certificate.
  - An empty ship shows `No voyage`, `Start voyage` and `✓ Nothing due`.
  - The backup banner comes and goes as before. `Not now` hides it.
  - The persistence notice, as before.
  - The next clock change shows `Next clock change: +2 h` and is gone after it happens.
  - Forms in progress and Budget alerts, as before; Budget alerts are never printed.
  - The six tiles link to their routes, and `+ Expense` opens quick add.
  - Switching ship with the pill swaps the card and Due at once.
  - The hub's status lines match the data (`2 on board`, `1 expired`, `1 due in 14 d`, `✓ Complete` after filling all 16 particulars, `N to fill` before).
  - At 360×780 and 412×860: no horizontal scroll, and the tiles end above the nav (their bounding box bottom is no lower than the nav's top).
  - `expectRedOnly` on Home and the hub in Night red.
  - Add Home and the hub to the screenshot list.
- [ ] **Step 3: Run the tests to verify they fail**

  Run: `npx vitest run src/ui/overviewView.test.ts && npx playwright test e2e/home.spec.ts --trace off`

  Expected: FAIL.
- [ ] **Step 4: Implement.** Home and the hub each call `useShipRecords(activeShip.id)`, keyed by ship, and `collectAlerts` in a `useMemo`, as Home does today.
- [ ] **Step 5: Run the tests to verify they pass**

  Run: `npx vitest run && npm run typecheck && npx playwright test e2e/home.spec.ts e2e/nav.spec.ts e2e/due.spec.ts --trace off`

  Expected: PASS. Measure startup bytes, and check that `dist/index.html`'s modulepreloads did not gain a budget, survey, forms or library chunk.
- [ ] **Step 6: Commit** with the message `Make Home a Today screen and give the Ship hub live status lines`

### Task 6: Shared components on tokens

**Files:**
- Modify: `src/ui/theme.css` (the base, shell, buttons and fields, banners and toast, screens/cards, dialogs and badges sections), `src/ui/components/BandBadge.tsx` (and its test), `src/ui/components/{ConfirmDialog,ErrorToast,UpdateBanner,Field}.tsx` (only where a class changes), `src/ui/screens/budget/QuickAdd.tsx:315` (`Catch up` becomes a chip link), `src/ui/components/FillQuestions.tsx` (the checkbox's label is the 48 px target)
- Test: `src/ui/components/BandBadge.test.ts`, `e2e/helpers.ts` (`expectTargets`, `expectInputFonts`), `e2e/shell.spec.ts`

**Interfaces:**
- Produces the shared classes later tasks use. Names that exist today stay:
  - `.btn` with `.btn-primary`, `.btn-outline` (secondary), `.btn-danger`, `.btn-small`, `.btn-large`;
  - `.field`;
  - `.card`;
  - `.list-row` (new: 56 px minimum, overline, title, meta, trailing chip, chevron; the whole row is the link);
  - `.chip` (filter chips);
  - `.status[data-tone='danger'|'warn'|'ok']` (filled, outlined, and ✓ plus word);
  - `.banner` (`.home-notice` renamed);
  - `.toast`;
  - `dialog.dialog` and `.sheet`;
  - `.empty-state` (48 px icon, one sentence, one primary action);
  - `.visually-hidden`.
- `BandBadge`:
  - amber renders `.status[data-tone=warn]`, red renders `.status[data-tone=danger]`;
  - `ok` now renders `✓ Valid` (`data-tone=ok`) for the kinds `crew` and `certificate` (spec §6: green means valid);
  - `contract` and `limit` show nothing when ok, as today;
  - `none` shows nothing.

**Rules:**
- Font sizes come only from the type tokens: 11/13/15/17/20/24 px go to the nearest token.
- Every spacing comes from `--sp-*`. Field gap: the label sits 8 px above its input, and 12 px separates a field from the next label.
- Inputs and selects are 48 px with `--fs-body`.
- Buttons are 48 px (`--target`) and `--r-md`.
- The toast is `--danger-bg` / `--text` with a `--danger` border in Night red and Dark. In Day it is `--danger` / `--on-danger`. No shadow in Night red.
- Dialogs: `--surface-1`, `--r-lg`, and the backdrop is `rgb(0 0 0 / .6)`.

- [ ] **Step 1: Write the failing tests**
  - `BandBadge.test.ts`: ok/crew → `✓ Valid`; ok/contract → nothing; the tone attributes.
  - `e2e/helpers.ts`:
    - `expectTargets(page)` fails if any visible `a`, `button`, `select`, `input:not([type=hidden])` or `[role=button]` has a rendered box under 44 px in both width and height, or under 44 px in height when it is wider than 120 px. Inline links inside running text (`p a`) are exempt, and the exemption list is commented;
    - `expectInputFonts(page)` fails on any input, select or textarea with a computed font size under 16 px.
  - In `shell.spec.ts`, call both on Home, Settings, the crew edit form, budget quick add (`Catch up` is now 48 px tall) and form fill (the checkbox row is 48 px). Then `expectRedOnly` with a ConfirmDialog open (Profiles → Delete), with the error toast shown (`failWrites` then a save), and with the update banner.
- [ ] **Step 2: Run the tests to verify they fail**

  Run: `npx vitest run src/ui/components/BandBadge.test.ts && npx playwright test e2e/shell.spec.ts --trace off`

  Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests to verify they pass**

  Run: `npx vitest run && npm run typecheck && npx playwright test e2e/shell.spec.ts e2e/crew.spec.ts e2e/certificates.spec.ts e2e/forms.spec.ts e2e/budget.spec.ts e2e/profiles.spec.ts --trace off`

  Expected: PASS. Tests that asserted "no badge" on a valid crew member or certificate are updated to `✓ Valid`. Measure startup CSS.
- [ ] **Step 5: Commit** with the message `Rebuild the shared components on the design tokens`

### Task 7: Migrate the screens in theme.css to tokens

**Files:**
- Modify: `src/ui/theme.css`. The sections are: welcome, crew list, printed crew list (the screen frame only), certificates, crew documents, reliefs, crew import, voyage and ship's time, settings and backup, import backup, app lock, forms, fill a form, and fill helpers.
- Modify the screens only where a class name changes. Lists that are underlined links or cards with a title link become `.list-row` where the row is wholly a link (forms library titles, the certificate register). Button rows stay as they are (spec §4: structure unchanged).
- Test: `src/ui/tokens.test.ts`, `e2e/screenshots.spec.ts` (add every screen in these sections)

**Interfaces:**
- Consumes: Task 6's classes and tokens.

- [ ] **Step 1: Write the failing test** (`tokens.test.ts`, for `theme.css` outside its token blocks)
  - Every `font-size` is `var(--fs-*)`, `inherit` or `1em`.
  - Every `border-radius` is `var(--r-*)`, `0` or `50%`.
  - No hex colour, `rgb()` or named colour except `transparent` and `currentColor`. The allow-list is the `::backdrop` value.
  - `font-weight` is a `var(--fw-*)`.
  - `padding`, `margin` and `gap` lengths are `0`, `var(--sp-*)`, or a `calc()` of them. Safe-area `env()` sums are allowed.
- [ ] **Step 2: Run the test to verify it fails**

  Run: `npx vitest run src/ui/tokens.test.ts`

  Expected: FAIL, listing each offending line.
- [ ] **Step 3: Implement** section by section. Keep every selector that a screen or test uses. Delete the `:root[data-theme='night']` and `'contrast'` overrides that tokens now cover.
- [ ] **Step 4: Run the tests to verify they pass**

  Run: `npx vitest run && npm run typecheck && npx playwright test e2e/crew.spec.ts e2e/crewDocs.spec.ts e2e/crewImport.spec.ts e2e/crewListPrint.spec.ts e2e/certificates.spec.ts e2e/reliefs.spec.ts e2e/voyageTime.spec.ts e2e/backup.spec.ts e2e/lock.spec.ts e2e/forms.spec.ts e2e/profiles.spec.ts --trace off`

  Expected: PASS. `crewListPrint` keeps its print assertions unchanged. Call `expectRedOnly`, `expectTargets` and `expectInputFonts` once in each of these specs, on its main screen, in Night red. Check the screenshots in all four themes against the mockups' look (tinted rows, pills, tiles). Measure startup CSS.
- [ ] **Step 5: Commit** with the message `Move every base screen onto the design tokens`

### Task 8: Migrate the piece CSS (budget, library, survey, tools) and remove the old names

**Files:**
- Modify: `src/ui/screens/budget/budget.css` (charts: `.series-0`…`.series-4` use `--chart-1`…`--chart-5` and keep their dashes, so Debts is no longer red; labels and legends are `--fs-caption`, which was 9 px), `src/ui/screens/library/library.css` (`mark` uses `--mark-bg`/`--mark-text`; `.textLayer ::selection` and `mark` come from tokens; `.pdf-page`, `.pdf-page canvas` and `.image-view` get `filter: var(--media-filter)` and the page background `--surface-0` in Night red only; `--border`/`--warning` are replaced), `src/ui/screens/survey/survey.css` (the result figure is `--fs-display` Mono), `src/ui/screens/tools/tools.css`, `src/ui/theme.css` (aliases removed), `src/ui/print.css` (only the new tokens)
- Test: `src/ui/tokens.test.ts`, `e2e/budget.spec.ts`, `e2e/library.spec.ts`, `e2e/survey.spec.ts`, `e2e/tools.spec.ts`

**Interfaces:**
- Consumes: Task 1's tokens and Task 6's classes. The piece CSS files stay imported by their own chunks.

- [ ] **Step 1: Write the failing tests**
  - `tokens.test.ts`:
    - the Task 7 rules also apply to the four piece files. Exemptions, each commented: the pdf.js text-layer `calc()` font sizes, and `@media print` blocks, which may use `pt` and `#000`/`#fff`;
    - no file under `src/` uses an old name (`--bg`, `--surface)`, `--muted`, `--amber`, `--on-amber`, `--red`, `--on-red`, `--radius`, `--warning`, `--border`, `--bar-border`);
    - the series classes map to `--chart-1` through `--chart-5`.
  - e2e, in Night red:
    - `expectRedOnly` on Budget → Trends (charts), quick add, the library with a made-up PDF open and a search highlight, a survey with a result, and Tools → a converter;
    - the PDF canvas's computed `filter` is not `none`;
    - in Day the Debts line's computed stroke is not the danger colour.
- [ ] **Step 2: Run the tests to verify they fail**

  Run: `npx vitest run src/ui/tokens.test.ts && npx playwright test e2e/budget.spec.ts e2e/library.spec.ts --trace off`

  Expected: FAIL.
- [ ] **Step 3: Implement.** Then delete the alias block from Task 1.
- [ ] **Step 4: Run the tests to verify they pass**

  Run: `npx vitest run && npm run typecheck && npx playwright test e2e/budget.spec.ts e2e/library.spec.ts e2e/survey.spec.ts e2e/tools.spec.ts e2e/shell.spec.ts --trace off`

  Expected: PASS. Print assertions in these specs are unchanged. Measure startup CSS: the piece CSS is not in it.
- [ ] **Step 5: Commit** with the message `Move budget, library, survey and tools onto the design tokens`

### Task 9: README and full verification

**Files:**
- Modify: `README.md`. It covers:
  - the bottom bar;
  - Home's card, Due and tiles;
  - the Ship hub;
  - More (Tools, Library, Profiles, Settings, Backup and restore, App lock);
  - the four themes and `Night red automatically`;
  - the Due screen and Before next port.

  Paths in the text such as "Home → **Tools**" become "More → **Tools**". The phone and laptop install steps are unchanged.
- Modify: `release.json` (`whatsNew` lines for this piece; same version as `package.json` unless the repo's release practice says to bump both)

- [ ] **Step 1: Update `README.md` and `release.json`**, then check every screen path the README names by opening it in the built app.
- [ ] **Step 2: Run the whole suite**

  Run: `npx vitest run && npm run typecheck && npm run build && npx playwright test --trace off`

  Expected: all pass. Record the counts.
- [ ] **Step 3: Measure startup bytes**

  Expected: JS ≤ 110,386 B and CSS ≤ 9,030 B. Report both, with their change against 108,386 B and 6,030 B.
- [ ] **Step 4: Take screenshots**

  Run: `SCREENSHOT_DIR=<scratchpad>/shots-final npx playwright test e2e/screenshots.spec.ts --project=android --trace off`

  It covers, in all four themes: Home, Due, the hub, More, Settings, Crew, the crew edit form, Certificates, Forms, form fill, Budget dashboard, Trends, quick add, Library with a PDF, a survey, Tools, the lock screen and first run. Compare Home and the hub against the four mockups. List any differences in the report.
- [ ] **Step 5: Check by hand in Night red**
  - Open a select, a date input and a checkbox.
  - Open a dialog and produce the toast.
  - Confirm with the screenshots that nothing white or blue shows. Note any native popup CSS cannot reach (for example the Android date picker) as a known limit.
- [ ] **Step 6: Commit** with the message `Document the phone redesign`

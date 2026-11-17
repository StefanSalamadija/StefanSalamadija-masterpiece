# Masterpiece piece 7: phone redesign

Status: draft for the user's review. Mockups: the canvas "Masterpiece phone redesign" (four screens: Today Home and Ship hub, each in Day and Night red), approved by the user as drawn.

## 1. Intent

The Chief Officer uses Masterpiece on the phone only, often tired, on an 8-on/4-off watch, and at night on a dark bridge. The phone review (2026-11-17) found the app strong underneath but scattered on the phone:
- Home shows little.
- The bottom bar spends two tabs on Profiles and Settings.
- The Ship sections hide in a sideways-scrolling chip row.
- There is no type or spacing scale (12 font sizes, 5 radii).
- "Night" is navy with bright teal, which spoils night vision.

This piece gives the whole app one coherent look, a bridge-safe night mode, and a Home screen that answers "what needs me today?" in one glance.

Success, as the user would judge it:
- They open the app and see the voyage, the ETA countdown, people on board and what is due, without tapping.
- Everything they use often (crew, forms, draft survey, budget, tools, library) is one tap away.
- At night the screen is black and red only.
- Every screen looks like it belongs to the same app.

## 2. Decisions the user made

- **Phone only.** Design for 360–412 px wide. No desktop layouts.
- **Approach A: everything in one go.** Every screen is restyled to the new tokens in this piece, not only the shell.
- **Mockups approved as drawn, including:**
  - Night red's brightness and colours.
  - The six quick-action buttons: Crew, Fill form, Draft survey, + Expense, Converter, Library.
  - The Due list showing the first three items with "See all".
  - The voyage card first on Home.
- **Bottom bar:** Home · Ship · Forms · Budget · More.
- **Night red switches on automatically at fixed hours of ship's time,** for example 18:00–06:00. The user sets the hours once. A manual switch from the header button is always possible.
- **All four areas are used often:** crew and documents, SMS forms, draft survey, and budget/tools/library.

## 3. Goals

1. **Design tokens.** One set of CSS custom properties, used by every screen and component:
   - a type scale, a spacing scale, radii, surfaces and a semantic palette;
   - one place for each theme.
2. **Four themes:**
   - **Day.**
   - **Dark:** today's navy Night, kept for the cabin, re-expressed in tokens.
   - **Night red.**
   - **High contrast:** kept as it is, re-expressed in tokens.
3. **Automatic night.**
   - Between the set hours of ship's time the app shows Night red; outside them, the user's day theme (Day, Dark or High contrast).
   - The header theme button still works. A manual choice holds until the next boundary, then automatic takes over again.
   - The browser status bar colour (`meta theme-color`) follows the theme in use.
4. **Today Home** (canvas "Today Home"):
   - a voyage card: voyage number and state, the route, the ETA countdown, people on board and the next clock change;
   - a Due list: the most urgent three, then "See all N";
   - six quick-action tiles in the lower half.
5. **New navigation:**
   - The bottom bar becomes Home · Ship · Forms · Budget · More.
   - The Ship tab opens a hub of tiles (canvas "Ship hub"), each with a live status line.
   - The chip row (`ShipNav`) is removed.
   - Each Ship section screen has a clear way back to the hub.
   - More holds Tools, Library, Profiles, Settings (with backup and app lock) and anything else that has no tab today.
6. **Ship switcher.** The header shows the current ship's name as a pill. Tapping it lets the user switch ship or open Profiles.
7. **A complete Due list.**
   - "See all" opens one Due screen (replacing today's Expiring) with everything `collectAlerts` gives, ship certificates included.
   - It is grouped by severity (overdue, due soon) and each item shows "in N d" or "N d over".
   - Today's Expiring reads crew documents only. That is a bug this fixes.
8. **Every existing screen migrated.**
   - Ad-hoc sizes, colours and radii are replaced by tokens across theme.css and the piece CSS files (budget, library, survey, tools).
   - Shared component styles (buttons, fields, cards, list rows, chips, status labels, dialogs, toasts, empty states) are rebuilt once and reused.

## 4. Non-goals

- Deeper per-screen layout changes from the review:
  - compact searchable crew list;
  - sticky survey result bar and auto-filled survey details;
  - sticky budget Save;
  - bars that hide while typing.

  Screens keep their current structure, restyled. These are candidates for a later piece.
- Global search. There is no search button in the header this time.
- Port call mode, notifications, camera capture and other new features from the review.
- Any change to calculations, stored data shapes beyond the theme settings, backups or file formats.
- Desktop or tablet layouts.

## 5. Anti-goals: things that would make this a failure even if it works

- Anything bright, white or blue in Night red. That includes focus rings, toasts, dialogs, the logo, the status bar, charts, PDF/print previews inside the app, and native controls such as date pickers, selects and checkboxes, as far as CSS `color-scheme` and `accent-color` can reach.
- A status told apart by colour alone. In Night red every colour is red, so overdue is solid and due-soon is outlined, and both also carry words ("5 d over", "in 14 d").
- Touch targets under 44 px. The goal is 48 px for list rows and tiles.
- Text under 16 px in inputs, which makes iOS zoom.
- A slower start.
- A screen that loses a function it has today.
- Print output changing. Print stays black on white whatever the theme.

## 6. Design tokens

These come from the review's Design direction, adjusted to what the user approved on the canvas. Fonts stay IBM Plex Sans and Mono, which the app already bundles; numbers use Mono with tabular figures.

### Type scale

| Token | px / line | Weight |
|---|---|---|
| `--fs-display` | 36/40 Mono | 500 |
| `--fs-title` | 22/28 | 600 |
| `--fs-heading` | 18/24 | 600 |
| `--fs-body` | 16/24 | 400 |
| `--fs-label` | 14/20 | 500 |
| `--fs-caption` | 12/16 | 500–600 |

The six sizes replace the twelve in use now. The Home figures (ETA, on board) are 28/32 Mono, as on the canvas. That one exception is tokenised as `--fs-figure`.

### Spacing, radius, targets

- **Spacing:** `--sp-1` 4 px, `--sp-2` 8, `--sp-3` 12, `--sp-4` 16, `--sp-5` 24, `--sp-6` 32, `--sp-7` 48.
- **Radius:** `--r-sm` 8, `--r-md` 12, `--r-lg` 20, `--r-pill` 999.
- **Targets:** `--target` 48 px.
- **Layout:** the page gutter is 16 px, sections are 24 px apart, and there is 12 px between a field and the next label.

### Palette

| Token | Day | Dark | Night red |
|---|---|---|---|
| surface-0 / 1 / 2 | #FFFFFF / #F3F6FA / #E8EEF5 | #0A121C / #111D2B / #18283A | #000000 / #120000 / #1E0303 |
| line | #D5DEE8 | #243A52 | #3A0A0A |
| text / text-muted | #0B1622 / #4A6380 | #DCE5EE / #93A8BE | #E04A3A / #D04030 |
| bar-bg | #0B2545 | #07101A | #000000, with a line below |
| accent / on-accent | #1D5FD1 / #FFFFFF | #4FB8D6 / #031A22 | #C8372A / #000000 |
| ok, ok-bg | #1E7A46, #E3F4EA | #5CCB8A, #12301F | #D04030 + ✓ glyph, none |
| warn, warn-bg | #8A5A00, #FFF1D1 | #F2B33D, #3A2A08 | #E04A3A outline, #120000 |
| danger, danger-bg | #B3261E, #FDE7E5 | #FF7A6E, #3D1210 | #FF5A45 solid, #4A0606 |
| focus | #1D5FD1 | #7AB8FF | #FF5A45 |

Rules for the palette:
- High contrast keeps today's values, expressed as these tokens.
- Red means overdue or expired only. Amber means due soon. Green means valid or done; it is new, and today valid items show no status at all.
- The budget's Debts series stops being red.
- Chart series get tokens per theme. In Night red, charts use one red with solid, dashed and dotted strokes.
- The status-chip style follows the canvas:
  - overdue is a filled pill;
  - due soon is an outlined pill;
  - valid is a ✓ and a word.

## 7. Screens

### Header (every screen)

- The header holds the ship pill, ship's time (Mono, `--fs-label`) and the theme button. It is 56 px tall.
- The theme button's icon shows the current theme. A small "auto" mark shows when automatic night is on.
- No back arrow is added globally.

### Today Home

The voyage card, the Due list and the tiles, as drawn on the canvas.

**Voyage card:**
- It shows the current voyage: number, "At sea" or "In port", the route as from → to, the ETA as a countdown plus the local time, people on board, and the next clock change from ship's time.
- With no voyage, the card says so in one line and offers "Start voyage".

**Due list:**
- The first three alerts from `collectAlerts`, ordered as it orders them.
- Each row shows a title, a meta line and a chip.
- A green "✓ Nothing due in 30 days" shows when the list is empty.

**Backup reminder:** stays as one dismissible banner, shown only when a backup is due.

**Tiles:** the six tiles sit at the bottom of the scroll area, above the nav. "+ Expense" is the accent-filled tile.

**First run:** what Home shows today with no ship or profile (FirstShip and its prompts) keeps working, in the new style.

### Ship hub

Eight tiles in two columns, each with an icon, a name and a live status line:

| Tile | Status line |
|---|---|
| Crew | N on board |
| Crew documents | N expired, or N due |
| Certificates | N due in N d |
| Contracts & reliefs | N due in 30 d |
| Voyage | voyage number and ETA |
| Ship's time | zone and the next change |
| Draft survey | last survey and date |
| Particulars | ✓ Complete, or what is missing |

- Any existing Ship screen without a tile here, such as Expiring and the certificate register, is reachable from the tile it belongs to. Expiring becomes the Due screen, reached from Home's "See all".
- **Builder's call:** whether "Crew documents" is its own route or a filtered view of the existing register.

### More

- One list screen of large rows: Tools, Library, Profiles, Settings, Backup and restore, App lock.
- Today's Settings content does not move; More links into it.

### Every other screen

- **Restyled to tokens:** shared buttons, fields, cards, rows, chips, dialogs, toasts and empty states.
- **Layout unchanged,** except where a token rule forces it: 48 px targets, the 16 px input font, and the spacing scale.
- **Fixes the review listed for too-small targets:**
  - "Ship's data" link, 79×20;
  - "Catch up", 63×20;
  - the 24 px checkbox.
- **Safe area:** the page respects the phone's safe area insets.

## 8. Automatic night: behaviour

- **Settings stored** (device-local, next to `theme`):
  - `dayTheme`: 'day', 'dark' or 'contrast';
  - `nightAuto`: boolean;
  - `nightFrom` and `nightTo`: HH:MM in ship's time.
- **Defaults:** `nightAuto` off, from 18:00, to 06:00.
- **Effective theme:**
  - Night red when `nightAuto` is on and ship's time is inside the window. The window may cross midnight.
  - Otherwise `dayTheme`.
- **Manual override:**
  - A header-button tap sets a manual override for the current window segment.
  - The override is cleared at the next boundary.
  - The button cycles Day → Dark → Night red → High contrast.
- **Re-checks:** the effective theme is checked every minute, on app focus and visibility change, and when ship's time changes (a clock change, or a new zone).
- **First paint:** the index.html first-paint script must paint the right theme before the app starts.
  - It reads a localStorage mirror of what it needs: the effective theme and the window.
  - If the mirror is stale, a theme flash is acceptable only for a single frame.
- **Migration:** the stored theme `'night'` becomes `'dark'`.
- **Status bar:** `meta theme-color` is set to the current bar-bg.

## 9. Constraints

- **Stack:** Preact 11, Vite 8, TypeScript, Dexie 4, Vitest, Playwright (preinstalled; never run `playwright install`). No new runtime dependencies.
- **Startup bytes:**
  - Startup JS, gzip of the index chunk and its modulepreloads, measured as in the earlier pieces: at most +2.0 kB against main d10e002.
  - Startup CSS: at most +3.0 kB gzip. The token rewrite should shrink duplicated CSS, so it may well come in below that.
  - Home's new data reads must not pull lazy chunks into startup.
- **Offline:** everything is precached as now.
- **Data:**
  - No Dexie schema version change unless unavoidable.
  - Settings fields are added with defaults.
  - Backups, snapshots and handovers are unaffected. Theme settings are device-local and stay out of backups, as `theme` is today.
- **Tests:**
  - Existing e2e tests that assert on nav labels, the chip row or routes are updated, never deleted without a replacement.
  - New e2e tests cover:
    - Home's card and the Due list, including a ship certificate;
    - nav to the Ship hub and every tile;
    - More;
    - the theme cycle;
    - automatic night switching. Use a fake clock or ship's time set near a boundary.
  - Screenshots at 360 px of the main screens, in all four themes, go to the scratchpad for the reviewers. They are not committed.
- **Confidentiality:** made-up data only. No real ship, company or crew data in code, tests or screenshots.
- **UI language:** English.

## 10. Approaches considered

- **A. Everything in one go (chosen by the user).** Tokens, all four themes, the new shell, Home and the Ship hub, and every screen migrated to tokens in this piece. The whole app is consistent from the first release; it is the largest piece so far.
- **B. Base and main screens now, deeper redesigns later.** Shared building blocks plus the new shell and Home, with other screens inheriting the look through shared styles. Not chosen: the user wants the whole app consistent at once.
- **C. Style only the new screens.** Dropped: old and new screens would look like two apps, the inconsistency the review criticised.

## 11. Left to the builder

- The exact CSS architecture: one tokens file plus component layers, or a rewritten theme.css. Keep the piece CSS files lazy with their chunks.
- The route names for the Ship hub, More and Due (for example `/ship`, `/more`, `/due`). Old routes such as `/ship/particulars` and `/ship/expiring` must still open, with `/ship/expiring` redirecting to Due.
- How the ship pill's switch is presented: a bottom sheet or the Profiles screen.
- The icon set: 24 px outline, 1.75 stroke, inline SVG as today. The canvas icons are a guide, not a spec.
- How the minute timer is scheduled.

## 12. Settled after the builder check (designer's calls, for the user to check)

1. **What else stays on Home.**
   - Forms in progress and Budget alerts stay on Home, below Due, as compact rows, and show only when they have something. Budget alerts keep loading on demand, as today.
   - The storage-persistence notice stays as a banner, like the backup reminder.
   - The "Fill form" tile opens the Forms list.
2. **No "At sea / In port" word.** The voyage card's overline reads "Voyage V-112". Voyage has no state field, and none is added.
3. **"Before next port" is kept.** The Due screen has two views, *All due* (from `collectAlerts`) and *Before next port* (today's Expiring logic, unchanged). `/ship/expiring` opens Due on the Before next port view.
4. **Empty Due** says "✓ Nothing due", not "in 30 days". Each kind keeps its own warning window, and calculations do not change.
5. **Theme settings model.**
   - Settings has a Theme select (Day, Dark, Night red, High contrast). That is the stored base theme; the existing `theme` field is kept and `'night'` migrates to `'dark'`.
   - Under the select: "Night red automatically", with From and To times in ship's time (`nightAuto`, `nightFrom`, `nightTo`).
   - The header button cycles the four themes. With auto off, a tap changes the base theme, as today. With auto on, a tap is a temporary override (`themeOverride`, with the boundary time it ends at). It clears at the next boundary.
   - The effective theme is the override if one is set, else Night red inside the window when auto is on, else the base theme.
   - The `dayTheme` name in §8 is replaced by this model.
6. **Due rows** are reformatted in the UI, not the domain.
   - `Alert` gains a structured due date, and possibly a document kind and a person reference, so the row can show "Passport · 2/O R. Example", "Expired 12 Nov" and an "in N d" or "N d over" chip.
   - The existing `title` and `detail` are kept for print and the existing tests.
   - The Due screen prints, the way Home's alert section does today.
7. **Dark keeps today's look.** It uses today's navy values, expressed as tokens. Semantic tokens Dark lacks today (ok, warn-bg, danger-bg, focus) take the §6 Dark values. High contrast likewise keeps its values and gains semantic tokens in its own black-on-white style. The §6 Dark column is a guide for the new tokens only.
8. **Particulars tile.** It shows "✓ Complete" when every field on the Particulars screen marked required (or used by the SMS-form auto-fill) is filled; otherwise "N to fill". The builder lists the exact fields in the plan.
9. **Header follows the canvas.**
   - Ship pill, ship's time and the theme button, on every screen, the Ship hub included.
   - The logo and the "Masterpiece" title leave the header. They stay on the lock screen and first run.
   - No search button.
10. **The manifest's `theme_color` and `background_color` become #000000** for every theme, so the installed app never flashes navy at night. The in-app `meta theme-color` follows the theme once the app has started.
11. **Canvas details the spec doesn't list** (tinted warn and danger rows, active-tab pill colours, tile styles) are taken from the canvas as drawn.

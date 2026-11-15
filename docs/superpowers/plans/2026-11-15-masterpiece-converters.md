# Converters (Piece 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Offline unit converters, Volume ↔ mass, and a speed–distance–time calculator with ETA, in a lazy-loaded Tools section.

**Architecture:**
- Pure domain code in `src/domain/units/`:
  - one unit table, where each unit has a factor to its quantity's base unit;
  - small special rules for temperature, API, Beaufort and ft + in;
  - SDT and volume/mass solvers.
- One lazy screen module, `src/ui/screens/tools/`, serves all `/tools*` routes. It draws any group from the table.

**Tech Stack:** Preact 11, TypeScript, Vitest, Playwright 1.63. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-15-masterpiece-converters-design.md`

## Global Constraints

- All of `.superpowers/sdd/2026-10-25-masterpiece-base/global-constraints.md` applies. In particular:
  - no new dependencies;
  - offline;
  - English UI;
  - 360 px with no horizontal scroll (`expectNoHorizontalScroll` from `e2e/helpers.ts`).
- Exact factors are in spec §6.1. **Shackle = 27.5 m** (user decision).
- Numbers are typed into text inputs and read with `parseDecimal` (`src/domain/numbers.ts`):
  - a `,` or `.` decimal separator;
  - `{ signed: true }` only for temperature and API.
- The Tools code must be lazy:
  - Nothing under `src/domain/units/` or `src/ui/screens/tools/` may be imported from the main chunk, except through `lazyScreen(() => import(...))`.
  - The main chunk gzip must grow by **≤ 0.5 kB**. Record the before and after sizes from `npm run build` output in the final task.
- Remembering the last group and unit is a per-device convenience. It goes in `localStorage` key `masterpiece.tools.last`, wrapped in try/catch. *Builder call: no DB schema change, and it stays out of backups.*
- No personal or ship data is written. SDT only reads `clockChanges` and `nowUtc` from `useAppState()`.

## Review Focus

1. **Decimal comma and leading/trailing spaces in every row** (`12,5`, ` 12.5 `). Expected: 12.5 is read. Pinned in Task 1 (`parseUnitInput`).
2. **ft + in that rounds up to 12 inches** (e.g. 0.30475 m). Expected: `1' 0"`, never `0' 12"`. Pinned in Task 2.
3. **Typing in one row, then another.** Expected: the last edited row is the source, and the others never feed back or drift, e.g. m → ft → m. Pinned in Task 3 (e2e).
4. **SDT with a planned clock change before the ETA.** Expected: the ETA is shown with the offset in force at the ETA, and a note line appears. A deleted change is ignored. Pinned in Task 2 (`etaOf`) and Task 4 (e2e).
5. **Out-of-range input:**
   - negative length or mass;
   - temperature below −273.15 °C;
   - SG ≤ 0;
   - Beaufort that is not an integer from 0 to 12;
   - zero speed in SDT.
   Expected: only that row is marked, with a short message, and the other rows go empty instead of showing NaN or Infinity. Pinned in Tasks 1, 2 and 3.

---

## File Structure

- `src/domain/units/table.ts`: types, `GROUPS` and `UNITS`, the data only.
- `src/domain/units/convert.ts`:
  - `toBase` and `fromBase`;
  - `parseUnitInput` and `formatUnit`;
  - `convertFrom`.
- `src/domain/units/feetInches.ts`: ft + in parse and format.
- `src/domain/units/solve.ts`:
  - `solveSdt`, `parseDuration`, `formatDuration`, `etaOf`;
  - `solveVolumeMass`.
- `src/ui/screens/tools/index.tsx`: the `Tools`, `ToolGroup`, `VolumeMass` and `Sdt` screens, plus a small `UnitRow` component.
- Modify:
  - `src/app/router.ts`: routes.
  - `src/app/App.tsx`: lazy screens.
  - `src/ui/screens/Home.tsx`: Tools card.
  - `README.md`: one line.
- E2E: `e2e/tools.spec.ts`.

---

### Task 1: Unit table and conversion

**Files:**
- Create:
  - `src/domain/units/table.ts`
  - `src/domain/units/convert.ts`
- Test: `src/domain/units/convert.test.ts`

**Interfaces:**
- Produces:

```ts
export type QuantityId = 'length' | 'mass' | 'volume' | 'density' | 'stowage' | 'speed' | 'temperature' | 'pressure' | 'power';
export type GroupId = 'length' | 'mass-volume' | 'density' | 'physical';
export type UnitKind = 'factor' | 'celsius' | 'fahrenheit' | 'kelvin' | 'api' | 'beaufort' | 'ftin';
export interface UnitDef { id: string; quantity: QuantityId; label: string; symbol: string; decimals: number; kind: UnitKind; factor?: number /* base units per 1 unit, kind 'factor' only */ ; note?: string }
export interface GroupDef { id: GroupId; title: string; quantities: { id: QuantityId; title: string }[] }
export const GROUPS: readonly GroupDef[];   // Length & distance | Mass & volume (Mass, Volume) | Density & stowage (Density, Stowage factor) | Speed, temp, pressure, power (Speed, Temperature, Pressure, Power)
export const UNITS: readonly UnitDef[];
export function unitsOf(q: QuantityId): UnitDef[];          // table order
export function unitById(id: string): UnitDef;              // throws on unknown id
export function toBase(unit: UnitDef, value: number): number | 'invalid';
export function fromBase(unit: UnitDef, base: number): number;
export function parseUnitInput(unit: UnitDef, text: string): number | undefined | 'invalid';
export function formatUnit(unit: UnitDef, value: number): string;
export type ConvertResult = { ok: true; values: Record<string, string> } | { ok: false; message: string };
export function convertFrom(unitId: string, text: string): ConvertResult | undefined; // undefined = empty input
```

**Base units:**
- length: m;
- mass: kg;
- volume: m³;
- density: kg/m³;
- stowage: m³/t;
- speed: m/s;
- temperature: °C;
- pressure: Pa;
- power: W.

**Units, ids, decimals and order** (most used first):

| Quantity | Unit (id, decimals) |
|---|---|
| length | `m` 3, `ft` 2, `ftin` (¼ in), `nm` 3, `cm` 1, `mm` 0, `km` 3, `in` 2, `cable` 2, `fathom` 2, `shackle` 2 (27.5 m, note "metric shackle") |
| mass | `t` 3, `lt` 3, `st` 3, `kg` 1, `lb` 1 |
| volume | `m3` 3, `l` 1, `usgal` 1, `impgal` 1, `bbl` 2, `cuft` 2 |
| density | `tm3` 4, `kgm3` 1, `kgl` 4, `sg` 4 (note "relative to fresh water, ≈ t/m³"), `api` 1, `lbft3` 2 |
| stowage | `m3t` 3, `ft3lt` 2, `ft3t` 2 |
| speed | `kn` 1, `kmh` 1, `ms` 2, `mph` 1, `bf` (kind beaufort, 0) |
| temperature | `c` 1, `f` 1, `k` 2 |
| pressure | `bar` 3, `kpa` 1, `mpa` 4, `psi` 1, `kgfcm2` 3, `hpa` 1 (label "hPa / mbar"), `mmhg` 1, `inhg` 2 |
| power | `kw` 1, `hp` 1, `ps` 1 |

**Special rules:**
- **Factors:** derived in code from the exact constants of spec §6.1. For example, `cuft = 0.3048 ** 3`, `ft3lt = 0.3048 ** 3 / 1.0160469088` m³/t, and `ft3t = 0.3048 ** 3 / 1` m³/t. Never write rounded literals.
- **API:**
  - toBase: SG = 141.5 / (API + 131.5), base kg/m³ = SG × 1000. The value is invalid when API ≤ −131.5.
  - fromBase: 141.5 / (base / 1000) − 131.5.
  - SG uses factor 1000.
- **Beaufort:**
  - fromBase: knots = base / (1852/3600), rounded to an integer. The force is the band index, using the lower bounds [0, 1, 4, 7, 11, 17, 22, 28, 34, 41, 48, 56, 64].
  - toBase: the band's mid knots, `(lo + hi) / 2` with hi = next lo − 1. Force 0 gives 0 and force 12 gives 64.
  - Input must be an integer from 0 to 12.
- **Validity:**
  - Negative values are invalid except for celsius, fahrenheit and api, which are parsed with `{ signed: true }`.
  - Temperatures below −273.15 °C are invalid.
  - SG and density values ≤ 0 are invalid.
  - A value of 0 is valid for length, mass, volume, speed and pressure.
- **`formatUnit`:**
  - `toFixed(decimals)` with `-0` normalised to `0`;
  - ftin is delegated to Task 2's `formatFeetInches`, so Task 1 stubs ftin and Task 2 wires it in;
  - beaufort is formatted as an integer string.
- **`convertFrom` messages:**
  - an invalid source gives `{ ok:false, message }`, using `'Not a number'` for unparsable text and a range message such as `'Must be 0 or more'`, `'Below absolute zero'`, `'Must be above 0'` or `'Whole number 0–12'`;
  - otherwise it gives the formatted values for **every unit of the same quantity except the source**.

- [ ] **Step 1: Write failing tests** in `convert.test.ts`:

```ts
const close = (a: number, b: number, rel = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(Math.abs(b) * rel + 1e-12);
it('pins definitions', () => {
  close(unitById('ft').factor!, 0.3048); close(unitById('nm').factor!, 1852); close(unitById('cable').factor!, 185.2);
  close(unitById('fathom').factor!, 1.8288); close(unitById('shackle').factor!, 27.5);
  close(unitById('lt').factor!, 1016.0469088); close(unitById('st').factor!, 907.18474); close(unitById('lb').factor!, 0.45359237);
  close(unitById('usgal').factor!, 0.003785411784); close(unitById('impgal').factor!, 0.00454609); close(unitById('bbl').factor!, 42 * 0.003785411784);
  close(unitById('kn').factor!, 1852 / 3600); close(unitById('psi').factor!, 6894.757293168); close(unitById('kgfcm2').factor!, 98066.5);
  close(unitById('mmhg').factor!, 133.322387415); close(unitById('inhg').factor!, 3386.389); close(unitById('hp').factor!, 745.69987158227022); close(unitById('ps').factor!, 735.49875);
});
it('round-trips every unit', () => { for (const u of UNITS) if (u.kind !== 'beaufort' && u.kind !== 'ftin') close(fromBase(u, toBase(u, 7.25) as number), 7.25); });
it('known values', () => {
  expect(convertFrom('nm', '1')).toMatchObject({ ok: true, values: { ft: '6076.12' } });
  expect(convertFrom('lt', '1')).toMatchObject({ values: { t: '1.016' } });
  expect(convertFrom('m3t', '1')).toMatchObject({ values: { ft3lt: '35.88' } });
  expect(convertFrom('api', '10')).toMatchObject({ values: { sg: '1.0000' } });
  expect(convertFrom('kpa', '100')).toMatchObject({ values: { psi: '14.5' } });
  expect(convertFrom('kn', '30')).toMatchObject({ values: { bf: '7' } });
  expect(convertFrom('bf', '7')).toMatchObject({ values: { kn: '30.5' } });
  expect(convertFrom('c', '-40')).toMatchObject({ values: { f: '-40.0' } });
  expect(convertFrom('shackle', '1')).toMatchObject({ values: { m: '27.500' } });
});
it('reads comma and spaces', () => { expect(parseUnitInput(unitById('m'), ' 12,5 ')).toBe(12.5); });
it('refuses out of range', () => {
  expect(convertFrom('m', '-1')).toEqual({ ok: false, message: 'Must be 0 or more' });
  expect(convertFrom('c', '-274')).toEqual({ ok: false, message: 'Below absolute zero' });
  expect(convertFrom('sg', '0')).toEqual({ ok: false, message: 'Must be above 0' });
  expect(convertFrom('bf', '13')).toEqual({ ok: false, message: 'Whole number 0–12' });
  expect(convertFrom('m', 'abc')).toEqual({ ok: false, message: 'Not a number' });
  expect(convertFrom('m', '')).toBeUndefined();
});
it('every group quantity has units', () => { for (const g of GROUPS) for (const q of g.quantities) expect(unitsOf(q.id).length).toBeGreaterThan(1); });
```

- [ ] **Step 2:** Run `npx vitest run src/domain/units`. Expected: FAIL, because the modules are missing.
- [ ] **Step 3:** Implement `table.ts` and `convert.ts` to the interfaces above.
- [ ] **Step 4:** Run `npx vitest run src/domain/units && npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit with the message `Add unit table and conversions`.

---

### Task 2: ft + in, SDT, ETA, volume ↔ mass

**Files:**
- Create:
  - `src/domain/units/feetInches.ts`
  - `src/domain/units/solve.ts`
- Modify: `src/domain/units/convert.ts`, to wire ftin.
- Test:
  - `src/domain/units/feetInches.test.ts`
  - `src/domain/units/solve.test.ts`

**Interfaces:**
- Consumes:
  - `unitById`, `toBase`, `fromBase` and `parseUnitInput` from Task 1;
  - `shipOffsetAt`, `liveChanges` and `toShipLocal` from `src/domain/shipTime.ts`;
  - `ClockChange` from `src/domain/types.ts`.
- Produces:

```ts
export function parseFeetInches(text: string): number /* metres */ | undefined | 'invalid';
export function formatFeetInches(metres: number): string;        // nearest ¼ in, e.g. `32' 6¼"`
export type SdtSolveFor = 'speed' | 'distance' | 'time';
export function parseDuration(text: string): number /* hours */ | undefined | 'invalid';
export function formatDuration(hours: number): string;
export function solveSdt(v: { speedKn?: number; distanceNm?: number; hours?: number }, solveFor: SdtSolveFor): number | 'invalid';
export interface Eta { eta: Date; shipLocal: string /* 'YYYY-MM-DDTHH:mm' */; offsetMinutes: number; utc: string /* 'YYYY-MM-DDTHH:mm' */; changesBefore: ClockChange[] }
export function etaOf(now: Date, hours: number, changes: ClockChange[]): Eta;
export type VmSolveFor = 'volume' | 'density' | 'mass';
export function solveVolumeMass(v: { volumeM3?: number; densityKgM3?: number; massKg?: number }, solveFor: VmSolveFor): number | 'invalid';
```

**Rules:**
- **ft + in:**
  - Accepted forms:
    - `32' 6.5"`, `32'6"`, `32' 6¼"`;
    - `32 6.5`, `32'`, `32`, `0' 11¾"`;
    - comma decimals.
  - Inches must be ≥ 0 and < 12. A fraction glyph (¼ ½ ¾) may follow the whole inches.
  - Format: total inches rounded to the nearest 0.25, carried into feet so the result is never `12"`. Fractions are shown as ¼ ½ ¾, and there's no fraction for whole inches.
- **Duration:**
  - Accepted forms:
    - `h:mm`, where mm is 0–59;
    - decimal hours (`28.5`, `28,5`);
    - any of `Nd`, `Nh`, `Nm` separated by spaces (`1d 4h 30m`).
  - Duration ≤ 0 is invalid.
  - Format: rounded to the minute, as `28:30` and, when ≥ 24 h, ` (1 d 4 h 30 min)`.
- **`solveSdt`:**
  - `distance = speed × hours`.
  - Any input that is needed and is missing, ≤ 0 or non-finite gives `'invalid'`.
- **`etaOf`:**
  - `eta = now + hours`, rounded to the minute.
  - `offsetMinutes = shipOffsetAt(changes, eta)`.
  - `changesBefore` = the live changes with `now < effectiveAt ≤ eta`.
- **`solveVolumeMass`:**
  - `mass = volume × density`, in base units.
  - Inputs that are missing or ≤ 0 give `'invalid'`.

- [ ] **Step 1: Write failing tests:**

```ts
// feetInches.test.ts
expect(parseFeetInches(`32' 6.5"`)).toBeCloseTo((32 * 12 + 6.5) * 0.0254, 12);
expect(parseFeetInches('32 6,5')).toBeCloseTo((32 * 12 + 6.5) * 0.0254, 12);
expect(parseFeetInches(`0' 11¾"`)).toBeCloseTo(11.75 * 0.0254, 12);
expect(parseFeetInches(`5' 12"`)).toBe('invalid');
expect(parseFeetInches('')).toBeUndefined();
expect(formatFeetInches((32 * 12 + 6.25) * 0.0254)).toBe(`32' 6¼"`);
expect(formatFeetInches(0.30475)).toBe(`1' 0"`);
expect(formatFeetInches(parseFeetInches(`41' 0¼"`) as number)).toBe(`41' 0¼"`);
expect(convertFrom('m', '12.5')).toMatchObject({ values: { ftin: `41' 0¼"` } });
// solve.test.ts
expect(parseDuration('28:30')).toBe(28.5); expect(parseDuration('1d 4h 30m')).toBe(28.5); expect(parseDuration('28,5')).toBe(28.5);
expect(parseDuration('2:60')).toBe('invalid'); expect(parseDuration('0')).toBe('invalid');
expect(formatDuration(28.5)).toBe('28:30 (1 d 4 h 30 min)'); expect(formatDuration(2.25)).toBe('2:15');
expect(solveSdt({ speedKn: 12, hours: 10 }, 'distance')).toBe(120);
expect(solveSdt({ distanceNm: 120, hours: 10 }, 'speed')).toBe(12);
expect(solveSdt({ speedKn: 0, distanceNm: 120 }, 'time')).toBe('invalid');
expect(solveVolumeMass({ volumeM3: 100, densityKgM3: 991 }, 'mass')).toBe(99100);
expect(solveVolumeMass({ massKg: 99100, densityKgM3: 991 }, 'volume')).toBeCloseTo(100, 9);
// ETA across a planned change: now 2026-11-15T00:00Z, offset +180 until 2026-11-16T00:00Z then +120; one deleted change to +60 at 2026-11-15T12:00Z
const eta = etaOf(new Date('2026-11-15T00:00:00Z'), 30, changes);
expect(eta.utc).toBe('2026-11-16T06:00'); expect(eta.offsetMinutes).toBe(120);
expect(eta.shipLocal).toBe('2026-11-16T08:00'); expect(eta.changesBefore).toHaveLength(1);
```

- [ ] **Step 2:** Run `npx vitest run src/domain/units`. Expected: the new tests fail.
- [ ] **Step 3:** Implement both modules, and wire ftin into `parseUnitInput` and `formatUnit`.
- [ ] **Step 4:** Run `npx vitest run src/domain/units && npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit with the message `Add ft+in, speed-distance-time, ETA and volume-mass solvers`.

---

### Task 3: Tools screens: list and unit groups

**Files:**
- Create:
  - `src/ui/screens/tools/index.tsx`
  - `e2e/tools.spec.ts`
- Modify:
  - `src/app/router.ts`: add `'/tools'`, `'/tools/sdt'`, `'/tools/volume-mass'` and `'/tools/:group'`, in that order, after `'/forms/:id/fill'`;
  - `src/app/App.tsx`: one `lazyScreen` per route, all importing `../ui/screens/tools`, with a comment like the FormFill one;
  - `src/ui/screens/Home.tsx`: a "Tools" card linking `#/tools` with the line `Unit converters, volume ↔ mass, speed · distance · time`.

**Interfaces:**
- Consumes: Task 1's `GROUPS`, `unitsOf` and `convertFrom`; `useRoute` for `params.group`.
- Produces: the exports `Tools`, `ToolGroup`, `VolumeMass` and `Sdt` from `src/ui/screens/tools/index.tsx`. `VolumeMass` and `Sdt` may be placeholders until Task 4.

**Behaviour:**
- **`/tools`:**
  - lists the four `GROUPS` titles plus "Volume ↔ mass" and "Speed · distance · time", as links;
  - the last-used group (from `localStorage['masterpiece.tools.last']` = `{ group, quantity }`) is marked "Last used".
- **`/tools/:group`:**
  - An unknown group shows "Unknown tool" with a link back.
  - A group with more than one quantity gets chip tabs, using the same `chip` class as the ship links.
  - Each unit is a row: `<label>` (label and symbol), a text input with `inputmode="decimal"` (`text` for ftin), and a Copy button.
  - Editing a row makes it the source. The others show `convertFrom(...).values`.
  - The source row keeps exactly what was typed.
  - When the result is not ok, the source row shows the message (`role="alert"`) and the others go empty.
  - **Clear** empties all rows.
  - Switching the quantity tab clears the rows and saves `{ group, quantity }`.
  - A unit's `note` shows as small muted text under its label.
- **Copy:**
  - Uses `navigator.clipboard.writeText` with the row's shown text.
  - Shows `Copied` on the button for 1.5 s.
  - If the clipboard is unavailable, the button is hidden.

- [ ] **Step 1: Write failing e2e tests** in `e2e/tools.spec.ts`, using `e2e/helpers.ts` the way `voyageTime.spec.ts` does to create a ship:
  - `Tools opens offline from Home and lists groups`:
    - go offline (`context.setOffline(true)`) after the first load;
    - click the Tools card;
    - expect the 6 links;
    - `expectNoHorizontalScroll` at 360 px.
  - `length: typing metres fills the other rows`:
    - fill `m` with `12,5`;
    - expect `ft` to be `41.01` and `ftin` to be `41' 0¼"`;
    - then fill `ft` with `10`;
    - expect `m` to be `3.048`, and the `ft` field to still be `10`.
  - `invalid input marks only that row`: `m` = `-1` → alert `Must be 0 or more`, and `ft` is empty.
  - `quantity tabs and last used`:
    - open Mass & volume, then the Volume tab;
    - go back to `/tools`;
    - expect "Last used" on Mass & volume.
- [ ] **Step 2:** Run `npx playwright test e2e/tools.spec.ts --trace off`. Expected: FAIL.
- [ ] **Step 3:** Implement the routes, the lazy screens, the Home card, `Tools` and `ToolGroup`.
- [ ] **Step 4:** Run `npx playwright test e2e/tools.spec.ts --trace off && npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit with the message `Add Tools section with unit converters`.

---

### Task 4: Volume ↔ mass and SDT screens; verification

**Files:**
- Modify:
  - `src/ui/screens/tools/index.tsx`
  - `e2e/tools.spec.ts`
  - `README.md`: one line under the features list, "Tools: unit converters, volume ↔ mass, speed · distance · time with ETA".

**Interfaces:**
- Consumes:
  - Task 1's `unitsOf`, `parseUnitInput`, `formatUnit`, `toBase` and `fromBase`;
  - Task 2's `solveVolumeMass`, `parseDuration`, `formatDuration`, `solveSdt` and `etaOf`;
  - `useAppState()`'s `nowUtc` and `clockChanges`.

**Behaviour:**
- **Volume ↔ mass:**
  - Three rows: Volume, Density and Mass. Each has its own unit `<select>`. The defaults are m³, t/m³ and t, and the choices are `unitsOf('volume' | 'density' | 'mass')`.
  - The two most recently edited rows are the inputs. The third is calculated, shown in bold and read-only, with a "calculated" label.
  - Before two rows have been edited, Mass is the calculated row.
  - An invalid input shows its message, and the calculated row goes empty.
- **SDT:**
  - Three rows: Speed (kn), Distance (NM) and Time (`h:mm`, decimal h, or `1d 4h 30m`). The same two-most-recent rule applies, and Time is calculated by default.
  - Below the rows:
    - `ETA {DD MMM HH:mm} SMT (UTC{±hh:mm}) · {HH:mm} UTC`, using the existing `formatOffset` from shipTime;
    - for each change in `changesBefore`, a line `Clock change before arrival: UTC{±hh:mm} from {ship-local effective}`.
  - The ETA updates with `nowUtc`.
  - When Time is an input rather than calculated, the ETA uses that time.

- [ ] **Step 1: Add failing e2e tests:**
  - `volume-mass`: Volume `100` m³, Density `0,991` t/m³ → Mass shows `99.100` t. Changing the Mass unit to `lt` shows `97.534`.
  - `sdt`:
    - Speed `12`, Distance `120` → Time `10:00`.
    - The ETA line is visible.
    - Then set a planned clock change on the ship's time screen within 10 h. Expect the "Clock change before arrival" line.
- [ ] **Step 2:** Run `npx playwright test e2e/tools.spec.ts --trace off`. Expected: the new tests fail.
- [ ] **Step 3:** Implement `VolumeMass`, `Sdt` and the README line.
- [ ] **Step 4: Full verification:**
  - Run `npm run typecheck && npx vitest run && npx playwright test --trace off && npm run build`. Expected: everything passes.
  - From the build output, record the main chunk gzip size against `main` (build `main` first, in a temporary worktree). Expected: growth ≤ 0.5 kB, and a separate `tools` chunk exists.
- [ ] **Step 5:** Commit with the message `Add volume-mass and speed-distance-time tools`.

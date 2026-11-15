# Masterpiece — Converters (Piece 3) Design

Date: 2026-11-15
Status: Approved design (user), 2026-11-15.

## 1. Intent

- The user is a Chief Officer on a bulk carrier. They need the unit conversions used most often onboard, offline, in a few taps, on the phone and the ship's PC.
- Today they use web converters (no internet onboard), phone apps without maritime units, or mental arithmetic.
- Success means:
  - every common onboard conversion is one screen away;
  - results are exact to the official definitions;
  - one typed value shows every unit of its group at once;
  - nothing here makes the main app bigger.

## 2. Goals

1. **Four unit groups**, all chosen by the user:
   - **Length & distance:**
     - m, cm, mm, km;
     - ft, in, **ft + in** (drafts and air draft);
     - NM, cable, fathom, shackle.
   - **Mass & volume:**
     - mass: metric t, kg, long ton (LT), short ton (ST), lb;
     - volume: m³, litre, US gal, imp gal, US barrel (bbl), cu ft.
   - **Density & stowage:**
     - density: t/m³, kg/m³, kg/L, SG, API gravity, lb/ft³;
     - stowage factor: m³/t, ft³/LT, ft³/t.
   - **Speed, temperature, pressure, power:**
     - speed: kn, km/h, m/s, mph, Beaufort;
     - temperature: °C, °F, K;
     - pressure: bar, kPa, MPa, psi, kgf/cm², hPa/mbar, mmHg, inHg;
     - power: kW, hp (mechanical), PS (metric hp).
2. **Volume ↔ mass:** volume × density entered by the user = mass, and back. Any volume, density and mass unit can be used.
3. **Speed–distance–time:**
   - The user enters any two of speed (kn), distance (NM) and time; the app works out the third.
   - Time is entered as `h:mm`, decimal hours, or `d h m`.
   - It shows the **ETA from now** in ship's time and in UTC.
   - The ETA takes into account any ship's clock change planned before arrival, read from the existing ship's time data (`shipOffsetAt`). The ship's time shown at the ETA is the one in force at that moment.
4. **One value → all units:**
   - The user types a value in any unit row.
   - Every other row of that group updates live.
   - Tapping a result copies it.

## 3. Non-goals and anti-goals

**Non-goals:**
- Currency conversion. It comes with the budget tracker.
- Temperature correction of oil volumes (VCF/ASTM tables).
- Weight in air versus in vacuum.
- Draft survey.
- Time-zone and arc–time conversion.

**Anti-goals** (these would make the piece a failure even if it works):
- a wrong conversion factor;
- a result rounded so coarsely that it misleads (for example, a draft to the nearest 10 cm);
- a decimal comma read wrongly;
- the main bundle getting noticeably bigger.

## 4. Constraints

- The base-app global constraints apply: offline PWA, Preact + TypeScript, Vitest + Playwright, and English UI.
- Converters are a **lazy-loaded chunk**. The main chunk has about 2 kB of budget headroom left, and converters must not use it.
- Number entry uses the existing `parseDecimal`, so `229,5` and `229.5` are both read as 229.5. Negative values are allowed only for temperature.
- **No personal or ship data is stored.**
  - The screen only remembers the last group and unit used, in app settings.
  - SDT reads the ship's clock changes but never writes them.

## 5. Approaches considered

1. **One unit table plus one shared screen.** *Chosen by the user.*
   - Each unit is a data row: id, label, symbol, factor to the group's base unit, and display decimals.
   - Units that are not a plain multiple of the base unit get small special rules:
     - temperature;
     - ft + in;
     - API gravity;
     - Beaufort.
   - It is the cheapest to build and test, and the easiest to extend.
2. **A hand-built screen per group.** More tailored per group, but about 4× the UI work.
3. **A third-party unit library.** It has no maritime units and would make the app bigger.

## 6. Design

### 6.1 Domain (`src/domain/units/`, pure, no I/O)

- **Unit table:**
  - Each group has a base unit:
    - length: m;
    - mass: kg;
    - volume: m³;
    - density: kg/m³;
    - stowage factor: m³/t;
    - speed: m/s;
    - pressure: Pa;
    - power: W.
  - Temperature uses conversion functions instead of a factor.
- **Exact factors** (by definition, held as constants and each pinned by a test):
  - **Length:**
    - ft = 0.3048 m;
    - in = 0.0254 m;
    - NM = 1852 m;
    - cable = 185.2 m (0.1 NM);
    - fathom = 1.8288 m;
    - shackle = 27.5 m (metric shackle, user decision).
  - **Mass:**
    - lb = 0.45359237 kg;
    - LT = 2240 lb = 1016.0469088 kg;
    - ST = 2000 lb = 907.18474 kg.
  - **Volume:**
    - US gal = 3.785411784 L;
    - imp gal = 4.54609 L;
    - bbl = 42 US gal;
    - cu ft = 0.3048³ m³.
  - **Speed:**
    - kn = 1852/3600 m/s;
    - mph = 0.44704 m/s.
  - **Pressure:**
    - bar = 100 000 Pa;
    - psi = 6894.757293168 Pa;
    - kgf/cm² = 98 066.5 Pa;
    - mmHg = 133.322387415 Pa;
    - inHg = 3386.389 Pa.
  - **Power:**
    - hp = 745.69987158227022 W;
    - PS = 735.49875 W.
  - **Density:**
    - lb/ft³ = lb / ft³;
    - SG is treated as equal to t/m³. The UI states this: "SG relative to fresh water, ≈ t/m³".
    - API = 141.5 / SG − 131.5, and back. It is valid only for SG > 0.
  - **Stowage factor:**
    - ft³/LT = m³/t × 35.3147 × 1.01605. It is computed from the exact factors, not from the rounded figures shown here.
    - ft³/t (per metric tonne) is also listed.
  - **Temperature:**
    - °F = °C × 9/5 + 32;
    - K = °C + 273.15.
    - Values below absolute zero are refused.
  - **Beaufort:**
    - The WMO knot bands (0: < 1 kn, …, 12: ≥ 64 kn).
    - Typing a speed shows the Beaufort force.
    - Typing a force shows its knot range and the mid value in the other rows.
- **ft + in:**
  - Input is either two fields (ft, in) or the forms `32' 6.5"` and `32 6.5`.
  - Output is ft and inches to ¼ in, e.g. `32' 6¼"`, alongside decimal ft.
- **Display rounding:**
  - Each unit has display decimals: m 3, cm 1, ft 2, NM 2, t 3, m³ 3, kg/m³ 1, t/m³ 4, SG 4, API 1, kn 1, bar 3, psi 1, °C 1.
  - The full precision is kept internally, and copying copies the shown value.
- **Volume ↔ mass:**
  - `mass = volume × density`, with all three converted through their base units.
  - The user fills any two and the third is calculated.
- **SDT:**
  - `distance = speed × time`.
  - Zero or negative speed or time is refused.
  - The ETA is `now + time`. It is formatted with `shipOffsetAt(changes, eta)` and also shown in UTC.

### 6.2 UI

- **Home** gets a **Tools** entry, with routes `/tools`, `/tools/:group` and `/tools/sdt`, all lazy-loaded.
- **Tools page:** a list of the four groups, plus "Volume ↔ mass" and "Speed · distance · time".
- **Group page:**
  - Sub-tabs where a group mixes kinds of quantity, e.g. Mass | Volume, or Speed | Temp | Pressure | Power.
  - Each unit is one row: label, input and symbol.
  - Editing a row makes it the source and recalculates the others.
  - An invalid entry marks only that row and leaves the others empty.
  - A **Clear** button resets the group.

Sketch:
```
Length & distance                     [Clear]
 m        [ 12.500      ]
 ft       [ 41.01       ]
 ft + in  [ 41' 0¼"     ]
 NM       [ 0.01        ]
 ...
```
- **SDT page:**
  - Three inputs.
  - The last one edited of the three is calculated, and is shown in bold.
  - Below the inputs: "ETA 17 Nov 14:30 SMT (UTC+3) · 11:30 UTC".
  - When a clock change falls before the ETA, the page adds a line saying so.

### 6.3 Testing

- **Unit tests:**
  - each factor pinned against its definition;
  - round trips for every unit (convert to base and back gives the same value to 1e-9 relative);
  - known values: 1 NM = 6076.12 ft; 1 LT = 1.01605 t; SF 1.0 m³/t = 35.88 ft³/LT; API 10 = SG 1.0000; 100 kPa = 14.504 psi; 30 kn = Bf 7;
  - ft + in parsing and formatting;
  - comma decimals;
  - refusals: negative length, below absolute zero, SG ≤ 0;
  - an SDT ETA across a planned clock change.
- **Playwright:**
  - open Tools offline;
  - type in one row and see the others update;
  - copy a result;
  - SDT works out the ETA;
  - check the chunk is lazy and the main bundle budget still passes.

## 7. Left to the builder

- Exact sub-tab labels and row order inside each group. Most-used units go first: m, ft, ft + in, NM for length; t, LT, m³ for mass and volume.
- The copy feedback, such as a toast or a brief "Copied" label.

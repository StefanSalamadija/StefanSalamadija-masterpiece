import * as XLSX from 'xlsx';

/*
 * A made-up draft survey workbook in the company workbook's layout (spec §4.1). Every name, particular, draft and
 * table value here is invented; only the structure is the real one:
 *  - sheets HYDRO, INITIAL, FINAL, "FINAL (2)" and "DS Report", in that order;
 *  - HYDRO: headers in row 1 ("Draught", "Displ", "TPC", "MTC", "LCB\nfrom midship", "LCF\nfrom midship", then a blank
 *    column G, "LCF\nTabled", "LCB\nTabled"); E and F are formulas `<LBP/2>-H<n>` and `<LBP/2>-I<n>` with their
 *    cached values; one irregular row is inserted between two regular ones;
 *  - INITIAL and FINAL: the labels in merged blocks with the value in the next merged block, as in the workbook, the
 *    sheet formulas (look-ups into HYDRO!A17 / A2 on INITIAL, HYDRO!A37 on FINAL) with cached values, and FINAL's
 *    header fields as formulas on INITIAL;
 *  - "FINAL (2)" is the broken interim sheet (shorter look-up range), and "DS Report" refers to both survey sheets.
 */

/** Half the made-up LBP: the literal number in the HYDRO sheet's E and F formulas. */
const HALF_LBP = 75;

export const FAKE_SHIP = {
  name: 'Testa Marina', flag: 'Nowhere',
  lbp: 150, dF: -2.4, dM: 0.35, dA: 3.1, beam: 24.6, keelPlateCorr: 0, lightShip: 6850.4,
  summerDraught: 9.85, summerDwt: 21450.5, depth: 13.4, gt: 14980,
} as const;

/** One row of the made-up table: the HYDRO sheet's typed columns. E and F are worked out from H and I. */
export interface FakeHydroRow { draft: number; displacement: number; tpc: number; mtc: number; lcfTabled: number; lcbTabled: number }

const r1 = (x: number) => Math.round(x * 10) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

function fakeRow(draft: number): FakeHydroRow {
  return {
    draft,
    displacement: r1(2450 * draft + 95 * draft * draft),
    tpc: r3(24.5 + 1.9 * draft),
    mtc: r3(180 + 6 * draft),
    lcfTabled: r3(73 - 0.25 * draft),
    lcbTabled: r3(77.5 - 0.15 * draft),
  };
}

/** The irregular row: inserted between 5.00 and 5.10 m, after HYDRO row 37 so the look-up start rows keep their drafts. */
export const IRREGULAR_DRAFT = 5.065;

/** 1.00 m to 6.90 m in steps of 0.10 m (60 rows), plus the irregular row: 61 rows, HYDRO rows 2 to 62. */
export function fakeHydroRows(): FakeHydroRow[] {
  const rows: FakeHydroRow[] = [];
  for (let i = 0; i < 60; i++) {
    const draft = (100 + 10 * i) / 100;
    rows.push(fakeRow(draft));
    if (draft === 5) rows.push(fakeRow(IRREGULAR_DRAFT));
  }
  return rows;
}

/** HYDRO's column headers by column letter, as the workbook writes them (with line breaks). */
export const HYDRO_HEADERS: Record<string, string> = {
  A: 'Draught', B: 'Displ', C: 'TPC', D: 'MTC', E: 'LCB\nfrom midship', F: 'LCF\nfrom midship', H: 'LCF\nTabled', I: 'LCB\nTabled',
};

/** The made-up survey inputs written in each sheet. */
export const FAKE_INITIAL = {
  operation: 'Loading of', cargoTitle: 'GRAVEL', port: 'Portville', cargo: 'Gravel', terminal: 'North Quay', holds: 'H 1-3',
  date: 46000, timeFrom: 0.375, timeTill: 0.4375, windBft: 3, swell: 0.5, blQty: 0,
  drafts: { fP: 3.1, fS: 3.14, mP: 3.6, mS: 3.62, aP: 4.2, aS: 4.24 }, density: 1.02,
  deductibles: { ballast: 5210.5, freshWater: 180.2, vlsfo: 410.7, lsmgo: 55.3, lubOil: 12.1, other: 0 },
  surveyor: 'A. Surveyor', chiefOfficer: 'B. Officer',
};
export const FAKE_FINAL = {
  date: 46001, timeFrom: 0.625, timeTill: 0.6875, windBft: 4, swell: 1, blQty: 15000,
  drafts: { fP: 5.75, fS: 5.79, mP: 5.9, mS: 5.92, aP: 6.0, aS: 6.04 }, density: 1.021, comparedQty: 15020,
  deductibles: { ballast: 310.4, freshWater: 150.9, vlsfo: 395.2, lsmgo: 52.8, lubOil: 11.6, other: 0 },
  surveyor: 'A. Surveyor', chiefOfficer: 'B. Officer',
};

type Cells = Map<string, XLSX.CellObject>;

function text(cells: Cells, address: string, v: string, f?: string) {
  cells.set(address, { t: 's', v, ...(f !== undefined && { f }) });
}
function num(cells: Cells, address: string, v: number, f?: string) {
  cells.set(address, { t: 'n', v, ...(f !== undefined && { f }) });
}
function toSheet(cells: Cells, ref: string, merges: string[]): XLSX.WorkSheet {
  const sheet: XLSX.WorkSheet = {};
  for (const [address, cell] of cells) sheet[address] = cell;
  sheet['!ref'] = ref;
  sheet['!merges'] = merges.map((range) => XLSX.utils.decode_range(range));
  return sheet;
}

function hydroSheet(rows: FakeHydroRow[]): XLSX.WorkSheet {
  const cells: Cells = new Map();
  for (const [column, header] of Object.entries(HYDRO_HEADERS)) text(cells, `${column}1`, header);
  rows.forEach((row, i) => {
    const r = i + 2;
    num(cells, `A${r}`, row.draft); num(cells, `B${r}`, row.displacement); num(cells, `C${r}`, row.tpc); num(cells, `D${r}`, row.mtc);
    num(cells, `E${r}`, HALF_LBP - row.lcfTabled, `${HALF_LBP}-H${r}`);
    num(cells, `F${r}`, HALF_LBP - row.lcbTabled, `${HALF_LBP}-I${r}`);
    num(cells, `H${r}`, row.lcfTabled); num(cells, `I${r}`, row.lcbTabled);
  });
  return toSheet(cells, `A1:I${rows.length + 1}`, []);
}

/** Excel-style VLOOKUP (approximate) and the workbook's interpolation, only to give the formula cells cached values. */
function lookUp(rows: FakeHydroRow[], from: number, y: number, pick: (row: FakeHydroRow) => number): number {
  const usable = rows.slice(from - 2);
  const row = usable.filter((r) => r.draft <= y + 1e-9).at(-1) ?? usable[0];
  return row === undefined ? 0 : pick(row);
}
function interpolate(rows: FakeHydroRow[], from: number, x: number, y: number, pick: (row: FakeHydroRow) => number): number {
  const base = lookUp(rows, from, y, pick);
  return r3(base + (lookUp(rows, from, y + 0.1, pick) - base) * (x - lookUp(rows, from, x, (row) => row.draft)) * 10);
}

type Inputs = typeof FAKE_INITIAL | typeof FAKE_FINAL;

/** The rows the two survey sheets share: drafts, corrections, trim and the hydrostatic look-ups. */
function surveyBody(cells: Cells, rows: FakeHydroRow[], kind: 'INITIAL' | 'FINAL', inputs: Inputs, range: { disp: number; lcf: number; end: number }) {
  const ship = FAKE_SHIP;
  const d = inputs.drafts;
  const h = (from: number) => `HYDRO!A${from}:F${range.end}`;
  const fromInitial = kind === 'FINAL';

  text(cells, 'B11', 'LBP ='); num(cells, 'E11', ship.lbp);
  text(cells, 'H11', 'dF ='); num(cells, 'J11', ship.dF, fromInitial ? 'INITIAL!J11' : undefined); text(cells, 'M11', 'm');
  text(cells, 'P11', 'dM ='); num(cells, 'R11', ship.dM, fromInitial ? 'INITIAL!R11' : undefined); text(cells, 'U11', 'm');
  text(cells, 'X11', 'dA ='); num(cells, 'Z11', ship.dA); text(cells, 'AC11', 'm');
  text(cells, 'B12', 'Drafts'); text(cells, 'H12', 'Forward'); text(cells, 'P12', 'Midships'); text(cells, 'X12', 'Aft');

  const mean = { F: (d.fP + d.fS) / 2, M: (d.mP + d.mS) / 2, A: (d.aP + d.aS) / 2 };
  const apparentTrim = mean.A - mean.F;
  const perp = (dx: number) => Math.round((dx * apparentTrim / ship.lbp) * 1e4) / 1e4;
  const corrected = { F: mean.F + perp(ship.dF), M: mean.M + perp(ship.dM), A: mean.A + perp(ship.dA) };
  const rowsByMark: [string, number, number, number][] = [['I', d.fP, d.fS, ship.dF], ['Q', d.mP, d.mS, ship.dM], ['Z', d.aP, d.aS, ship.dA]];
  const dxCell: Record<string, string> = { I: 'J11', Q: 'R11', Z: 'Z11' };
  const unit: Record<string, string> = { I: 'M', Q: 'U', Z: 'AC' };
  text(cells, 'B13', 'Port'); text(cells, 'B14', 'Starboard'); text(cells, 'B15', 'Mean'); text(cells, 'B16', 'Keel Plate Corr.');
  text(cells, 'B17', 'Perp. Corr.'); text(cells, 'B18', 'Corrected Drafts');
  for (const [c, port, stbd, dx] of rowsByMark) {
    num(cells, `${c}13`, port); num(cells, `${c}14`, stbd);
    num(cells, `${c}15`, (port + stbd) / 2, `(${c}13+${c}14)/2`);
    num(cells, `${c}16`, ship.keelPlateCorr);
    num(cells, `${c}17`, perp(dx), `ROUND((${dxCell[c]}*I20)/E11,4)`);
    num(cells, `${c}18`, (port + stbd) / 2 + perp(dx), `${c}15+${c}16+${c}17`);
    for (let r = 13; r <= 18; r++) text(cells, `${unit[c]}${r}`, 'm');
  }

  const foreAft = (corrected.F + corrected.A) / 2;
  const meanOfMeans = (corrected.M + foreAft) / 2;
  const qm = Math.round(((corrected.M + meanOfMeans) / 2) * 1e4) / 1e4;
  const trim = corrected.A - corrected.F;
  text(cells, 'B20', 'Apparent Trim'); num(cells, 'I20', apparentTrim, 'Z15-I15'); text(cells, 'M20', 'm');
  text(cells, 'P20', 'Fore to Aft Mean'); num(cells, 'Z20', foreAft, '(I18+Z18)/2'); text(cells, 'AC20', 'm');
  text(cells, 'B21', 'Beam'); num(cells, 'I21', ship.beam, fromInitial ? 'INITIAL!I21:L21' : undefined); text(cells, 'M21', 'm');
  text(cells, 'P21', 'Mean of Means'); num(cells, 'Z21', meanOfMeans, '(Q18+Z20)/2'); text(cells, 'AC21', 'm');
  text(cells, 'B22', 'List'); text(cells, 'H22', d.mP > d.mS ? 'PORT' : 'STBD', 'IF(Q13>Q14,"PORT","STBD")');
  num(cells, 'J22', 57.3 * Math.atan(Math.abs((d.mP - d.mS) / ship.beam)), '57.3*ATAN(ABS((Q13-Q14)/I21))'); text(cells, 'M22', '°');
  text(cells, 'P22', 'Quarter Mean'); num(cells, 'Z22', qm, 'ROUND((Q18+Z21)/2,4)'); text(cells, 'AC22', 'm');
  text(cells, 'B23', 'Deflection'); text(cells, 'H23', corrected.M > foreAft ? 'SAG' : 'HOG', 'IF(Q18>Z20,"SAG","HOG")');
  num(cells, 'J23', r1(Math.abs(100 * (corrected.M - foreAft))), 'ROUND(ABS(100*(Q18-Z20)),1)'); text(cells, 'M23', 'cm');

  const vl = (from: number, x: string, y: string, col: number) =>
    `VLOOKUP(${y},${h(from)},${col})+(VLOOKUP(${y}+0.1,${h(from)},${col})-VLOOKUP(${y},${h(from)},${col}))*(${x}-VLOOKUP(${x},${h(from)},1))*10`;
  const disp = interpolate(rows, range.disp, qm, qm, (row) => row.displacement);
  const tpc = interpolate(rows, range.disp, qm, qm, (row) => row.tpc);
  const lcf = interpolate(rows, range.lcf, qm, qm, (row) => HALF_LBP - row.lcbTabled);
  const mtcPlus = interpolate(rows, range.disp, qm, qm + 0.5, (row) => row.mtc);
  const mtcMinus = interpolate(rows, range.disp, qm, qm - 0.5, (row) => row.mtc);
  const trim1 = r3(trim * tpc * lcf * 100 / ship.lbp);
  const trim2 = r3(trim * trim * (mtcPlus - mtcMinus) * 50 / ship.lbp);
  text(cells, 'B25', 'Actual Trim'); num(cells, 'I25', trim, 'Z18-I18'); text(cells, 'M25', 'm');
  text(cells, 'P25', 'Q/M Displacement'); num(cells, 'Y25', disp, `ROUND(${vl(range.disp, 'Z22', 'Z22', 2)},3)`); text(cells, 'AC25', 'MT');
  text(cells, 'B26', 'TPC'); num(cells, 'I26', tpc, `ROUND(${vl(range.disp, 'Z22', 'Z22', 3)},3)`); text(cells, 'M26', 'MT');
  text(cells, 'P26', '1st Trim Correction'); num(cells, 'Y26', trim1, 'I29'); text(cells, 'AC26', 'MT');
  text(cells, 'B27', 'LCF'); num(cells, 'I27', lcf, `ROUND(${vl(range.lcf, 'Z22', 'Z22', 6)},3)`); text(cells, 'M27', 'm');
  text(cells, 'P27', '2nd Trim Correction'); num(cells, 'Y27', trim2, 'I34'); text(cells, 'AC27', 'MT');
  text(cells, 'B28', 'LBP'); num(cells, 'I28', ship.lbp, fromInitial ? 'INITIAL!I28:L28' : undefined); text(cells, 'M28', 'm');
  text(cells, 'P28', "Displ corr'd for trim"); num(cells, 'Y28', disp + trim1 + trim2, 'Y25+Y26+Y27'); text(cells, 'AC28', 'MT');
  text(cells, 'B29', '1st Trim Correction'); num(cells, 'I29', trim1, 'ROUND(I25*I26*I27*100/I28,3)'); text(cells, 'M29', 'MT');
  const densityCell = kind === 'INITIAL' ? 'Z29' : 'Y29';
  const gross = r3((disp + trim1 + trim2) * inputs.density / 1.025);
  text(cells, 'P29', 'Density'); num(cells, densityCell, inputs.density); text(cells, 'AC29', 't/m3');
  text(cells, 'P30', 'Gross Displacement'); num(cells, 'Y30', gross, `ROUND(Y28*${densityCell}/1.025,3)`); text(cells, 'AC30', 'MT');
  const mtcVl = (y: string, y2: string) =>
    `VLOOKUP(${y},${h(range.disp)},4)+(VLOOKUP(${y2},${h(range.disp)},4)-VLOOKUP(${y},${h(range.disp)},4))*(Z22-VLOOKUP(Z22,${h(range.disp)},1))*10`;
  text(cells, 'B31', 'MTC+0.5'); num(cells, 'I31', mtcPlus, `ROUND(${mtcVl('Z22+0.5', 'Z22+0.6')},3)`); text(cells, 'M31', 'MT');
  text(cells, 'B32', 'MTC-0.5'); num(cells, 'I32', mtcMinus, `ROUND(${mtcVl('Z22-0.5', 'Z22-0.4')},3)`); text(cells, 'M32', 'MT');
  text(cells, 'B33', 'dMdZ'); num(cells, 'I33', mtcPlus - mtcMinus, 'I31-I32'); text(cells, 'M33', 'MT');
  text(cells, 'B34', '2nd Trim Correction'); num(cells, 'I34', trim2, 'ROUND(I25*I25*I33*50/I28,3)'); text(cells, 'M34', 'MT');

  const ded = inputs.deductibles;
  const total = ded.ballast + ded.freshWater + ded.vlsfo + ded.lsmgo + ded.lubOil + ded.other;
  text(cells, 'P31', 'Deductibles'); num(cells, 'Y31', total, 'I43'); text(cells, 'AC31', 'MT');
  text(cells, 'B36', 'Deductibles');
  const labels: [string, number][] = [['Ballast', ded.ballast], ['Fresh Water', ded.freshWater], ['VLSFO', ded.vlsfo], ['LSMGO', ded.lsmgo], ['Lub Oil', ded.lubOil], ['Other', ded.other]];
  labels.forEach(([label, value], i) => { text(cells, `B${37 + i}`, label); num(cells, `I${37 + i}`, value); text(cells, `M${37 + i}`, 'MT'); });
  text(cells, 'B43', 'TOTAL'); num(cells, 'I43', total, 'SUM(I37:I42)'); text(cells, 'M43', 'MT');

  text(cells, 'B47', 'Surveyor:'); text(cells, 'E47', inputs.surveyor);
  text(cells, 'O47', 'Ch. Off.:'); text(cells, 'S47', inputs.chiefOfficer);
  return { nett: gross - total };
}

/** The header block of a survey sheet: rows 2 to 9. FINAL takes the ship and voyage fields from INITIAL by formula. */
function surveyHeader(cells: Cells, kind: 'INITIAL' | 'FINAL', inputs: Inputs) {
  const i = FAKE_INITIAL;
  const fromInitial = (address: string, value: string) => kind === 'FINAL' ? text(cells, address, value, `INITIAL!${address}`) : text(cells, address, value);
  text(cells, 'H2', 'DRAFT SURVEY CALCULATION'); text(cells, 'Y2', kind);
  text(cells, 'AK2', 'Loading of'); text(cells, 'AK3', 'Discharging of');
  if (kind === 'INITIAL') { text(cells, 'H3', i.operation); text(cells, 'O3', i.cargoTitle); }
  else { text(cells, 'I3', i.operation, 'INITIAL!H3'); text(cells, 'O3', i.cargoTitle, 'INITIAL!O3'); }
  text(cells, 'B5', "Ship's Name:"); fromInitial('H5', FAKE_SHIP.name);
  text(cells, 'M5', 'Flag:'); fromInitial('P5', FAKE_SHIP.flag);
  text(cells, 'V5', 'Port:'); fromInitial('Z5', i.port);
  text(cells, 'B6', 'Summer Draught:'); fromInitial('H6', `${FAKE_SHIP.summerDraught.toFixed(2)} m`);
  text(cells, 'M6', 'Cargo:'); fromInitial('P6', i.cargo);
  text(cells, 'V6', 'Terminal:'); if (kind === 'INITIAL') text(cells, 'Z6', i.terminal);
  text(cells, 'B7', 'Summer Deadweight:'); fromInitial('H7', `${FAKE_SHIP.summerDwt} MT`);
  text(cells, 'M7', kind === 'INITIAL' ? 'Holds:' : 'Holds: '); fromInitial('P7', i.holds);
  text(cells, 'V7', 'Date:'); num(cells, 'Z7', inputs.date);
  text(cells, 'B8', 'Depth Moulded:'); fromInitial('H8', `${FAKE_SHIP.depth} m`);
  if (kind === 'INITIAL') text(cells, 'M8', 'Q-ty:', 'IF(H3=AK2,"Q-ty:","BL Q-ty:")'); else text(cells, 'M8', 'BL Q-ty:');
  num(cells, 'P8', inputs.blQty);
  text(cells, 'V8', 'Time:'); num(cells, 'Z8', inputs.timeFrom); text(cells, 'AB8', '─'); num(cells, 'AC8', inputs.timeTill);
  text(cells, 'B9', 'GT:'); fromInitial('H9', `${FAKE_SHIP.gt} MT`);
  text(cells, 'M9', kind === 'INITIAL' ? 'Weather' : 'Weather:'); text(cells, 'P9', 'Wind:'); num(cells, 'R9', inputs.windBft); text(cells, 'T9', 'BFT');
  text(cells, 'V9', 'Swell:'); num(cells, 'Z9', inputs.swell); text(cells, 'AC9', 'm');
}

/** The merged blocks both survey sheets share (rows 2 to 47 of the form, columns B to AE). */
function sharedMerges(kind: 'INITIAL' | 'FINAL'): string[] {
  const merges = ['H2:W2', 'Y2:AE2', kind === 'INITIAL' ? 'H3:N3' : 'I3:N3', 'O3:X3', 'Y3:AE3'];
  for (const r of [5, 6, 7]) merges.push(`B${r}:G${r}`, `H${r}:L${r}`, `M${r}:O${r}`, `P${r}:U${r}`, `V${r}:Y${r}`, `Z${r}:AE${r}`);
  merges.push('B8:G8', 'H8:L8', 'M8:O8', 'P8:U8', 'V8:Y8', 'Z8:AA8', 'AC8:AE8');
  merges.push('B9:G9', 'H9:L9', 'M9:O9', 'P9:Q9', 'R9:S9', 'T9:U9', 'V9:Y9', 'Z9:AB9', 'AC9:AE9');
  merges.push('B11:D11', 'E11:G11', 'H11:I11', 'J11:L11', 'M11:O11', 'P11:Q11', 'R11:T11', 'U11:W11', 'X11:Y11', 'Z11:AB11', 'AC11:AE11');
  merges.push('B12:G12', 'H12:O12', 'P12:W12', 'X12:AE12');
  for (let r = 13; r <= 18; r++) merges.push(`B${r}:G${r}`, `I${r}:L${r}`, `M${r}:O${r}`, `Q${r}:T${r}`, `U${r}:W${r}`, `Z${r}:AB${r}`, `AC${r}:AE${r}`);
  for (const r of [20, 21]) merges.push(`B${r}:G${r}`, `I${r}:L${r}`, `M${r}:N${r}`, `P${r}:W${r}`, `Z${r}:AB${r}`, `AC${r}:AE${r}`);
  merges.push('B22:G22', 'H22:I22', 'J22:L22', 'M22:N22', 'P22:W22', 'Z22:AB22', 'AC22:AE22');
  merges.push('B23:G23', 'H23:I23', 'J23:L23', 'M23:N23');
  for (let r = 25; r <= 34; r++) {
    if (r !== 30) merges.push(`B${r}:G${r}`, `I${r}:L${r}`, `M${r}:N${r}`);
    merges.push(`P${r}:W${r}`, `AC${r}:AE${r}`);
    merges.push(r === 29 ? (kind === 'INITIAL' ? 'Z29:AB29' : 'Y29:AB29') : `Y${r}:AB${r}`);
  }
  merges.push('B36:N36');
  for (let r = 37; r <= 43; r++) merges.push(`B${r}:G${r}`, `I${r}:L${r}`, `M${r}:N${r}`);
  merges.push('B47:D47', 'E47:M47', 'O47:R47', 'S47:AE47');
  return merges;
}

function initialSheet(rows: FakeHydroRow[]): { sheet: XLSX.WorkSheet; nett: number } {
  const cells: Cells = new Map();
  surveyHeader(cells, 'INITIAL', FAKE_INITIAL);
  const { nett } = surveyBody(cells, rows, 'INITIAL', FAKE_INITIAL, { disp: 17, lcf: 2, end: rows.length + 1 });
  text(cells, 'P32', 'Nett Displacement'); num(cells, 'Y32', nett, 'Y30-Y31'); text(cells, 'AC32', 'MT');
  text(cells, 'P33', 'Light Ship Weight'); num(cells, 'Y33', FAKE_SHIP.lightShip); text(cells, 'AC33', 'MT');
  text(cells, 'P34', 'Constant', 'IF(H3=AK2,"Constant","Cargo + Constant")'); num(cells, 'Y34', nett - FAKE_SHIP.lightShip, 'Y32-Y33'); text(cells, 'AC34', 'MT');
  num(cells, 'AK11', 0, 'IF(I25<0,AN12,AN13)'); num(cells, 'AN11', 0); num(cells, 'AN12', 0, 'IF(Q15<=8,0,0.3)'); num(cells, 'AN13', 0, 'AN12*-1');
  text(cells, 'P36', 'Remarks:');
  const merges = [...sharedMerges('INITIAL'), 'P36:W36', 'Z36:AB36', ...[37, 38, 39, 40, 41, 42, 43].map((r) => `P${r}:AE${r}`)];
  return { sheet: toSheet(cells, 'A1:BS102', merges), nett };
}

function finalSheet(rows: FakeHydroRow[], initialNett: number, rangeEnd: number): XLSX.WorkSheet {
  const cells: Cells = new Map();
  const f = FAKE_FINAL;
  surveyHeader(cells, 'FINAL', f);
  text(cells, 'AZ7', 'FINAL'); text(cells, 'AZ8', 'INTERIM');
  const { nett } = surveyBody(cells, rows, 'FINAL', f, { disp: 37, lcf: 37, end: rangeEnd });
  const cargo = nett - initialNett;
  text(cells, 'P32', 'Final Nett Displacement'); num(cells, 'Y32', nett, 'Y30-Y31'); text(cells, 'AC32', 'MT');
  text(cells, 'P33', 'Initial Nett Displacement'); num(cells, 'Y33', initialNett, 'INITIAL!Y32'); text(cells, 'AC33', 'MT');
  text(cells, 'AK33', 'Cargo Loaded'); text(cells, 'AK34', 'Cargo discharged'); text(cells, 'AK35', 'Shore Scale'); text(cells, 'AK36', 'B/L figure');
  text(cells, 'P34', 'Cargo Loaded', 'IF(I3=AK2,"Cargo Loaded","Cargo discharged")'); num(cells, 'Y34', cargo, '1*(Y32-Y33)'); text(cells, 'AC34', 'MT');
  text(cells, 'P37', 'Shore Scale', 'IF(P34=AK33,AK35,AK36)'); num(cells, 'Y37', f.comparedQty); text(cells, 'AC37', 'MT');
  text(cells, 'P38', 'Difference (in tons)'); num(cells, 'Y38', f.comparedQty - cargo, 'Y37-Y34'); text(cells, 'AC38', 'MT');
  text(cells, 'P39', 'Difference (percentage)'); num(cells, 'Y39', 100 * (f.comparedQty - cargo) / f.comparedQty, 'IF(Y38<0,100*Y38/Y37,(100*Y38/Y37))'); text(cells, 'AC39', '%');
  num(cells, 'BG31', 0, 'IF(P34=AK33,Y34-Y37,Y37-Y34)');
  num(cells, 'AK12', 0, 'IF(I25<0,AN13,AN14)'); num(cells, 'AN12', 0); num(cells, 'AN13', 0, 'IF(Q15<=8,0,0.3)'); num(cells, 'AN14', 0, 'AN13*-1');
  text(cells, 'S35', ' ');
  text(cells, 'P40', 'Remarks:');
  const merges = [...sharedMerges('FINAL'), 'AC35:AE35', ...[37, 38, 39].flatMap((r) => [`P${r}:W${r}`, `Y${r}:AB${r}`, `AC${r}:AE${r}`, `AN${r}:AQ${r}`]), 'P40:W40', 'AO40:AQ40', 'P41:AE45'];
  return toSheet(cells, 'A1:BV48', merges);
}

function reportSheet(): XLSX.WorkSheet {
  const cells: Cells = new Map();
  text(cells, 'B2', 'DRAFT SURVEY REPORT');
  text(cells, 'B4', 'Vessel:'); text(cells, 'F4', FAKE_SHIP.name, 'INITIAL!H5');
  text(cells, 'B5', 'Cargo:'); text(cells, 'F5', FAKE_INITIAL.cargoTitle, 'INITIAL!O3');
  text(cells, 'B6', 'Port:'); text(cells, 'F6', FAKE_INITIAL.port, 'INITIAL!Z5');
  text(cells, 'B8', 'Initial'); text(cells, 'F8', 'Final');
  num(cells, 'B9', FAKE_INITIAL.drafts.fP, 'INITIAL!I13'); num(cells, 'F9', FAKE_FINAL.drafts.fP, 'FINAL!I13');
  return toSheet(cells, 'A1:J12', []);
}

export interface SurveyWorkbookOptions {
  /** The HYDRO rows to write (default: `fakeHydroRows()`). */
  hydroRows?: FakeHydroRow[];
  /** HYDRO headers to write instead of the defaults, by column letter; `null` leaves that header out. */
  hydroHeaders?: Record<string, string | null>;
  /** A last change to the workbook before it is written, e.g. moving a label. */
  edit?: (book: XLSX.WorkBook) => void;
}

/** The made-up company workbook as .xlsx bytes. */
export function makeSurveyWorkbook(options: SurveyWorkbookOptions = {}): Uint8Array {
  const rows = options.hydroRows ?? fakeHydroRows();
  const book = XLSX.utils.book_new();
  const hydro = hydroSheet(rows);
  for (const [column, header] of Object.entries(options.hydroHeaders ?? {})) {
    if (header === null) delete hydro[`${column}1`];
    else hydro[`${column}1`] = { t: 's', v: header };
  }
  const initial = initialSheet(rows);
  XLSX.utils.book_append_sheet(book, hydro, 'HYDRO');
  XLSX.utils.book_append_sheet(book, initial.sheet, 'INITIAL');
  XLSX.utils.book_append_sheet(book, finalSheet(rows, initial.nett, rows.length + 1), 'FINAL');
  XLSX.utils.book_append_sheet(book, finalSheet(rows, initial.nett, 30), 'FINAL (2)');
  XLSX.utils.book_append_sheet(book, reportSheet(), 'DS Report');
  options.edit?.(book);
  return new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

/** Moves a cell (and the merged block it starts, if any) on a sheet: a "changed template" for the tests. */
export function moveCell(sheet: XLSX.WorkSheet, from: string, to: string): void {
  sheet[to] = sheet[from];
  delete sheet[from];
  const start = XLSX.utils.decode_cell(from);
  const target = XLSX.utils.decode_cell(to);
  for (const merge of sheet['!merges'] ?? []) {
    if (merge.s.r !== start.r || merge.s.c !== start.c) continue;
    const dr = target.r - start.r;
    const dc = target.c - start.c;
    merge.s = { r: merge.s.r + dr, c: merge.s.c + dc };
    merge.e = { r: merge.e.r + dr, c: merge.e.c + dc };
  }
}

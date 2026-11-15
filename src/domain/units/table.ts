/**
 * The units of the Tools converters. Each unit converts through its quantity's base unit: m, kg, m³, kg/m³, m³/t,
 * m/s, °C, Pa and W. Factors are built from the exact definitions, never from rounded figures.
 */
export type QuantityId = 'length' | 'mass' | 'volume' | 'density' | 'stowage' | 'speed' | 'temperature' | 'pressure' | 'power';
export type GroupId = 'length' | 'mass-volume' | 'density' | 'physical';
export type UnitKind = 'factor' | 'celsius' | 'fahrenheit' | 'kelvin' | 'api' | 'beaufort' | 'ftin';

export interface UnitDef {
  id: string;
  quantity: QuantityId;
  label: string;
  symbol: string;
  /** Decimals shown. For ft + in it is unused (always to ¼ in). */
  decimals: number;
  kind: UnitKind;
  /** Base units per 1 unit (kind `factor` only). */
  factor?: number;
  note?: string;
}

export interface GroupDef { id: GroupId; title: string; quantities: { id: QuantityId; title: string }[] }

export const GROUPS: readonly GroupDef[] = [
  { id: 'length', title: 'Length & distance', quantities: [{ id: 'length', title: 'Length' }] },
  { id: 'mass-volume', title: 'Mass & volume', quantities: [{ id: 'mass', title: 'Mass' }, { id: 'volume', title: 'Volume' }] },
  { id: 'density', title: 'Density & stowage', quantities: [{ id: 'density', title: 'Density' }, { id: 'stowage', title: 'Stowage factor' }] },
  {
    id: 'physical', title: 'Speed, temp, pressure, power',
    quantities: [{ id: 'speed', title: 'Speed' }, { id: 'temperature', title: 'Temperature' }, { id: 'pressure', title: 'Pressure' }, { id: 'power', title: 'Power' }],
  },
];

const FT = 0.3048;
const IN = 0.0254;
const NM = 1852;
const FATHOM = 6 * FT;
const LB = 0.45359237;
const LT = 2240 * LB;
const US_GAL = 231 * IN ** 3;
const CU_FT = FT ** 3;

type Row = [id: string, label: string, symbol: string, decimals: number, factor: number | UnitKind, note?: string];

function rows(quantity: QuantityId, list: Row[]): UnitDef[] {
  return list.map(([id, label, symbol, decimals, f, note]) => ({
    id, quantity, label, symbol, decimals,
    ...(typeof f === 'number' ? { kind: 'factor' as const, factor: f } : { kind: f }),
    ...(note ? { note } : {}),
  }));
}

export const UNITS: readonly UnitDef[] = [
  ...rows('length', [
    ['m', 'Metres', 'm', 3, 1],
    ['ft', 'Feet', 'ft', 2, FT],
    ['ftin', 'Feet + inches', "ft in", 2, 'ftin'],
    ['nm', 'Nautical miles', 'NM', 3, NM],
    ['cm', 'Centimetres', 'cm', 1, 0.01],
    ['mm', 'Millimetres', 'mm', 0, 0.001],
    ['km', 'Kilometres', 'km', 3, 1000],
    ['in', 'Inches', 'in', 2, IN],
    ['cable', 'Cables', 'cbl', 2, NM / 10],
    ['fathom', 'Fathoms', 'fm', 2, FATHOM],
    ['shackle', 'Shackles', 'shackle', 2, 27.5, 'metric shackle, 27.5 m'],
  ]),
  ...rows('mass', [
    ['t', 'Tonnes', 't', 3, 1000],
    ['lt', 'Long tons', 'LT', 3, LT],
    ['st', 'Short tons', 'ST', 3, 2000 * LB],
    ['kg', 'Kilograms', 'kg', 1, 1],
    ['lb', 'Pounds', 'lb', 1, LB],
  ]),
  ...rows('volume', [
    ['m3', 'Cubic metres', 'm³', 3, 1],
    ['l', 'Litres', 'L', 1, 0.001],
    ['usgal', 'US gallons', 'US gal', 1, US_GAL],
    ['impgal', 'Imperial gallons', 'imp gal', 1, 0.00454609],
    ['bbl', 'Barrels (US)', 'bbl', 2, 42 * US_GAL],
    ['cuft', 'Cubic feet', 'ft³', 2, CU_FT],
  ]),
  ...rows('density', [
    ['tm3', 'Tonnes per m³', 't/m³', 4, 1000],
    ['kgm3', 'Kilograms per m³', 'kg/m³', 1, 1],
    ['kgl', 'Kilograms per litre', 'kg/L', 4, 1000],
    ['sg', 'Specific gravity', 'SG', 4, 1000, 'relative to fresh water, ≈ t/m³'],
    ['api', 'API gravity', '°API', 1, 'api'],
    ['lbft3', 'Pounds per ft³', 'lb/ft³', 2, LB / CU_FT],
  ]),
  ...rows('stowage', [
    ['m3t', 'm³ per tonne', 'm³/t', 3, 1],
    ['ft3lt', 'ft³ per long ton', 'ft³/LT', 2, CU_FT / (LT / 1000)],
    ['ft3t', 'ft³ per tonne', 'ft³/t', 2, CU_FT],
  ]),
  ...rows('speed', [
    ['kn', 'Knots', 'kn', 1, NM / 3600],
    ['kmh', 'Kilometres per hour', 'km/h', 1, 1000 / 3600],
    ['ms', 'Metres per second', 'm/s', 2, 1],
    ['mph', 'Miles per hour', 'mph', 1, 0.44704],
    ['bf', 'Beaufort force', 'Bf', 0, 'beaufort'],
  ]),
  ...rows('temperature', [
    ['c', 'Celsius', '°C', 1, 'celsius'],
    ['f', 'Fahrenheit', '°F', 1, 'fahrenheit'],
    ['k', 'Kelvin', 'K', 2, 'kelvin'],
  ]),
  ...rows('pressure', [
    ['bar', 'Bar', 'bar', 3, 100_000],
    ['kpa', 'Kilopascals', 'kPa', 1, 1000],
    ['mpa', 'Megapascals', 'MPa', 4, 1_000_000],
    ['psi', 'Pounds per in²', 'psi', 1, 6894.757293168],
    ['kgfcm2', 'Kilogram-force per cm²', 'kgf/cm²', 3, 98_066.5],
    ['hpa', 'hPa / mbar', 'hPa', 1, 100],
    ['mmhg', 'Millimetres of mercury', 'mmHg', 1, 133.322387415],
    ['inhg', 'Inches of mercury', 'inHg', 2, 3386.389],
  ]),
  ...rows('power', [
    ['kw', 'Kilowatts', 'kW', 1, 1000],
    ['hp', 'Horsepower (mechanical)', 'hp', 1, 745.69987158227022],
    ['ps', 'Metric horsepower', 'PS', 1, 735.49875],
  ]),
];

export function unitsOf(q: QuantityId): UnitDef[] {
  return UNITS.filter((u) => u.quantity === q);
}

export function unitById(id: string): UnitDef {
  const unit = UNITS.find((u) => u.id === id);
  if (!unit) throw new Error(`Unknown unit: ${id}`);
  return unit;
}

import { useEffect, useState } from 'preact/hooks';
import { useAppState } from '../../../app/AppState';
import { useRoute } from '../../../app/router';
import { MONTH_NAMES } from '../../../domain/dates';
import { formatOffset, shipOffsetAt, toShipLocal } from '../../../domain/shipTime';
import { parseDecimal } from '../../../domain/numbers';
import { beaufortRange, convertFrom, formatUnit, fromBase, parseUnitInput, toBase } from '../../../domain/units/convert';
import { etaOf, formatDuration, parseDuration, solveSdt, solveVolumeMass } from '../../../domain/units/solve';
import { GROUPS, unitById, unitsOf, type GroupDef, type QuantityId, type UnitDef } from '../../../domain/units/table';
import './tools.css';

/** The last group and quantity used, a per-device convenience: never in the database or a backup. */
const LAST_KEY = 'masterpiece.tools.last';
interface LastUsed { group: string; quantity?: string }

function readLast(): LastUsed | undefined {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    const value = raw ? (JSON.parse(raw) as LastUsed) : undefined;
    return value && typeof value.group === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

function saveLast(value: LastUsed): void {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(value));
  } catch {
    // Storage may be blocked (private window); remembering is only a convenience.
  }
}

const canCopy = () => typeof navigator !== 'undefined' && !!navigator.clipboard?.writeText;

/** A button that copies `text`, and says "Copied" for a moment. Hidden where there is no clipboard. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  if (!canCopy()) return null;
  return (
    <button
      type="button"
      class="btn btn-small btn-outline tool-copy"
      aria-label={`Copy ${label}`}
      disabled={text === ''}
      onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true), () => undefined)}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

const EXTRA_TOOLS = [
  { href: '#/tools/volume-mass', title: 'Volume ↔ mass', detail: 'volume × density = mass, solve any one', id: 'volume-mass' },
  { href: '#/tools/sdt', title: 'Speed · distance · time', detail: 'solve any one, with ETA in ship’s time', id: 'sdt' },
];

/** `/tools`: the converters and calculators. */
export function Tools() {
  const last = readLast()?.group;
  const items = [
    ...GROUPS.map((g) => ({ href: `#/tools/${g.id}`, title: g.title, detail: g.quantities.map((q) => q.title).join(' · '), id: g.id as string })),
    ...EXTRA_TOOLS,
  ];
  return (
    <section class="screen">
      <h2>Tools</h2>
      <ul class="tool-list" role="list" aria-label="Tools">
        {items.map((item) => (
          <li key={item.id} class="card">
            <a class="tool-link" href={item.href}>
              <span class="tool-title">{item.title}</span>
              {item.id === last && <span class="tool-last">Last used</span>}
              <span class="tool-detail">{item.detail}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function BackLink() {
  return <p class="no-print"><a href="#/tools">← Tools</a></p>;
}

/** One unit's row: its label, an input, and a Copy button. */
function UnitRow({ unit, value, error, onInput }: { unit: UnitDef; value: string; error?: string; onInput: (text: string) => void }) {
  // A Beaufort force is a band, not a speed: its knot range is shown with it.
  const band = unit.kind === 'beaufort' && !error && /^\d+$/.test(value.trim()) ? beaufortRange(Number(value.trim())) : undefined;
  const inputId = `unit-input-${unit.id}`;
  const errorId = `${inputId}-error`;
  return (
    <div class="field tool-row">
      <label for={inputId}>
        {unit.label} <span class="tool-symbol">{unit.symbol}</span>
        {unit.note && <span class="tool-note">{unit.note}</span>}
      </label>
      <div class="tool-input">
        <input
          id={inputId}
          data-testid={`unit-${unit.id}`}
          type="text"
          inputMode={unit.kind === 'ftin' ? 'text' : 'decimal'}
          autoComplete="off"
          spellcheck={false}
          value={value}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? errorId : undefined}
          onInput={(e) => onInput((e.currentTarget as HTMLInputElement).value)}
        />
        <CopyButton text={value} label={unit.label} />
      </div>
      {band && <p class="tool-note">{band}</p>}
      {error && <p id={errorId} class="field-error" role="alert">{error}</p>}
    </div>
  );
}

function QuantityRows({ quantity }: { quantity: QuantityId }) {
  const [source, setSource] = useState<{ id: string; text: string }>();
  const result = source ? convertFrom(source.id, source.text) : undefined;
  return (
    <>
      <div class="tool-rows">
        {unitsOf(quantity).map((unit) => {
          const isSource = source?.id === unit.id;
          const value = isSource ? source.text : result?.ok ? (result.values[unit.id] ?? '') : '';
          const error = isSource && result && !result.ok ? result.message : undefined;
          return <UnitRow key={unit.id} unit={unit} value={value} error={error} onInput={(text) => setSource({ id: unit.id, text })} />;
        })}
      </div>
      <p class="tool-actions">
        <button type="button" class="btn btn-outline" onClick={() => setSource(undefined)}>Clear</button>
      </p>
    </>
  );
}

function GroupScreen({ group }: { group: GroupDef }) {
  const [quantity, setQuantity] = useState<QuantityId>(() => {
    const last = readLast();
    const remembered = last?.group === group.id ? group.quantities.find((q) => q.id === last.quantity) : undefined;
    return (remembered ?? group.quantities[0]).id;
  });
  useEffect(() => saveLast({ group: group.id, quantity }), [group.id, quantity]);
  return (
    <section class="screen">
      <BackLink />
      <h2>{group.title}</h2>
      {group.quantities.length > 1 && (
        <div class="chips" role="tablist" aria-label={group.title}>
          {group.quantities.map((q) => (
            <button
              key={q.id}
              type="button"
              role="tab"
              class="chip"
              aria-selected={q.id === quantity}
              aria-current={q.id === quantity ? 'page' : undefined}
              onClick={() => setQuantity(q.id)}
            >
              {q.title}
            </button>
          ))}
        </div>
      )}
      {/* A new key empties the rows when the quantity changes. */}
      <QuantityRows key={quantity} quantity={quantity} />
    </section>
  );
}

/** `/tools/:group`: one unit group, every unit at once. */
export function ToolGroup() {
  const { params } = useRoute();
  const group = GROUPS.find((g) => g.id === params.group);
  if (!group) {
    return (
      <section class="screen">
        <BackLink />
        <h2>Unknown tool</h2>
      </section>
    );
  }
  return <GroupScreen key={group.id} group={group} />;
}

const NOT_A_NUMBER = 'Not a number';
const ABOVE_ZERO = 'Must be above 0';

/** One row of a three-way calculator: it reads its text (in its chosen unit) as a base value, and shows a base value back. */
interface SolverRow<Id extends string> {
  id: Id;
  label: string;
  units?: UnitDef[];
  defaultUnit?: string;
  inputMode: 'decimal' | 'text';
  read: (text: string, unit: UnitDef | undefined) => number | undefined | string;
  show: (base: number, unit: UnitDef | undefined) => string;
}

type Read = { value?: number; error?: string };

/**
 * Three rows where any two are typed and the third is worked out: the two edited last are the inputs. Until two
 * have been typed, `defaultCalc` is the one worked out (or, if that was typed, the first row not typed).
 */
function useSolver<Id extends string>(rows: SolverRow<Id>[], defaultCalc: Id, solve: (inputs: Partial<Record<Id, number>>, calc: Id) => number | 'invalid') {
  const [texts, setTexts] = useState<Partial<Record<Id, string>>>({});
  const [order, setOrder] = useState<Id[]>([]);
  const [unitIds, setUnitIds] = useState<Partial<Record<Id, string>>>(() =>
    Object.fromEntries(rows.filter((r) => r.defaultUnit).map((r) => [r.id, r.defaultUnit])) as Partial<Record<Id, string>>);
  const inputs = order.slice(-2);
  const candidates = rows.map((r) => r.id).filter((id) => !inputs.includes(id));
  const calc = candidates.includes(defaultCalc) ? defaultCalc : candidates[0];
  const unitOf = (row: SolverRow<Id>) => (row.units ? unitById(unitIds[row.id] ?? row.units[0].id) : undefined);

  const reads = {} as Record<Id, Read>;
  for (const row of rows) {
    if (row.id === calc) continue;
    const r = row.read(texts[row.id] ?? '', unitOf(row));
    reads[row.id] = typeof r === 'number' ? { value: r } : { error: r };
  }
  const base = Object.fromEntries(rows.filter((r) => r.id !== calc && reads[r.id].value !== undefined).map((r) => [r.id, reads[r.id].value])) as Partial<Record<Id, number>>;
  const anyError = rows.some((r) => r.id !== calc && reads[r.id].error);
  const solved = anyError ? 'invalid' : solve(base, calc);
  const calcRow = rows.find((r) => r.id === calc)!;
  const calcText = solved === 'invalid' ? '' : calcRow.show(solved, unitOf(calcRow));

  return {
    calc,
    solved: solved === 'invalid' ? undefined : solved,
    base,
    unitOf,
    textOf: (row: SolverRow<Id>) => (row.id === calc ? calcText : (texts[row.id] ?? '')),
    errorOf: (row: SolverRow<Id>) => (row.id === calc ? undefined : reads[row.id].error),
    edit: (id: Id, text: string) => {
      setTexts((t) => ({ ...t, [id]: text }));
      setOrder((o) => [...o.filter((x) => x !== id), id]);
    },
    // A calculated row's value moves with its unit; a typed one is kept as typed, in the new unit.
    setUnit: (id: Id, unitId: string) => setUnitIds((u) => ({ ...u, [id]: unitId })),
    clear: () => { setTexts({}); setOrder([]); },
  };
}

function SolverRows<Id extends string>({ rows, solver }: { rows: SolverRow<Id>[]; solver: ReturnType<typeof useSolver<Id>> }) {
  return (
    <div class="tool-rows">
      {rows.map((row) => {
        const inputId = `solver-${row.id}`;
        const errorId = `${inputId}-error`;
        const isCalc = row.id === solver.calc;
        const error = solver.errorOf(row);
        const unit = solver.unitOf(row);
        const text = solver.textOf(row);
        return (
          <div key={row.id} class={`field tool-row${isCalc ? ' tool-calculated' : ''}`}>
            <div class="tool-label">
              <label for={inputId}>{row.label}</label>
              {isCalc && <span class="tool-symbol">calculated</span>}
            </div>
            <div class="tool-input">
              <input
                id={inputId}
                type="text"
                inputMode={row.inputMode}
                autoComplete="off"
                spellcheck={false}
                value={text}
                aria-invalid={error ? 'true' : undefined}
                aria-describedby={error ? errorId : undefined}
                onInput={(e) => solver.edit(row.id, (e.currentTarget as HTMLInputElement).value)}
              />
              {row.units && unit && (
                <select aria-label={`${row.label} unit`} value={unit.id} onChange={(e) => solver.setUnit(row.id, (e.currentTarget as HTMLSelectElement).value)}>
                  {row.units.map((u) => <option key={u.id} value={u.id}>{u.symbol}</option>)}
                </select>
              )}
              <CopyButton text={text} label={row.label} />
            </div>
            {error && <p id={errorId} class="field-error" role="alert">{error}</p>}
          </div>
        );
      })}
      <p class="tool-actions">
        <button type="button" class="btn btn-outline" onClick={solver.clear}>Clear</button>
      </p>
    </div>
  );
}

/** Reads a positive amount in `unit` as its base value. */
function readPositive(text: string, unit: UnitDef | undefined): number | undefined | string {
  const value = parseUnitInput(unit!, text);
  if (value === undefined) return undefined;
  if (value === 'invalid') return NOT_A_NUMBER;
  const base = toBase(unit!, value);
  return base === 'invalid' ? ABOVE_ZERO : base > 0 ? base : ABOVE_ZERO;
}

type VmId = 'volume' | 'density' | 'mass';
const VM_ROWS: SolverRow<VmId>[] = [
  { id: 'volume', label: 'Volume', units: unitsOf('volume'), defaultUnit: 'm3', inputMode: 'decimal', read: readPositive, show: (b, u) => formatUnit(u!, fromBase(u!, b)) },
  { id: 'density', label: 'Density', units: unitsOf('density'), defaultUnit: 'tm3', inputMode: 'decimal', read: readPositive, show: (b, u) => formatUnit(u!, fromBase(u!, b)) },
  { id: 'mass', label: 'Mass', units: unitsOf('mass'), defaultUnit: 't', inputMode: 'decimal', read: readPositive, show: (b, u) => formatUnit(u!, fromBase(u!, b)) },
];

/** `/tools/volume-mass`: volume × density = mass, any one worked out from the other two. No temperature correction. */
export function VolumeMass() {
  const solver = useSolver(VM_ROWS, 'mass', (v, calc) => solveVolumeMass({ volumeM3: v.volume, densityKgM3: v.density, massKg: v.mass }, calc));
  return (
    <section class="screen">
      <BackLink />
      <h2>Volume ↔ mass</h2>
      <p class="tool-note">Type any two; the third is worked out. No temperature correction.</p>
      <SolverRows rows={VM_ROWS} solver={solver} />
    </section>
  );
}

type SdtId = 'speed' | 'distance' | 'time';
function readPositiveNumber(text: string): number | undefined | string {
  const value = parseDecimal(text, { signed: true });
  if (value === undefined) return undefined;
  if (value === 'invalid') return NOT_A_NUMBER;
  return value > 0 ? value : ABOVE_ZERO;
}
const SDT_ROWS: SolverRow<SdtId>[] = [
  { id: 'speed', label: 'Speed (kn)', inputMode: 'decimal', read: readPositiveNumber, show: (b) => b.toFixed(1) },
  { id: 'distance', label: 'Distance (NM)', inputMode: 'decimal', read: readPositiveNumber, show: (b) => b.toFixed(1) },
  {
    id: 'time', label: 'Time', inputMode: 'text', show: (b) => formatDuration(b),
    read: (text) => {
      const hours = parseDuration(text);
      return hours === 'invalid' ? (parseDecimal(text) === 0 ? ABOVE_ZERO : 'Enter h:mm, hours, or 1d 4h 30m') : hours;
    },
  },
];

/** `YYYY-MM-DDTHH:mm` as `25 Oct 18:00`. */
function dayTime(dateTime: string): string {
  return `${Number(dateTime.slice(8, 10))} ${MONTH_NAMES[Number(dateTime.slice(5, 7)) - 1]} ${dateTime.slice(11, 16)}`;
}

/** `/tools/sdt`: any two of speed, distance and time give the third, and the ETA from now in ship's time. */
export function Sdt() {
  const { nowUtc, clockChanges } = useAppState();
  const solver = useSolver(SDT_ROWS, 'time', (v, calc) => solveSdt({ speedKn: v.speed, distanceNm: v.distance, hours: v.time }, calc));
  const hours = solver.calc === 'time' ? solver.solved : solver.solved !== undefined ? solver.base.time : undefined;
  const eta = hours !== undefined ? etaOf(nowUtc, hours, clockChanges) : undefined;
  const utcText = eta ? (eta.utc.slice(0, 10) === eta.shipLocal.slice(0, 10) ? eta.utc.slice(11, 16) : dayTime(eta.utc)) : '';
  return (
    <section class="screen">
      <BackLink />
      <h2>Speed · distance · time</h2>
      <p class="tool-note">Type any two; the third is worked out. Time as h:mm, hours, or 1d 4h 30m.</p>
      <SolverRows rows={SDT_ROWS} solver={solver} />
      {eta && (
        <>
          <p class="tool-eta" data-testid="eta">{`ETA ${dayTime(eta.shipLocal)} SMT (${formatOffset(eta.offsetMinutes)}) · ${utcText} UTC`}</p>
          {eta.changesBefore.map((c) => {
            const at = new Date(c.effectiveAt);
            const before = shipOffsetAt(clockChanges, new Date(at.getTime() - 1));
            return <p key={c.id} class="tool-note">{`Clock change before arrival: ${formatOffset(c.toOffsetMinutes)} from ${dayTime(toShipLocal(at, before).dateTime)}`}</p>;
          })}
        </>
      )}
    </section>
  );
}

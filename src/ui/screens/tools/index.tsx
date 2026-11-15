import { useEffect, useState } from 'preact/hooks';
import { useRoute } from '../../../app/router';
import { convertFrom } from '../../../domain/units/convert';
import { GROUPS, unitsOf, type GroupDef, type QuantityId, type UnitDef } from '../../../domain/units/table';
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

/** `/tools/volume-mass` (built in the next step). */
export function VolumeMass() {
  return <section class="screen"><BackLink /><h2>Volume ↔ mass</h2></section>;
}

/** `/tools/sdt` (built in the next step). */
export function Sdt() {
  return <section class="screen"><BackLink /><h2>Speed · distance · time</h2></section>;
}

import { useId, useMemo, useState } from 'preact/hooks';
import { useAppState } from '../../../app/AppState';
import { POTS } from '../../../budget/catalog';
import { formatMoney } from '../../../budget/money';
import { monthLabel } from '../../../budget/months';
import type { Cents, PotId } from '../../../domain/types';
// Types only: the reader comes with SheetJS, which is loaded when a file is chosen (see `readFile`).
import type { Choice, ImportChoices, LabelMapping, SheetMonth } from '../../../budget/excel/import';
import { BudgetFrame, useCurrentYm } from './Frame';
import { AMOUNT_ERROR, SelectField, TextField, inputText, typedMoney, useBusy, usePlanData } from './planKit';
import type { PlanData } from './planKit';

type Reader = typeof import('../../../budget/excel/import');
type Writer = typeof import('../../../db/budgetImport');
interface Loaded { fileName: string; months: SheetMonth[]; skipped: string[]; reader: Reader; writer: Writer }

/**
 * Reads the workbook. SheetJS is most of the app's size and only the import needs it, so it is loaded now and not with
 * the app; the service worker keeps it for offline use. A file that cannot be read gives the reason to show.
 */
async function readFile(file: File): Promise<Loaded | { problem: string }> {
  const [reader, writer, sheets] = await Promise.all([
    import('../../../budget/excel/import'), import('../../../db/budgetImport'), import('../../../domain/crewImport/readSpreadsheet'),
  ]).catch((cause: unknown) => {
    throw new Error("The spreadsheet reader couldn't be loaded. Reload the app and try again.", { cause });
  });
  try {
    const { months, skipped } = await reader.readBudgetWorkbook(await file.arrayBuffer(), file.name);
    if (months.length === 0) return { problem: 'No month sheets were found. Each month is a sheet named like "Avgust 2026" or "August 2026".' };
    return { fileName: file.name, months, skipped, reader, writer };
  } catch (err) {
    if (err instanceof sheets.SpreadsheetError) return { problem: err.message };
    throw err;
  }
}

const NEW = 'new';
const choiceValue = (c: Choice) => ('categoryId' in c ? c.categoryId : NEW);
const potLabel = (pot: string) => POTS.find((p) => p.id === pot)!.label;

/** A select of the categories a label may go to, with "New category" first. */
function CategorySelect({ label, choice, fresh, pots, data, onChange }: {
  label: string; choice: Choice; fresh: Choice; pots: PotId[]; data: PlanData; onChange: (c: Choice) => void;
}) {
  const options = data.categories.filter((c) => !c.hidden && pots.includes(c.pot));
  const freshName = 'newCategory' in fresh ? fresh.newCategory.name : label;
  return (
    <SelectField label={label} value={choiceValue(choice)} onChange={(v) => onChange(v === NEW ? fresh : { categoryId: v })}>
      <option value={NEW}>New category: {freshName}</option>
      {options.map((c) => <option key={c.id} value={c.id}>{c.group ? `${c.group} › ${c.name}` : c.name} ({potLabel(c.pot)})</option>)}
    </SelectField>
  );
}

const AREA_POTS: Record<LabelMapping['area'], PotId[]> = { needs: ['needs'], savings: ['savings', 'emergency'], debts: ['debts'] };
const AREA_NAMES: Record<LabelMapping['area'], string> = { needs: 'Needs', savings: 'Savings', debts: 'Debts' };
/** The new category a label would make. */
const freshFor = (m: LabelMapping): Choice => ({
  newCategory: { pot: AREA_POTS[m.area][0], name: m.label === '' ? 'Other' : m.label, ...(m.area === 'needs' && { group: m.group ?? 'Other' }) },
});
const labelText = (m: LabelMapping) => `${AREA_NAMES[m.area]}: ${m.label === '' ? 'lines without a name' : m.label}`;

function Review({ loaded, data, onDone }: { loaded: Loaded; data: PlanData; onDone: (text: string, lastYm: string) => void }) {
  const { db } = useAppState();
  const currentYm = useCurrentYm();
  const { reader, writer } = loaded;
  const mapping = useMemo(() => reader.mappingFor(loaded.months, data.categories), [loaded]);
  const [choices, setChoices] = useState<ImportChoices>(() => reader.defaultChoices(loaded.months, data.categories, data.debts));
  const later = loaded.months.filter((m) => m.ym > currentYm);
  const [withLater, setWithLater] = useState(false);
  const months = withLater ? loaded.months : loaded.months.filter((m) => m.ym <= currentYm);
  const bankYm = [...months].reverse().find((m) => m.ym <= currentYm)?.ym;
  const fileBank = loaded.months.find((m) => m.ym === bankYm)?.balances.bank;
  const [bankText, setBankText] = useState(inputText(fileBank));
  const bank = typedMoney(bankText, { negative: true });
  const [busy, run] = useBusy();
  const preview = reader.previewImport(months, choices, data.categories, data.entries);
  const unknown = mapping.filter((m) => !m.known);
  const known = mapping.filter((m) => m.known);
  const differing = preview.filter((p) => p.pots.some((x) => (x.difference ?? 0) !== 0));
  const replaces = preview.reduce((n, p) => n + p.replaces, 0);
  const hasDebt = months.some((m) => m.balances.debts !== undefined);
  const setChoice = (key: string, c: Choice) => setChoices({ ...choices, mapping: { ...choices.mapping, [key]: c } });
  const select = (m: LabelMapping) => (
    <CategorySelect key={m.key} label={labelText(m)} choice={choices.mapping[m.key]} fresh={m.known ? freshFor(m) : m.choice}
      pots={AREA_POTS[m.area]} data={data} onChange={(c) => setChoice(m.key, c)} />
  );
  const wantsFresh: Choice = { newCategory: { pot: 'wants', name: 'Other wants' } };

  return (
    <>
      <p>
        {months.length === 1 ? `1 month: ${monthLabel(months[0].ym)}.` : months.length === 0 ? 'No month to import.' : `${months.length} months: ${monthLabel(months[0].ym)} to ${monthLabel(months[months.length - 1].ym)}.`}
        {loaded.skipped.length > 0 && ` Other sheets are left out: ${loaded.skipped.join(', ')}.`}
      </p>
      {later.length > 0 && (
        <label class="check">
          <input type="checkbox" checked={withLater} onChange={(e) => setWithLater(e.currentTarget.checked)} />
          Also import the {later.length === 1 ? 'month' : `${later.length} months`} after {monthLabel(currentYm)}, as planned items to confirm
        </label>
      )}

      <section class="budget-section" aria-label="Categories">
        {unknown.length === 0 ? <p>Every line matches a category.</p> : (
          <>
            <p>{unknown.length === 1 ? '1 label has' : `${unknown.length} labels have`} no category yet: each becomes a new category, or choose one.</p>
            <div class="form-grid">{unknown.map(select)}</div>
          </>
        )}
        <details class="import-adjust">
          <summary>Adjust</summary>
          {known.map(select)}
          <CategorySelect label="Wants lines" choice={choices.wants} fresh={wantsFresh} pots={['wants']} data={data} onChange={(c) => setChoices({ ...choices, wants: c })} />
          <p class="helper-text">Wants lines are kept as notes. One that names a Wants category goes there; the rest go to the category chosen here.</p>
        </details>
      </section>

      {hasDebt && (
        <SelectField label="The debt balance (STANJA) is" value={choices.debtId ?? ''} onChange={(v) => setChoices({ ...choices, debtId: v === '' ? undefined : v })}>
          {data.debts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          <option value="new">A new debt, “{writer.IMPORTED_DEBT_NAME}”</option>
          <option value="">Not imported</option>
        </SelectField>
      )}
      {bankYm !== undefined && (
        <TextField label={`Bank & cash at the end of ${monthLabel(bankYm)}`} value={bankText} inputMode="decimal" onInput={setBankText}
          hint="The workbook has no bank balance: the forecast starts from it. Leave it empty to enter it later." error={bank === 'invalid' ? AMOUNT_ERROR : undefined} />
      )}

      <section class="budget-section" aria-label="Preview">
        <h3>Preview</h3>
        {differing.length > 0 && (
          <p class="field-warning budget-warning">
            {differing.length === 1 ? '1 month differs' : `${differing.length} months differ`} from the sheet's own totals: the app adds the lines up again.
          </p>
        )}
        {replaces > 0 && <p class="helper-text">{replaces === 1 ? '1 entry imported before is' : `${replaces} entries imported before are`} replaced. Entries added in the app stay.</p>}
        <div class="table-scroll">
          <table class="budget-table">
            <caption>Totals per pot</caption>
            <thead>
              <tr><th scope="col">Month</th><th scope="col">Planned income</th>{POTS.map((p) => <th key={p.id} scope="col">{p.label}</th>)}<th scope="col">Entries</th></tr>
            </thead>
            <tbody>
              {preview.map((p) => (
                <tr key={p.ym}>
                  <th scope="row">{monthLabel(p.ym)}</th>
                  <td>{p.plannedIncome === undefined ? '—' : formatMoney(p.plannedIncome)}</td>
                  {p.pots.map((x) => (
                    <td key={x.pot}>
                      {formatMoney(x.total)}
                      {(x.difference ?? 0) !== 0 && <span class="field-warning"> (sheet {formatMoney(x.sheet as Cents)})</span>}
                    </td>
                  ))}
                  <td>{p.entries}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p class="helper-text">A snapshot is taken first, so the import can be undone from Backups.</p>
        <div class="row-actions">
          <button type="button" class="btn btn-primary" disabled={busy || months.length === 0 || bank === 'invalid'} onClick={() => {
            const final: ImportChoices = { ...choices, ...(typeof bank === 'number' && bankYm !== undefined ? { bank: { ym: bankYm, balance: bank } } : { bank: undefined }) };
            run(async () => {
              const result = await writer.importBudget(db, months, final, loaded.fileName, currentYm);
              onDone(`Imported ${result.months === 1 ? '1 month' : `${result.months} months`}, ${result.entries} entries.`, months[months.length - 1].ym);
            });
          }}>
            Import {months.length === 1 ? '1 month' : `${months.length} months`}
          </button>
        </div>
      </section>
    </>
  );
}

function ImportBody() {
  const data = usePlanData();
  const fileId = useId();
  const [loaded, setLoaded] = useState<Loaded>();
  const [problem, setProblem] = useState('');
  const [done, setDone] = useState<{ text: string; ym: string }>();
  const [busy, run] = useBusy();

  if (done) {
    return (
      <>
        <p class="live" role="status">{done.text}</p>
        <ul class="budget-lines">
          <li><a href={`#/budget/month/${done.ym}`}>Go to {monthLabel(done.ym)}</a></li>
          <li><a href="#/budget">Go to the dashboard</a></li>
        </ul>
      </>
    );
  }
  return (
    <div class="import-form">
      <div class="field">
        <label for={fileId}>Budget workbook</label>
        <input id={fileId} type="file" accept=".xlsx,.xls" aria-invalid={problem ? 'true' : undefined} disabled={busy}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (!file) return;
            setProblem('');
            setLoaded(undefined);
            run(async () => {
              const result = await readFile(file);
              if ('problem' in result) setProblem(result.problem);
              else setLoaded(result);
            });
          }} />
        <p class="helper-text">Your Excel budget, a sheet per month named like "Avgust 2026". It is read on this device and goes nowhere else.</p>
        {problem && <p class="field-error" role="alert">{problem}</p>}
      </div>
      {loaded && (data ? <Review key={loaded.fileName + loaded.months.length} loaded={loaded} data={data} onDone={(text, ym) => setDone({ text, ym })} /> : <p class="live" role="status">Loading…</p>)}
    </div>
  );
}

/**
 * `/budget/import` (base §3.9, v2 §3.9.3): reads the user's own workbook, maps its labels to categories (one step when
 * all of them match; "Adjust" for the rest), asks for the bank balance, previews the months' totals against the
 * sheet's own, and imports after a snapshot. Importing again replaces that month's imported entries only.
 */
export function ImportBudget() {
  return <BudgetFrame title="Import from Excel"><ImportBody /></BudgetFrame>;
}

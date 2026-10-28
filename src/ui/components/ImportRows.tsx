import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { rankLabel } from '../../domain/catalogues';
import { fullName } from '../../domain/crew';
import type { PreviewRow } from '../../domain/crewImport/preview';
import type { CrewDraft, CrewMember, FieldError } from '../../domain/types';
import { crewFormOf, crewFormProblems, problemsByControl } from '../crewForm';
import type { CrewControl, CrewForm } from '../crewForm';
import { changeText, errorParts, overridesFromForm, statusText } from '../crewImportView';
import { CrewFields } from './CrewFields';

/** The one row being fixed: the crew form with the row as it is now. Only what the user changes is a fix. Nothing else of the wizard is on screen meanwhile. */
export function FixRow({ row, crew, today, onDone, onCancel }: {
  row: PreviewRow;
  crew: CrewMember[];
  today: string;
  /** What the user changed, as fixes over what the file says. */
  onDone: (overrides: Partial<CrewDraft>) => void;
  onCancel: () => void;
}) {
  const problemsOf = (form: CrewForm): Map<CrewControl, FieldError> =>
    problemsByControl(crewFormProblems(form, today, { id: row.existingId, signOffDate: row.draft.signOffDate, crew }), form);
  const [form, setForm] = useState(() => crewFormOf(row.draft));
  // What is wrong now is shown from the start: the user came here to fix it.
  const [changed, setChanged] = useState<ReadonlySet<CrewControl>>(() => new Set(problemsOf(crewFormOf(row.draft)).keys()));
  const [attempted, setAttempted] = useState(false);
  const controls = useRef<Partial<Record<CrewControl, HTMLElement | null>>>({});
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  const problems = problemsOf(form);
  const shown = (control: CrewControl): FieldError | undefined => {
    const found = problems.get(control);
    return found && (found.severity === 'warning' || attempted || changed.has(control)) ? found : undefined;
  };

  function done(event: Event): void {
    event.preventDefault();
    const overrides = overridesFromForm(row.draft, form);
    if (overrides) {
      onDone(overrides);
      return;
    }
    // No rank chosen yet: there is nothing to fix the row with.
    setAttempted(true);
    controls.current.rank?.focus();
  }

  return (
    <section class="screen">
      <h2 ref={heading} tabIndex={-1}>{`Fix row ${row.rowNumber}`}</h2>
      <form class="crew-form" onSubmit={done} noValidate>
        <CrewFields
          form={form} shown={shown}
          refFor={(control) => (element) => { controls.current[control] = element; }}
          onChange={(control, value) => {
            setForm((current) => ({ ...current, [control]: value }));
            setChanged((current) => new Set(current).add(control));
          }}
        />
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Done</button>
          <button type="button" class="btn btn-outline" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </section>
  );
}

export function PreviewItem({ row, updates, onFix, onSkip }: {
  row: PreviewRow;
  /** The sign-on date of the saved contract this row updates, when it does. */
  updates?: string;
  onFix: () => void;
  onSkip: (skip: boolean) => void;
}) {
  const nameId = useId();
  const name = fullName(row.draft) || '(no name)';
  const detail = [rankLabel(row.draft), row.draft.passportNo && `Passport ${row.draft.passportNo}`].filter(Boolean).join(' · ');
  const status = statusText(row);
  return (
    <li id={`import-row-${row.rowNumber}`} class="card import-row" tabIndex={-1} data-skipped={row.skip}>
      <div class="import-row-head">
        <div class="import-row-who">
          <span class="import-row-number">{`Row ${row.rowNumber}`}</span>
          <span id={nameId} class="import-row-name">{name}</span>
          <span class="crew-row-meta">{detail}</span>
        </div>
        <span class="import-status" data-status={status === 'No changes' ? 'same' : row.status}>{status}</span>
      </div>
      {row.errors.map((error, index) => {
        const { label, message } = errorParts(error, row.draft);
        return (
          <p key={index} class={error.severity === 'error' ? 'field-error' : 'field-warning'}>
            {label && <strong>{label}: </strong>}{message}
          </p>
        );
      })}
      {updates !== undefined && row.changes.length > 0 && <p class="import-change">{`Updates the contract from ${updates}`}</p>}
      {row.changes.map((change) => <p key={change.field} class="import-change">{changeText(change)}</p>)}
      <div class="row-actions">
        {row.status === 'error' && (
          <button type="button" class="btn btn-outline btn-small" aria-describedby={nameId} onClick={onFix}>Fix</button>
        )}
        <label class="check">
          <input type="checkbox" checked={row.skip} aria-describedby={nameId} onChange={(event) => onSkip(event.currentTarget.checked)} />
          <span>Skip</span>
        </label>
      </div>
    </li>
  );
}

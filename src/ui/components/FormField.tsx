import type { ComponentChildren } from 'preact';
import { useId, useState } from 'preact/hooks';
import type { FieldDef, FormValue } from '../../forms/types';
import { choiceControl, isLongText } from '../formFill';

/*
 * One question of the fill screen: the input for a field of a form, chosen by its kind (spec §10, Task 15). The label,
 * the options and the note come from the form or the ship's data and are shown as text only.
 *
 * Values are the draft's canonical values (rulings R2): a date input gives ISO `YYYY-MM-DD`, a time input `HH:mm`, a
 * checkbox a boolean, a choice the text of its option; text and numbers keep what was typed (a number is a text input
 * with the decimal keyboard, checked with `parseDecimal` by the screen). A `picture` field shows nothing here: photos have
 * their own control (`PhotoField`).
 *
 * The helpers add to a field (Task 16): a `Now` button beside a time, a line `Last: <value>` under a value that is not
 * the last file's, an alarm warning under a reading, and, for a text field such as a job's Responsible, a list of the
 * people onboard to choose from (with `Someone else` for a name that is not in it).
 */

export interface FormFieldProps {
  field: FieldDef;
  value: FormValue;
  onChange: (value: FormValue) => void;
  /** The value was filled in from the ship's data and has not been edited: marked `Auto` beside the label. */
  auto?: boolean;
  /** A line under the input, such as `No Master onboard`. */
  note?: string;
  /** Why the value cannot be used (shown once the field was left, or Make file was tried). Marks the input invalid. */
  error?: string;
  /** The input was left, so that its error is shown from then on. */
  onLeave?: () => void;
  /** Put on the input as `data-key`, so the screen can find it (to focus the first invalid one). */
  dataKey?: string;
  /** Puts the ship's time now in the field: shows a `Now` button beside it. */
  onNow?: () => void;
  /** An alarm warning under the input (`role="alert"`). Advice only: it is never written to the file. */
  warning?: string;
  /** `Last: <value>` under the input, for a value that is not the last file's. */
  last?: string;
  /** A text field offered as a choice among these (the people onboard), besides any other text. */
  choices?: string[];
  /** More under the field. */
  children?: ComponentChildren;
}

/** The value of the `Someone else` option of a list of choices; no person's name is this. */
const OTHER = '\u0000other';
const text = (value: FormValue): string => (typeof value === 'string' ? value : '');

export function FormField({ field, value, onChange, auto, note, error, onLeave, dataKey, onNow, warning, last, choices, children }: FormFieldProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const autoId = `${id}-auto`;
  const noteId = `${id}-note`;
  const errorId = `${id}-error`;
  const warningId = `${id}-warning`;
  const lastId = `${id}-last`;
  const [other, setOther] = useState(false);
  const describedBy = [auto && autoId, note && noteId, error && errorId, warning && warningId, last && lastId].filter(Boolean).join(' ') || undefined;
  const invalid = error ? true : undefined;
  const common = { 'aria-describedby': describedBy, 'aria-invalid': invalid, 'data-key': dataKey, onBlur: onLeave };

  const mark = auto ? <span id={autoId} class="auto-mark">Auto</span> : null;
  const under = (
    <>
      {note && <p id={noteId} class="helper-text">{note}</p>}
      {error && <p id={errorId} class="field-error" role="alert">{error}</p>}
      {warning && <p id={warningId} class="field-warning" role="alert">{warning}</p>}
      {last && <p id={lastId} class="helper-text">{last}</p>}
      {children}
    </>
  );

  if (field.kind === 'picture') return null;

  if (field.kind === 'checkbox') {
    return (
      <div class="fill-field">
        <div class="field-head">
          <label class="check">
            <input type="checkbox" checked={value === true} {...common} onChange={(event) => onChange(event.currentTarget.checked)} />
            <span>{field.label}</span>
          </label>
          {mark}
        </div>
        {under}
      </div>
    );
  }

  if (field.kind === 'choice') {
    const options = field.options ?? [];
    if (choiceControl(field) === 'buttons') {
      // A row of buttons: one tap chooses, a tap on the chosen one clears it.
      return (
        <div class="field fill-field">
          <div class="field-head"><span id={labelId} class="field-label">{field.label}</span>{mark}</div>
          <div class="segmented" role="group" aria-labelledby={labelId} aria-describedby={describedBy} onFocusOut={onLeave}>
            {options.map((option) => (
              <button
                key={option} type="button" class="btn btn-outline btn-small" aria-pressed={value === option} data-key={dataKey}
                onClick={() => onChange(value === option ? null : option)}
              >
                {option}
              </button>
            ))}
          </div>
          {under}
        </div>
      );
    }
    const current = text(value);
    return (
      <div class="field fill-field">
        <div class="field-head"><label for={id}>{field.label}</label>{mark}</div>
        <select id={id} value={current} {...common} onChange={(event) => onChange(event.currentTarget.value === '' ? null : event.currentTarget.value)}>
          <option value="">Not chosen</option>
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
          {/* A value that is no longer an option (the form changed) is kept and shown, not silently dropped. */}
          {current !== '' && !options.includes(current) && <option value={current}>{current}</option>}
        </select>
        {under}
      </div>
    );
  }

  if (choices && field.kind === 'text') {
    // A single choice among the people onboard; a name that is not in the list is typed under `Someone else`.
    const current = text(value);
    const typed = other || (current !== '' && !choices.includes(current));
    return (
      <div class="field fill-field">
        <div class="field-head"><label for={id}>{field.label}</label>{mark}</div>
        <select
          id={id} value={typed ? OTHER : current} {...common}
          onChange={(event) => {
            const chosen = event.currentTarget.value;
            setOther(chosen === OTHER);
            onChange(chosen === '' || chosen === OTHER ? null : chosen);
          }}
        >
          <option value="">Not chosen</option>
          {choices.map((name) => <option key={name} value={name}>{name}</option>)}
          <option value={OTHER}>Someone else</option>
        </select>
        {typed && (
          <input
            type="text" aria-label={`${field.label}, someone else`} autocomplete="off" value={current} onInput={(event) => onChange(event.currentTarget.value)}
            onBlur={onLeave}
          />
        )}
        {under}
      </div>
    );
  }

  const input = (() => {
    if (isLongText(field)) {
      return <textarea id={id} rows={3} value={text(value)} {...common} onInput={(event) => onChange(event.currentTarget.value)} />;
    }
    const type = field.kind === 'date' ? 'date' : field.kind === 'time' ? 'time' : 'text';
    return (
      <input
        id={id} type={type as 'text'} value={text(value)} autocomplete="off" inputMode={field.kind === 'number' ? 'decimal' : undefined}
        {...common} onInput={(event) => onChange(event.currentTarget.value)}
      />
    );
  })();

  return (
    <div class="field fill-field">
      <div class="field-head"><label id={labelId} for={id}>{field.label}</label>{mark}</div>
      {onNow ? (
        <div class="input-row">
          {input}
          <button type="button" class="btn btn-outline btn-small" aria-describedby={labelId} onClick={onNow}>Now</button>
        </div>
      ) : input}
      {under}
    </div>
  );
}

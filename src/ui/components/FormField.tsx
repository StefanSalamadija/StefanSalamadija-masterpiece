import type { ComponentChildren } from 'preact';
import { useId } from 'preact/hooks';
import type { FieldDef, FormValue } from '../../forms/types';
import { choiceControl, isLongText } from '../formFill';

/*
 * One question of the fill screen: the input for a field of a form, chosen by its kind (spec §10, Task 15). The label,
 * the options and the note come from the form or the ship's data and are shown as text only.
 *
 * Values are the draft's canonical values (rulings R2): a date input gives ISO `YYYY-MM-DD`, a time input `HH:mm`, a
 * checkbox a boolean, a choice the text of its option; text and numbers keep what was typed (a number is a text input
 * with the decimal keyboard, checked with `parseDecimal` by the screen). A `picture` field shows nothing here: photos
 * come with Task 16, which adds its own control.
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
  /** More under the field, for Task 16's helpers (a `Now` button, an alarm warning). */
  children?: ComponentChildren;
}

const text = (value: FormValue): string => (typeof value === 'string' ? value : '');

export function FormField({ field, value, onChange, auto, note, error, onLeave, dataKey, children }: FormFieldProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const autoId = `${id}-auto`;
  const noteId = `${id}-note`;
  const errorId = `${id}-error`;
  const describedBy = [auto && autoId, note && noteId, error && errorId].filter(Boolean).join(' ') || undefined;
  const invalid = error ? true : undefined;
  const common = { 'aria-describedby': describedBy, 'aria-invalid': invalid, 'data-key': dataKey, onBlur: onLeave };

  const mark = auto ? <span id={autoId} class="auto-mark">Auto</span> : null;
  const under = (
    <>
      {note && <p id={noteId} class="helper-text">{note}</p>}
      {error && <p id={errorId} class="field-error" role="alert">{error}</p>}
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
      <div class="field-head"><label for={id}>{field.label}</label>{mark}</div>
      {input}
      {under}
    </div>
  );
}

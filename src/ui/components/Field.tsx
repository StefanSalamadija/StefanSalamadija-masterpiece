import type { Ref } from 'preact';
import { useId } from 'preact/hooks';
import type { FieldError } from '../../domain/types';

export interface FieldProps {
  label: string;
  value: string;
  onInput: (value: string) => void;
  type?: 'text' | 'number' | 'date' | 'datetime-local';
  /** The on-screen keyboard to offer. Numbers are typed as text with `decimal` or `numeric`, then read with `parseDecimal`. */
  inputMode?: 'decimal' | 'numeric';
  /** An error is announced (`role="alert"`) and marks the input invalid; a warning is only shown. */
  error?: FieldError;
  /** For moving focus to the input, such as after a failed submit. A multi-line field takes none. */
  inputRef?: Ref<HTMLInputElement>;
  /** Several lines of free text, such as remarks, instead of one line. */
  multiline?: boolean;
}

/** A labelled input (or a text box, when `multiline`) with its validation message underneath. */
export function Field({ label, value, onInput, type = 'text', inputMode, error, inputRef, multiline }: FieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const isError = error?.severity === 'error';
  return (
    <div class="field">
      <label for={id}>{label}</label>
      {multiline ? (
        <textarea
          id={id} rows={3} value={value}
          aria-invalid={isError ? 'true' : undefined} aria-describedby={error ? messageId : undefined}
          onInput={(event) => onInput(event.currentTarget.value)}
        />
      ) : (
        <input
          // Preact types `<input>` as a union keyed by `type`; all four types here take the same attributes.
          id={id} ref={inputRef} type={type as 'text'} inputMode={inputMode} value={value} autocomplete="off"
          step={type === 'number' ? 'any' : undefined}
          aria-invalid={isError ? 'true' : undefined} aria-describedby={error ? messageId : undefined}
          onInput={(event) => onInput(event.currentTarget.value)}
        />
      )}
      {error && (isError
        ? <p id={messageId} class="field-error" role="alert">{error.message}</p>
        : <p id={messageId} class="field-warning warning">{error.message}</p>)}
    </div>
  );
}

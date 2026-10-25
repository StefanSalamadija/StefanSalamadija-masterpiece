import type { Ref } from 'preact';
import { useId } from 'preact/hooks';
import type { FieldError } from '../../domain/types';

export interface FieldProps {
  label: string;
  value: string;
  onInput: (value: string) => void;
  type?: 'text' | 'number' | 'date' | 'datetime-local';
  /** An error is announced (`role="alert"`) and marks the input invalid; a warning is only shown. */
  error?: FieldError;
  /** For moving focus to the input, such as after a failed submit. */
  inputRef?: Ref<HTMLInputElement>;
}

/** A labelled input with its validation message underneath. */
export function Field({ label, value, onInput, type = 'text', error, inputRef }: FieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const isError = error?.severity === 'error';
  return (
    <div class="field">
      <label for={id}>{label}</label>
      <input
        // Preact types `<input>` as a union keyed by `type`; all four types here take the same attributes.
        id={id} ref={inputRef} type={type as 'text'} value={value} autocomplete="off"
        step={type === 'number' ? 'any' : undefined}
        aria-invalid={isError ? 'true' : undefined} aria-describedby={error ? messageId : undefined}
        onInput={(event) => onInput(event.currentTarget.value)}
      />
      {error && (isError
        ? <p id={messageId} class="field-error" role="alert">{error.message}</p>
        : <p id={messageId} class="field-warning warning">{error.message}</p>)}
    </div>
  );
}

import type { RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { reportError } from '../../app/errors';
import type { FieldError } from '../../domain/types';
import { passcodeProblem } from '../lockView';
import { Field } from './Field';

export interface PasscodeFormProps {
  /** Offer "Also unlock with fingerprint" (this phone has a sensor). It starts ticked. */
  fingerprintOffered: boolean;
  submitLabel: string;
  /** Runs with a passcode that passed the checks. A failure is shown in the error toast and the form stays as it is. */
  onSubmit: (pin: string, withFingerprint: boolean) => Promise<void>;
  /** The button beside the submit button: "Skip for now", "Cancel". */
  secondary: { label: string; onClick: () => Promise<void> | void };
  /** Puts the focus in the first field when the form appears. */
  autoFocus?: boolean;
  /** Gives the first field to the caller, such as for a dialog that closes as the form opens to hand the focus to. */
  passcodeRef?: RefObject<HTMLInputElement | null>;
}

type Problems = { pin?: FieldError; repeat?: FieldError };

/**
 * The fields shared by the protect step and the App lock section: a new passcode and its repeat, the fingerprint box where
 * the phone has a sensor, and two buttons. The first problem found is shown on its field and gets the focus. While an
 * action runs both buttons are `aria-disabled` (not `disabled`, which would take the focus away) and a second tap is ignored.
 */
export function PasscodeForm({ fingerprintOffered, submitLabel, onSubmit, secondary, autoFocus, passcodeRef }: PasscodeFormProps) {
  const [pin, setPin] = useState('');
  const [repeat, setRepeat] = useState('');
  const [withFingerprint, setWithFingerprint] = useState(true);
  const [problems, setProblems] = useState<Problems>({});
  const [busy, setBusy] = useState(false);
  // Set at once, where `busy` is only seen by the next render: a second tap in between must not run an action twice.
  const running = useRef(false);
  const ownPinInput = useRef<HTMLInputElement>(null);
  const pinInput = passcodeRef ?? ownPinInput;
  const repeatInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) pinInput.current?.focus();
  }, [autoFocus]);

  async function guarded(action: () => Promise<void> | void): Promise<void> {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await action();
    } catch (err) {
      reportError(err);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  function submit(event: Event): void {
    event.preventDefault();
    if (running.current) return;
    const problem = passcodeProblem(pin, repeat);
    if (problem) {
      setProblems({ [problem.field]: { field: problem.field, severity: 'error', message: problem.message } });
      (problem.field === 'pin' ? pinInput : repeatInput).current?.focus();
      return;
    }
    setProblems({});
    void guarded(() => onSubmit(pin, fingerprintOffered && withFingerprint));
  }

  return (
    <form class="lock-form" onSubmit={submit} noValidate>
      <Field
        label="New passcode" type="password" inputMode="numeric" maxLength={4} value={pin} error={problems.pin} inputRef={pinInput}
        onInput={(value) => {
          setPin(value);
          setProblems({});
        }}
      />
      <Field
        label="Repeat passcode" type="password" inputMode="numeric" maxLength={4} value={repeat} error={problems.repeat} inputRef={repeatInput}
        onInput={(value) => {
          setRepeat(value);
          setProblems({});
        }}
      />
      {fingerprintOffered && (
        <label class="check">
          <input type="checkbox" checked={withFingerprint} onChange={(event) => setWithFingerprint(event.currentTarget.checked)} />
          <span>Also unlock with fingerprint</span>
        </label>
      )}
      <div class="form-actions">
        <button type="submit" class="btn btn-primary" aria-disabled={busy ? 'true' : undefined}>{submitLabel}</button>
        <button type="button" class="btn btn-outline" aria-disabled={busy ? 'true' : undefined} onClick={() => void guarded(secondary.onClick)}>
          {secondary.label}
        </button>
      </div>
    </form>
  );
}

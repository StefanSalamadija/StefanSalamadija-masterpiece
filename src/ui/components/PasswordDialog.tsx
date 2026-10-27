import type { ComponentChildren, RefObject } from 'preact';
import { useRef, useState } from 'preact/hooks';
import type { FieldError } from '../../domain/types';
import { passwordProblems } from '../settingsView';
import type { PasswordProblems } from '../settingsView';
import { useDialogAction } from '../useDialogAction';
import { ConfirmDialog } from './ConfirmDialog';
import { Field } from './Field';

/** Said on the first export on a device: a password that is forgotten cannot be recovered. */
export const KEEP_PASSWORD_SAFE = 'Keep this password safe. If you forget it, nobody can open this backup — not even Masterpiece.';

export interface PasswordDialogProps {
  title: string;
  /** What the file is, above the fields. */
  intro?: ComponentChildren;
  /** The first export on this device: adds the warning that a forgotten password cannot be recovered. */
  showWarning: boolean;
  /** Both fields start with it (masked): a password remembered for this session. */
  initialPassword?: string;
  /** Offers `Remember until the app is closed`, ticked. A handover file's password is never remembered, so it does not offer it. */
  offerRemember: boolean;
  /** Does the export with the password and whether to remember it, and closes the dialog. A failure is shown in the dialog, which stays open. */
  onSubmit: (password: string, remember: boolean) => Promise<void>;
  onCancel: () => void;
  focusFallback: RefObject<HTMLElement | null>;
}

const problem = (field: string, message: string | undefined): FieldError | undefined =>
  message === undefined ? undefined : { field, severity: 'error', message };

/**
 * Asks for the password an export is sealed with, twice. The password is checked before anything is written: at least 8
 * characters, and the repeat the same. It is only ever kept in memory (see `rememberPassword`), never stored.
 */
export function PasswordDialog({
  title, intro, showWarning, initialPassword = '', offerRemember, onSubmit, onCancel, focusFallback,
}: PasswordDialogProps) {
  const [password, setPassword] = useState(initialPassword);
  const [repeat, setRepeat] = useState(initialPassword);
  const [remember, setRemember] = useState(true);
  const [problems, setProblems] = useState<PasswordProblems>({});
  const { busy, failure, run } = useDialogAction();
  const passwordInput = useRef<HTMLInputElement>(null);
  const repeatInput = useRef<HTMLInputElement>(null);

  function confirm(): void {
    const found = passwordProblems(password, repeat);
    if (found.password !== undefined || found.repeat !== undefined) {
      setProblems(found);
      (found.password !== undefined ? passwordInput : repeatInput).current?.focus();
      return;
    }
    void run(() => onSubmit(password, offerRemember && remember));
  }

  return (
    <ConfirmDialog
      title={title} confirmLabel="Export" busy={busy} error={failure} focusFallback={focusFallback}
      onConfirm={confirm} onCancel={onCancel}
      body={
        <>
          {intro}
          {showWarning && <p class="field-warning">{KEEP_PASSWORD_SAFE}</p>}
          <Field
            label="Backup password" type="password" value={password} inputRef={passwordInput}
            error={problem('password', problems.password)}
            onInput={(value) => {
              setPassword(value);
              setProblems({});
            }}
          />
          <Field
            label="Repeat password" type="password" value={repeat} inputRef={repeatInput}
            error={problem('repeat', problems.repeat)}
            onInput={(value) => {
              setRepeat(value);
              setProblems({});
            }}
          />
          {offerRemember && (
            <label class="check">
              <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.currentTarget.checked)} />
              <span>Remember until the app is closed</span>
            </label>
          )}
          {/* Always on the page, with its text set after it is there, so that it is announced. */}
          <p class="live" role="status">{busy ? 'Making the file… this takes a moment.' : ''}</p>
        </>
      }
    />
  );
}

import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef } from 'preact/hooks';
import type { ErrorNotice } from '../../app/errors';

export interface ConfirmDialogProps {
  title: string;
  /** Text, or the fields of a small form: Enter in a field confirms. */
  body: ComponentChildren;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Styles the confirm button as a destructive action. */
  danger?: boolean;
  /** The action is running: confirm and Cancel are off and Escape does nothing, so the dialog cannot close halfway. */
  busy?: boolean;
  /** Turns off the confirm button only, for while what it acts on is still loading. Cancel still works. */
  confirmDisabled?: boolean;
  /** Why the action failed. It is shown in the dialog, which stays open so that nothing typed is lost. */
  error?: ErrorNotice;
}

/**
 * A modal `<dialog>`: it is open as long as it is rendered, traps focus, and Escape asks to cancel. Render it only
 * while it is wanted. The first control in the body gets the focus (with a text-only body that is Cancel), and
 * when the dialog goes away the focus returns to what had it before, if that is still on the page.
 */
export function ConfirmDialog({ title, body, confirmLabel, onConfirm, onCancel, danger, busy, confirmDisabled, error }: ConfirmDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const opener = document.activeElement;
    if (!element.open) element.showModal();
    return () => {
      if (element.open) element.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialog} class="dialog" aria-labelledby={titleId}
      onCancel={(event) => {
        // Escape: let the owner decide, so the dialog is never closed while the app still shows it.
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <form
        class="dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && !confirmDisabled) onConfirm();
        }}
      >
        <h2 id={titleId} class="dialog-title">{title}</h2>
        <div class="dialog-body">{body}</div>
        {error && (
          <div class="dialog-error" role="alert">
            <p>{error.message}</p>
            {error.action && <a href={error.action.href}>{error.action.label}</a>}
          </div>
        )}
        <div class="dialog-actions">
          <button type="button" class="btn btn-outline" disabled={busy} onClick={onCancel}>Cancel</button>
          <button type="submit" class={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy || confirmDisabled}>{confirmLabel}</button>
        </div>
      </form>
    </dialog>
  );
}

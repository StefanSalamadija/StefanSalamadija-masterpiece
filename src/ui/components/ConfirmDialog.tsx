import type { ComponentChildren, RefObject } from 'preact';
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
  /** Why the action failed. It is shown in the dialog, which stays open so that nothing typed is lost; the focus moves to confirm, to try again. */
  error?: ErrorNotice;
  /** Gets the focus when the dialog goes away, if what had it before is gone or cannot take it (such as a deleted row). */
  focusFallback?: RefObject<HTMLElement | null>;
}

/** Gives the focus back to `opener` if it can take it, else to the fallback. */
function returnFocus(opener: Element | null, fallback: HTMLElement | null | undefined): void {
  if (opener instanceof HTMLElement && opener.isConnected) {
    opener.focus();
    if (document.activeElement === opener) return;
  }
  fallback?.focus();
}

/**
 * A modal `<dialog>`: it is open as long as it is rendered, traps focus, and Escape asks to cancel. Render it only
 * while it is wanted. The first control in the body gets the focus (with a text-only body that is Cancel), and
 * when the dialog goes away the focus returns to what had it before, or to `focusFallback`.
 */
export function ConfirmDialog({
  title, body, confirmLabel, onConfirm, onCancel, danger, busy, confirmDisabled, error, focusFallback,
}: ConfirmDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const closedByUnmount = useRef(false);
  const fallback = useRef(focusFallback);
  fallback.current = focusFallback;
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    closedByUnmount.current = false;
    const opener = document.activeElement;
    if (!element.open) element.showModal();
    return () => {
      closedByUnmount.current = true; // so that the `close` event of the line below is not taken for the browser's own
      if (element.open) element.close();
      returnFocus(opener, fallback.current?.current);
    };
  }, []);

  useEffect(() => {
    if (error) confirmButton.current?.focus();
  }, [error]);

  return (
    <dialog
      ref={dialog} class="dialog" aria-labelledby={titleId}
      onCancel={(event) => {
        // Escape: let the owner decide, so the dialog is never closed while the app still shows it.
        event.preventDefault();
        if (!busy) onCancel();
      }}
      onClose={() => {
        // The browser closes a dialog by itself on a second Escape that the page may not cancel. That must neither
        // leave the app showing a dialog that is shut, nor end an action that is still running.
        const element = dialog.current;
        if (closedByUnmount.current || !element) return;
        if (!busy) onCancel();
        else if (!element.open) element.showModal();
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
          <button
            ref={confirmButton} type="submit" class={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            disabled={busy || confirmDisabled}
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}

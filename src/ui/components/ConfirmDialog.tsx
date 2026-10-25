import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef } from 'preact/hooks';

export interface ConfirmDialogProps {
  title: string;
  /** Text, or the fields of a small form: Enter in a field confirms. */
  body: ComponentChildren;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Styles the confirm button as a destructive action. */
  danger?: boolean;
  /** Disables the confirm button (and Enter) while the action runs or while what it needs is still loading. Cancel always works. */
  busy?: boolean;
}

/**
 * A modal `<dialog>`: it is open as long as it is rendered, traps focus, and Escape asks to cancel. Render it only
 * while it is wanted. The first control in the body gets the focus; with a text-only body that is Cancel.
 */
export function ConfirmDialog({ title, body, confirmLabel, onConfirm, onCancel, danger, busy }: ConfirmDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    return () => {
      if (element.open) element.close();
    };
  }, []);

  return (
    <dialog
      ref={dialog} class="dialog" aria-labelledby={titleId}
      onCancel={(event) => {
        // Escape: let the owner decide, so the dialog is never closed while the app still shows it.
        event.preventDefault();
        onCancel();
      }}
    >
      <form
        class="dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) onConfirm();
        }}
      >
        <h2 id={titleId} class="dialog-title">{title}</h2>
        <div class="dialog-body">{body}</div>
        <div class="dialog-actions">
          <button type="button" class="btn btn-outline" onClick={onCancel}>Cancel</button>
          <button type="submit" class={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy}>{confirmLabel}</button>
        </div>
      </form>
    </dialog>
  );
}

import { useState } from 'preact/hooks';
import { describeError } from '../app/errors';
import type { ErrorNotice } from '../app/errors';

/**
 * Runs a dialog's action. `busy` while it runs. A failure is kept in `failure`, for the dialog to show, and the dialog
 * stays open with what was typed; on success the action closes the dialog itself.
 */
export function useDialogAction(): { busy: boolean; failure: ErrorNotice | undefined; run: (action: () => Promise<void>) => Promise<void> } {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ErrorNotice>();

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setFailure(undefined);
    try {
      await action();
    } catch (err) {
      setFailure(describeError(err));
      setBusy(false);
    }
  }

  return { busy, failure, run };
}

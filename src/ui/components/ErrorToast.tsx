import { useEffect, useState } from 'preact/hooks';
import { currentError, dismissError, subscribeErrors } from '../../app/errors';

/** Shows the latest reported error until it is dismissed. A full disk offers a link to export a backup. */
export function ErrorToast() {
  const [notice, setNotice] = useState(currentError);
  useEffect(() => {
    setNotice(currentError()); // an error may have been reported before this mounted
    return subscribeErrors(() => setNotice(currentError()));
  }, []);

  if (!notice) return null;
  return (
    <div class="toast no-print" role="alert">
      <span class="toast-message">{notice.message}</span>
      {notice.action && (
        <a href={notice.action.href} class="toast-action" onClick={dismissError}>
          {notice.action.label}
        </a>
      )}
      <button type="button" class="toast-dismiss" aria-label="Dismiss error" onClick={dismissError}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}

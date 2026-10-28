import type { StartupNotice } from '../../app/startup';

/**
 * Takes the whole screen in place of the app when the data cannot be used: another tab updated the database, an upgrade
 * waits for other tabs, or the data could not be opened. It needs nothing from the database (it is shown because the
 * database cannot be used), and the button, when there is one, only loads the page again.
 */
export function DatabaseNotice({ notice }: { notice: StartupNotice }) {
  return (
    <main class="db-notice">
      <div class="db-notice-card">
        <h1>Masterpiece</h1>
        <p class="db-notice-message" role={notice.urgent ? 'alert' : 'status'}>{notice.message}</p>
        {notice.action && (
          <button type="button" class="btn btn-primary" onClick={() => window.location.reload()}>{notice.action}</button>
        )}
      </div>
    </main>
  );
}

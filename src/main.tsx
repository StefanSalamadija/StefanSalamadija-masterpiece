import './ui/fonts.css';
import './ui/theme.css';
import './ui/print.css';
import { render } from 'preact';
import { reportError } from './app/errors';
import { Root } from './app/Root';
import { rememberPlaceOnLeaving, scrollMemory } from './app/scrollMemory';
import './app/swUpdate';
import { openFailureMessage, setStartup } from './app/startup';
import { getDb } from './db/schema';
import { getSettings } from './db/settings';
import { applyTheme } from './ui/theme';

window.addEventListener('unhandledrejection', (event) => reportError(event.reason));

// Before the router exists, so that this is the first to hear of a screen change (see `rememberPlaceOnLeaving`).
rememberPlaceOnLeaving(scrollMemory);

// index.html has already put the mirrored theme on <html> for the first paint. This reads the real setting from IndexedDB
// before the app is drawn and corrects the mirror (and the page) if they differ. Opening the data is also where an upgrade
// of the database happens: while it waits for other tabs the page says so, and if it fails the page gives guidance, in
// place of an app with no data (and the error's own words). Nothing is written to the data for the message.
async function boot(): Promise<void> {
  render(<Root />, document.getElementById('app')!);
  try {
    applyTheme((await getSettings(getDb())).theme);
    setStartup({ status: 'ready' });
  } catch (err) {
    applyTheme('day');
    setStartup({ status: 'failed', message: openFailureMessage(err) });
  }
}

void boot();

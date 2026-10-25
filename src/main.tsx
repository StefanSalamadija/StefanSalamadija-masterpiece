import './ui/fonts.css';
import './ui/theme.css';
import './ui/print.css';
import { render } from 'preact';
import { App } from './app/App';
import { reportError } from './app/errors';
import './app/swUpdate';
import { getDb } from './db/schema';
import { getSettings } from './db/settings';
import { applyTheme } from './ui/theme';

window.addEventListener('unhandledrejection', (event) => reportError(event.reason));

// index.html has already put the mirrored theme on <html> for the first paint. This reads the real setting from IndexedDB
// before the first render and corrects the mirror (and the page) if they differ.
async function boot(): Promise<void> {
  try {
    applyTheme((await getSettings(getDb())).theme);
  } catch (err) {
    applyTheme('day');
    reportError(err);
  }
  render(<App />, document.getElementById('app')!);
}

void boot();

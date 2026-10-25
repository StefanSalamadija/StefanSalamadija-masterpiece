import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-ext-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-ext-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-ext-600.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-ext-500.css';
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

// The theme is read before the first render, so the page never flashes the wrong colours.
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

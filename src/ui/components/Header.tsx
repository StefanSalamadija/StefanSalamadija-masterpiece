import { useAppState } from '../../app/AppState';
import { reportError } from '../../app/errors';
import { updateSettings } from '../../db/settings';
import { formatOffset, toShipLocal } from '../../domain/shipTime';
import type { Theme } from '../../domain/types';
import { logoMode } from '../theme';
import { themeButtonLabel, themeTap } from '../themeSchedule';
import { LogoMark } from './LogoMark';

function ThemeIcon({ theme }: { theme: Theme }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {theme === 'day' && (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </>
      )}
      {theme === 'dark' && <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />}
      {/* Night red: the moon drawn solid, so it reads apart from Dark's outline moon. */}
      {theme === 'red' && <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" fill="currentColor" />}
      {theme === 'contrast' && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

/**
 * The top bar: brand, the active ship's name, the ship's clock and the theme button. The button shows the theme on screen;
 * a tap changes the base theme, or, while automatic night is on, holds the next theme until the next switch (`themeTap`).
 */
export function Header() {
  const { db, settings, activeShip, offsetMinutes, nowUtc, shipNow, theme } = useAppState();

  async function cycleTheme(): Promise<void> {
    try {
      await updateSettings(db, themeTap(settings, shipNow));
    } catch (err) {
      reportError(err);
    }
  }

  return (
    <header class="app-header">
      <div class="bar-inner">
        <div class="header-main">
          <div class="brand">
            <LogoMark size={24} mode={logoMode(theme)} />
            <h1>Masterpiece</h1>
          </div>
          <p class="ship-name">{activeShip?.particulars.name}</p>
        </div>
        <div class="header-side">
          <div class="clock" data-testid="ship-clock">
            <span class="clock-time">{toShipLocal(nowUtc, offsetMinutes).time}</span>{' '}
            <span class="clock-zone">LT ({formatOffset(offsetMinutes)})</span>
          </div>
          <button type="button" class="theme-btn no-print" aria-label={themeButtonLabel(settings, shipNow)} onClick={cycleTheme}>
            <ThemeIcon theme={theme} />
            {/* "Automatic": shown whenever automatic night is on, a held theme included (the label says which). */}
            {settings.nightAuto && <span class="theme-auto" aria-hidden="true">A</span>}
          </button>
        </div>
      </div>
    </header>
  );
}

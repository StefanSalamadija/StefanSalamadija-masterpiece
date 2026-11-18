import { useState } from 'preact/hooks';
import { useAppState } from '../../app/AppState';
import { reportError } from '../../app/errors';
import { updateSettings } from '../../db/settings';
import { formatOffset, toShipLocal } from '../../domain/shipTime';
import type { Theme } from '../../domain/types';
import { Icon } from '../icons';
import type { IconName } from '../icons';
import { themeButtonLabel, themeTap } from '../themeSchedule';
import { ShipSwitcher } from './ShipSwitcher';

/** The theme button's icon: the theme on screen. Night red's moon is drawn solid, so it reads apart from Dark's outline. */
const THEME_ICON: Record<Theme, IconName> = { day: 'sun', dark: 'moon', red: 'moon', contrast: 'contrast' };

/**
 * The top bar, as on the canvas: the ship pill (it opens the ship switcher), the ship's clock and the theme button. The
 * button shows the theme on screen; a tap changes the base theme, or, while automatic night is on, holds the next theme
 * until the next switch (`themeTap`). The logo and the app's name are on the lock screen and the first run only.
 */
export function Header() {
  const { db, settings, activeShip, offsetMinutes, nowUtc, shipNow, theme } = useAppState();
  const [switching, setSwitching] = useState(false);

  async function cycleTheme(): Promise<void> {
    try {
      await updateSettings(db, themeTap(settings, shipNow));
    } catch (err) {
      reportError(err);
    }
  }

  return (
    <>
      <header class="app-header">
        <div class="bar-inner">
          <button type="button" class="ship-pill" aria-haspopup="dialog" onClick={() => setSwitching(true)}>
            <span class="ship-pill-name">{activeShip?.particulars.name}</span>
            <Icon name="chevron" size={16} />
          </button>
          <span class="clock" data-testid="ship-clock">
            {toShipLocal(nowUtc, offsetMinutes).time} LT<span class="visually-hidden"> ({formatOffset(offsetMinutes)})</span>
          </span>
          <button type="button" class="theme-btn no-print" data-icon={theme} aria-label={themeButtonLabel(settings, shipNow)} onClick={cycleTheme}>
            <Icon name={THEME_ICON[theme]} size={22} />
            {/* "Automatic": shown whenever automatic night is on, a held theme included (the label says which). */}
            {settings.nightAuto && <span class="theme-auto" aria-hidden="true">A</span>}
          </button>
        </div>
      </header>
      {switching && <ShipSwitcher onClose={() => setSwitching(false)} />}
    </>
  );
}

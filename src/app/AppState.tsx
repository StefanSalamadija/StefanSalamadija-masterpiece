import { createContext } from 'preact';
import type { ComponentChildren } from 'preact';
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { listForShip } from '../db/records';
import { getDb, type MasterpieceDB } from '../db/schema';
import { clearThemeOverride, normaliseSettings } from '../db/settings';
import { liveActiveShipId, listShips } from '../db/ships';
import { requestPersistentStorage } from '../db/storage';
import { deviceOffsetMinutes, nextScheduledChange, shipOffsetAt, toShipLocal } from '../domain/shipTime';
import type { ClockChange, Settings, ShipProfile, Theme } from '../domain/types';
import { applyTheme, mirrorTheme } from '../ui/theme';
import { effectiveTheme, nightMirror, overrideActive } from '../ui/themeSchedule';
import { useLive } from '../ui/useLive';
import { reportError } from './errors';
import { msUntilNextTick } from './tick';

export { reportError } from './errors';

const TICK_MS = 30_000;

export interface AppState {
  db: MasterpieceDB;
  settings: Settings;
  /** The ship being worked on; undefined until the first ship is created. */
  activeShip?: ShipProfile;
  /** The active ship's UTC offset in minutes right now (the device's own offset when there is no ship). */
  offsetMinutes: number;
  /**
   * The current instant. Refreshed every 30 seconds, on the half minute, so the displayed minute is never late, and
   * whenever the stored data changes, so that a change just written (a clock change) is seen at once.
   */
  nowUtc: Date;
  /**
   * The active ship's live clock changes, scheduled ones included (none without a ship). Read in the same go as
   * `nowUtc` and `offsetMinutes`, so a change just made is never seen as scheduled for a moment.
   */
  clockChanges: ClockChange[];
  /** Today's date on the ship, `YYYY-MM-DD`. */
  shipToday: string;
  /** The ship's time now, `YYYY-MM-DDTHH:mm` (`toShipLocal(nowUtc, offsetMinutes).dateTime`). */
  shipNow: string;
  /**
   * The theme on screen: a theme held with the header button, else Night red inside the night window when automatic night
   * is on, else the base theme (`settings.theme`). See `effectiveTheme`.
   */
  theme: Theme;
  /** Whether the browser agreed to keep this app's data when the device runs low on space. */
  persistence: 'granted' | 'denied' | 'unsupported';
}

const AppStateContext = createContext<AppState | undefined>(undefined);

/** The shared app state. Must be called below `AppStateProvider`. */
export function useAppState(): AppState {
  const state = useContext(AppStateContext);
  if (!state) throw new Error('useAppState must be used inside AppStateProvider.');
  return state;
}

interface Loaded {
  settings: Settings | undefined;
  activeShip: ShipProfile | undefined;
  clockChanges: ClockChange[];
}

/** Everything the state is made of, read in one go, so the ship, its clock and the settings always agree. */
async function loadAppData(db: MasterpieceDB): Promise<Loaded> {
  const stored = await db.settings.get('device');
  const settings = stored && normaliseSettings(stored);
  const ships = await listShips(db);
  const activeShip = ships.find((ship) => ship.id === liveActiveShipId(settings?.activeShipId, ships));
  const clockChanges = activeShip ? await listForShip<ClockChange>(db, 'clockChanges', activeShip.id) : [];
  return { settings, activeShip, clockChanges };
}

/**
 * The current time, refreshed on every multiple of `stepMs` of the wall clock (so on every minute boundary), and at once
 * when the app is shown again, gets the focus, or is brought back from the page cache.
 */
function useNow(stepMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: number | undefined;
    const tick = (): void => {
      setNow(new Date());
      timer = window.setTimeout(tick, msUntilNextTick(Date.now(), stepMs));
    };
    const catchUp = (): void => {
      window.clearTimeout(timer);
      tick(); // timers are paused while the phone sleeps, so catch up at once
    };
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') catchUp();
    };
    timer = window.setTimeout(tick, msUntilNextTick(Date.now(), stepMs));
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', catchUp);
    window.addEventListener('pageshow', catchUp);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', catchUp);
      window.removeEventListener('pageshow', catchUp);
    };
  }, [stepMs]);
  return now;
}

/** The next clock change still to come, for the first-paint mirror: its instant and the offset in force from then on. */
function nextChangeFor(changes: ClockChange[], now: Date): { at: number; next: number } | undefined {
  const change = nextScheduledChange(changes, now);
  if (!change) return undefined;
  const at = Date.parse(change.effectiveAt);
  return { at, next: shipOffsetAt(changes, new Date(at)) }; // of several at the same instant, the last one wins
}

/** Loads the device settings, the active ship and its clock changes, and keeps them current for everything below. */
export function AppStateProvider({ children }: { children: ComponentChildren }) {
  const db = getDb();
  const data = useLive(() => loadAppData(db), [db]);
  const ticked = useNow(TICK_MS);
  // The instant also moves on whenever the data changes: a clock change just made takes effect from the moment it was
  // asked for, which is after the last tick, so it would not show (header clock, offset) until the next one.
  // (`ticked` and `data` are not read; they only say when to take the time again.)
  const nowUtc = useMemo(() => new Date(), [ticked, data]);
  const [persistence, setPersistence] = useState<AppState['persistence']>('unsupported');

  useEffect(() => {
    requestPersistentStorage().then(setPersistence, reportError);
  }, []);

  const state = useMemo<AppState | undefined>(() => {
    if (!data?.settings) return undefined;
    const offsetMinutes = data.activeShip ? shipOffsetAt(data.clockChanges, nowUtc) : deviceOffsetMinutes(nowUtc);
    const shipLocal = toShipLocal(nowUtc, offsetMinutes);
    return {
      db,
      settings: data.settings,
      activeShip: data.activeShip,
      offsetMinutes,
      nowUtc,
      clockChanges: data.clockChanges,
      shipToday: shipLocal.date,
      shipNow: shipLocal.dateTime,
      theme: effectiveTheme(data.settings, shipLocal.dateTime),
      persistence,
    };
  }, [db, data, nowUtc, persistence]);

  const theme = state?.theme;
  const base = state?.settings.theme;
  const night = state ? nightMirror(state.settings, state.offsetMinutes, nextChangeFor(state.clockChanges, state.nowUtc)) : null;
  // A layout effect runs before the browser paints, so a theme switch never shows a frame with the old palette. The mirror
  // in localStorage is what index.html works the first paint of the next start out from.
  useLayoutEffect(() => {
    if (!theme || !base) return;
    applyTheme(theme);
    mirrorTheme(base, night);
  }, [theme, base, night]);

  // A held theme whose end has come is cleared, once, and only if it is still the one stored: the key goes, so automatic
  // night takes over again. The guard re-arms once nothing has expired, so an identical override made later (after the
  // clocks go back) is cleared too.
  const held = state?.settings.themeOverride;
  const expired = held && !overrideActive(state.settings, state.shipNow) ? held : undefined;
  const expiredKey = expired && `${expired.theme} ${expired.until}`;
  const clearing = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!expired || !expiredKey) {
      clearing.current = undefined;
      return;
    }
    if (clearing.current === expiredKey) return;
    clearing.current = expiredKey;
    clearThemeOverride(db, expired).catch(reportError);
  }, [db, expiredKey]); // `expired` is read for its value, which `expiredKey` stands for

  // Nothing is drawn until the first read is done, so the welcome screen never flashes up for a device that has ships.
  return state ? <AppStateContext.Provider value={state}>{children}</AppStateContext.Provider> : null;
}

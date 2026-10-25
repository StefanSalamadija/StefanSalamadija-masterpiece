import { createContext } from 'preact';
import type { ComponentChildren } from 'preact';
import { useContext, useEffect, useLayoutEffect, useMemo, useState } from 'preact/hooks';
import { listForShip } from '../db/records';
import { getDb, type MasterpieceDB } from '../db/schema';
import { liveActiveShipId, listShips } from '../db/ships';
import { requestPersistentStorage } from '../db/storage';
import { deviceOffsetMinutes, shipOffsetAt, toShipLocal } from '../domain/shipTime';
import type { ClockChange, Settings, ShipProfile } from '../domain/types';
import { applyTheme } from '../ui/theme';
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
  /** The current instant. Refreshed every 30 seconds, on the half minute, so the displayed minute is never late. */
  nowUtc: Date;
  /** Today's date on the ship, `YYYY-MM-DD`. */
  shipToday: string;
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
  const settings = await db.settings.get('device');
  const ships = await listShips(db);
  const activeShip = ships.find((ship) => ship.id === liveActiveShipId(settings?.activeShipId, ships));
  const clockChanges = activeShip ? await listForShip<ClockChange>(db, 'clockChanges', activeShip.id) : [];
  return { settings, activeShip, clockChanges };
}

/** The current time, refreshed on every multiple of `stepMs` of the wall clock and when the app is shown again. */
function useNow(stepMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: number | undefined;
    const tick = (): void => {
      setNow(new Date());
      timer = window.setTimeout(tick, msUntilNextTick(Date.now(), stepMs));
    };
    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return;
      window.clearTimeout(timer);
      tick(); // timers are paused while the phone sleeps, so catch up at once
    };
    timer = window.setTimeout(tick, msUntilNextTick(Date.now(), stepMs));
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [stepMs]);
  return now;
}

/** Loads the device settings, the active ship and its clock changes, and keeps them current for everything below. */
export function AppStateProvider({ children }: { children: ComponentChildren }) {
  const db = getDb();
  const data = useLive(() => loadAppData(db), [db]);
  const nowUtc = useNow(TICK_MS);
  const [persistence, setPersistence] = useState<AppState['persistence']>('unsupported');

  useEffect(() => {
    requestPersistentStorage().then(setPersistence, reportError);
  }, []);

  const theme = data?.settings?.theme;
  // A layout effect runs before the browser paints, so a theme switch never shows a frame with the old palette.
  useLayoutEffect(() => {
    if (theme) applyTheme(theme);
  }, [theme]);

  const state = useMemo<AppState | undefined>(() => {
    if (!data?.settings) return undefined;
    const offsetMinutes = data.activeShip ? shipOffsetAt(data.clockChanges, nowUtc) : deviceOffsetMinutes(nowUtc);
    return {
      db,
      settings: data.settings,
      activeShip: data.activeShip,
      offsetMinutes,
      nowUtc,
      shipToday: toShipLocal(nowUtc, offsetMinutes).date,
      persistence,
    };
  }, [db, data, nowUtc, persistence]);

  // Nothing is drawn until the first read is done, so the welcome screen never flashes up for a device that has ships.
  return state ? <AppStateContext.Provider value={state}>{children}</AppStateContext.Provider> : null;
}

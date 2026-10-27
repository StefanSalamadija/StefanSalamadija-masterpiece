import type { ComponentType } from 'preact';
import { useEffect } from 'preact/hooks';
import { ErrorToast } from '../ui/components/ErrorToast';
import { Header } from '../ui/components/Header';
import { Nav, ShipNav } from '../ui/components/Nav';
import { UpdateBanner } from '../ui/components/UpdateBanner';
import { CertificateEdit } from '../ui/screens/CertificateEdit';
import { Certificates } from '../ui/screens/Certificates';
import { Crew } from '../ui/screens/Crew';
import { CrewEdit } from '../ui/screens/CrewEdit';
import { CrewImport } from '../ui/screens/CrewImport';
import { FirstShip } from '../ui/screens/FirstShip';
import { Home } from '../ui/screens/Home';
import { ImportBackup } from '../ui/screens/ImportBackup';
import { LockScreen } from '../ui/screens/LockScreen';
import { Particulars } from '../ui/screens/Particulars';
import { Profiles } from '../ui/screens/Profiles';
import { ProtectApp } from '../ui/screens/ProtectApp';
import { Settings } from '../ui/screens/Settings';
import { ShipTime } from '../ui/screens/ShipTime';
import { Voyage } from '../ui/screens/Voyage';
import { AppStateProvider, useAppState } from './AppState';
import { gateScreen } from './lockGate';
import { useRoute } from './router';
import type { RoutePath } from './router';
import { scrollMemory, scrollToWhenTallEnough } from './scrollMemory';
import { useAppLock } from './useAppLock';

/** The screens built so far. A route with no screen yet (or an unknown one) shows Home. */
const SCREENS: Partial<Record<RoutePath, ComponentType>> = {
  '/': Home,
  '/ship/particulars': Particulars,
  '/ship/crew': Crew,
  '/ship/crew/new': CrewEdit,
  '/ship/crew/import': CrewImport,
  '/ship/crew/:id': CrewEdit,
  '/ship/certificates': Certificates,
  '/ship/certificates/new': CertificateEdit,
  '/ship/certificates/:id': CertificateEdit,
  '/ship/voyage': Voyage,
  '/ship/time': ShipTime,
  '/profiles': Profiles,
  '/settings': Settings,
  '/settings/import': ImportBackup,
};

function Shell() {
  const { activeShip } = useAppState();
  const route = useRoute();
  const paramValues = Object.values(route.params).join('/');

  // A new screen starts at the top, but a list is returned to the place it was left at.
  useEffect(() => scrollToWhenTallEnough(scrollMemory.positionFor(route.path)), [route.path, paramValues]);

  if (!activeShip) {
    return (
      <>
        <UpdateBanner />
        {route.path === '/settings/import' ? <main class="container page"><ImportBackup /></main> : <FirstShip />}
      </>
    );
  }

  const Screen = SCREENS[route.path] ?? Home;
  return (
    <div class="shell">
      <Header />
      <UpdateBanner />
      {route.path.startsWith('/ship') && <ShipNav />}
      <main class="container page">
        <Screen />
      </main>
      <Nav />
    </div>
  );
}

/**
 * Decides what is drawn before anything else: the welcome screen while there is no ship, the lock while it is locked, the
 * protect step when it is due, else the app. The lock is decided before the app is rendered, so no ship name, header or
 * screen is ever in the page while the app is locked (at start, after a reload, and on coming back from the background).
 */
function Gate() {
  const { settings, activeShip } = useAppState();
  const lock = useAppLock(settings.pin);
  const screen = gateScreen({
    hasShip: activeShip !== undefined,
    hasPin: settings.pin !== undefined,
    locked: lock.locked,
    lockPrompted: settings.lockPrompted,
  });
  if (screen === 'lock' && settings.pin) return <LockScreen pin={settings.pin} onUnlock={lock.unlock} />;
  if (screen === 'protect') return <ProtectApp />;
  return <Shell />;
}

export function App() {
  return (
    <>
      <AppStateProvider>
        <Gate />
      </AppStateProvider>
      <ErrorToast />
    </>
  );
}

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
import { Particulars } from '../ui/screens/Particulars';
import { Profiles } from '../ui/screens/Profiles';
import { ShipTime } from '../ui/screens/ShipTime';
import { Voyage } from '../ui/screens/Voyage';
import { AppStateProvider, useAppState } from './AppState';
import { useRoute } from './router';
import type { RoutePath } from './router';
import { scrollMemory, scrollToWhenTallEnough } from './scrollMemory';

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
};

/** A placeholder for the import screen, which comes later. It is reachable before any ship exists. */
function ImportBackup() {
  return (
    <main class="container page">
      <h1>Import backup</h1>
      <p>Importing a backup is not available yet.</p>
      <p><a href="#/">Back</a></p>
    </main>
  );
}

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
        {route.path === '/settings/import' ? <ImportBackup /> : <FirstShip />}
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

export function App() {
  return (
    <>
      <AppStateProvider>
        <Shell />
      </AppStateProvider>
      <ErrorToast />
    </>
  );
}

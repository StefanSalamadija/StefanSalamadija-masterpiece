import type { ComponentType } from 'preact';
import { useEffect } from 'preact/hooks';
import { ErrorToast } from '../ui/components/ErrorToast';
import { Header } from '../ui/components/Header';
import { Nav, ShipNav } from '../ui/components/Nav';
import { UpdateBanner } from '../ui/components/UpdateBanner';
import { FirstShip } from '../ui/screens/FirstShip';
import { Home } from '../ui/screens/Home';
import { Particulars } from '../ui/screens/Particulars';
import { Profiles } from '../ui/screens/Profiles';
import { AppStateProvider, useAppState } from './AppState';
import { useRoute } from './router';
import type { RoutePath } from './router';

/** The screens built so far. A route with no screen yet (or an unknown one) shows Home. */
const SCREENS: Partial<Record<RoutePath, ComponentType>> = {
  '/': Home,
  '/ship/particulars': Particulars,
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

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route.path, paramValues]);

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

import type { ComponentType } from 'preact';
import { useEffect } from 'preact/hooks';
import { pinForLock } from '../security/lockState';
import { ErrorToast } from '../ui/components/ErrorToast';
import { Header } from '../ui/components/Header';
import { Nav, ShipNav } from '../ui/components/Nav';
import { UpdateBanner } from '../ui/components/UpdateBanner';
import { CertificateEdit } from '../ui/screens/CertificateEdit';
import { Certificates } from '../ui/screens/Certificates';
import { Crew } from '../ui/screens/Crew';
import { CrewDocumentEdit } from '../ui/screens/CrewDocumentEdit';
import { CrewEdit } from '../ui/screens/CrewEdit';
import { CrewImport } from '../ui/screens/CrewImport';
import { CrewListPrint } from '../ui/screens/CrewListPrint';
import { Expiring } from '../ui/screens/Expiring';
import { FirstShip } from '../ui/screens/FirstShip';
import { FormSetup } from '../ui/screens/FormSetup';
import { Forms } from '../ui/screens/Forms';
import { Home } from '../ui/screens/Home';
import { LockScreen } from '../ui/screens/LockScreen';
import { Particulars } from '../ui/screens/Particulars';
import { Profiles } from '../ui/screens/Profiles';
import { ProtectApp } from '../ui/screens/ProtectApp';
import { Reliefs } from '../ui/screens/Reliefs';
import { Settings } from '../ui/screens/Settings';
import { ShipTime } from '../ui/screens/ShipTime';
import { Voyage } from '../ui/screens/Voyage';
import { AppStateProvider, useAppState } from './AppState';
import { lazyScreen } from './lazyScreen';
import { gateScreen } from './lockGate';
import { useRoute } from './router';
import type { RoutePath } from './router';
import { scrollMemory, scrollToWhenTallEnough } from './scrollMemory';
import { useAppLock } from './useAppLock';

/** Importing a backup: its screen, the backup service and the import review are a chunk of their own, loaded on demand. */
const ImportBackup = lazyScreen(() => import('../ui/screens/ImportBackup').then((m) => m.ImportBackup));

type BudgetScreens = typeof import('../ui/screens/budget');
/** A Budget screen: every one is in the budget chunk, loaded on demand, so the budget's code stays out of the main chunk. */
const budget = (name: Exclude<keyof BudgetScreens, 'watchBudgetAlerts'>) => lazyScreen(() => import('../ui/screens/budget').then((m) => m[name]));

/** The screens built so far. A route with no screen yet (or an unknown one) shows Home. */
const SCREENS: Partial<Record<RoutePath, ComponentType>> = {
  '/': Home,
  '/ship/particulars': Particulars,
  '/ship/crew': Crew,
  '/ship/crew/new': CrewEdit,
  '/ship/crew/import': CrewImport,
  '/ship/crew/print': CrewListPrint,
  '/ship/crew/:id': CrewEdit,
  '/ship/crew/:id/documents/new': CrewDocumentEdit,
  '/ship/crew/:id/documents/:docId': CrewDocumentEdit,
  '/ship/certificates': Certificates,
  '/ship/certificates/new': CertificateEdit,
  '/ship/certificates/:id': CertificateEdit,
  '/ship/reliefs': Reliefs,
  '/ship/expiring': Expiring,
  '/ship/voyage': Voyage,
  '/ship/time': ShipTime,
  '/forms': Forms,
  '/forms/:id/setup': FormSetup,
  // Loaded on demand, so that the fill screen and its helpers stay out of the main chunk.
  '/forms/:id/fill': lazyScreen(() => import('../ui/screens/FormFill').then((m) => m.FormFill)),
  // The Tools section is one chunk, loaded on demand, so the converters stay out of the main chunk.
  '/tools': lazyScreen(() => import('../ui/screens/tools').then((m) => m.Tools)),
  '/tools/sdt': lazyScreen(() => import('../ui/screens/tools').then((m) => m.Sdt)),
  '/tools/volume-mass': lazyScreen(() => import('../ui/screens/tools').then((m) => m.VolumeMass)),
  '/tools/:group': lazyScreen(() => import('../ui/screens/tools').then((m) => m.ToolGroup)),
  // The library is one chunk, loaded on demand, so that reading and indexing documents stay out of the main chunk.
  '/library': lazyScreen(() => import('../ui/screens/library').then((m) => m.Library)),
  '/library/deleted': lazyScreen(() => import('../ui/screens/library').then((m) => m.LibraryDeleted)),
  '/library/files': lazyScreen(() => import('../ui/screens/library').then((m) => m.LibraryFiles)),
  '/library/doc/:id': lazyScreen(() => import('../ui/screens/library').then((m) => m.LibraryDoc)),
  '/budget': budget('Dashboard'),
  '/budget/add': budget('QuickAdd'),
  '/budget/add/income': budget('QuickAdd'),
  '/budget/add/same/:id': budget('QuickAdd'),
  '/budget/catch-up': budget('CatchUp'),
  '/budget/month/:ym': budget('MonthView'),
  '/budget/forecast': budget('Forecast'),
  '/budget/net-worth': budget('NetWorth'),
  '/budget/scenarios': budget('Scenarios'),
  '/budget/scenarios/:id': budget('Scenarios'),
  '/budget/plan': budget('Plan'),
  '/budget/plan/start': budget('StartBalances'),
  '/budget/plan/:section': budget('Plan'),
  '/budget/trends': budget('Trends'),
  '/budget/import': budget('ImportBudget'),
  '/budget/export': budget('ExportBudget'),
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
  // A lock decision never ends in the app: a passcode setting that is damaged (`null`, a string) is made into one that
  // nothing opens, so the app stays locked (the only way out is "Forgot passcode?", which erases the data).
  if (screen === 'lock') return <LockScreen pin={pinForLock(settings.pin)} onUnlock={lock.unlock} />;
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

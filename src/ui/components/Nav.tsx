import { useRoute } from '../../app/router';
import type { RoutePath } from '../../app/router';
import { Icon } from '../icons';

export type Tab = 'home' | 'ship' | 'forms' | 'budget' | 'more';

const TABS: { tab: Tab; label: string; href: string }[] = [
  { tab: 'home', label: 'Home', href: '#/' },
  { tab: 'ship', label: 'Ship', href: '#/ship' },
  { tab: 'forms', label: 'Forms', href: '#/forms' },
  { tab: 'budget', label: 'Budget', href: '#/budget' },
  { tab: 'more', label: 'More', href: '#/more' },
];

/** The tab of the bottom bar that a route belongs to. The screens with no tab of their own are under More. */
export function activeTab(path: RoutePath): Tab | undefined {
  const top = path.split('/')[1];
  if (top === '' || top === 'due') return 'home';
  if (top === 'ship' || top === 'forms' || top === 'budget' || top === 'more') return top;
  if (top === 'tools' || top === 'library' || top === 'profiles' || top === 'settings') return 'more';
  return undefined;
}

/** The bottom bar: Home, Ship, Forms, Budget and More. The tab of the screen shown has its icon in a pill. */
export function Nav() {
  const current = activeTab(useRoute().path);
  return (
    <nav class="app-nav no-print" aria-label="Main">
      <div class="bar-inner nav-grid">
        {TABS.map(({ tab, label, href }) => (
          <a key={tab} href={href} class="nav-link" aria-current={tab === current ? 'page' : undefined}>
            <span class="nav-pill"><Icon name={tab} size={22} /></span>
            {label}
          </a>
        ))}
      </div>
    </nav>
  );
}

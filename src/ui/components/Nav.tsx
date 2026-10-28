import type { ComponentChildren } from 'preact';
import { useRoute } from '../../app/router';

interface NavLink {
  label: string;
  href: string;
  /** True when the current route (pattern) belongs to this link. */
  isActive: (path: string) => boolean;
  icon: ComponentChildren;
}

const MAIN_LINKS: NavLink[] = [
  {
    label: 'Home', href: '#/', isActive: (path) => path === '/',
    icon: <path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" />,
  },
  {
    label: 'Ship', href: '#/ship/particulars', isActive: (path) => path.startsWith('/ship'),
    icon: (<><path d="M3 16l2 5h14l2-5-9-3z" /><path d="M12 3v10" /><path d="M7 8h10" /></>),
  },
  {
    label: 'Profiles', href: '#/profiles', isActive: (path) => path.startsWith('/profiles'),
    icon: <path d="M4 7h16M4 12h16M4 17h10" />,
  },
  {
    label: 'Settings', href: '#/settings', isActive: (path) => path.startsWith('/settings'),
    icon: (
      <>
        <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" />
        <circle cx="16" cy="6" r="2" />
        <circle cx="10" cy="12" r="2" />
        <circle cx="18" cy="18" r="2" />
      </>
    ),
  },
];

const SHIP_LINKS = [
  { label: 'Particulars', href: '#/ship/particulars' },
  { label: 'Crew', href: '#/ship/crew' },
  { label: 'Reliefs', href: '#/ship/reliefs' },
  { label: 'Expiring', href: '#/ship/expiring' },
  { label: 'Certificates', href: '#/ship/certificates' },
  { label: 'Voyage', href: '#/ship/voyage' },
  { label: "Ship's time", href: '#/ship/time' },
];

/** The bottom bar: Home, Ship, Profiles and Settings. */
export function Nav() {
  const { path } = useRoute();
  return (
    <nav class="app-nav no-print" aria-label="Main">
      <div class="bar-inner nav-grid">
        {MAIN_LINKS.map((link) => (
          <a key={link.href} href={link.href} class="nav-link" aria-current={link.isActive(path) ? 'page' : undefined}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              {link.icon}
            </svg>
            {link.label}
          </a>
        ))}
      </div>
    </nav>
  );
}

/** The row of chips under the header on the ship's screens. */
export function ShipNav() {
  const { path } = useRoute();
  return (
    <nav class="ship-nav no-print" aria-label="Ship sections">
      <div class="chips">
        {SHIP_LINKS.map((link) => {
          const base = link.href.slice(1);
          const active = path === base || path.startsWith(`${base}/`);
          return (
            <a key={link.href} href={link.href} class="chip" aria-current={active ? 'page' : undefined}>
              {link.label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}

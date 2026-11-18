import type { JSX } from 'preact';

export type IconName =
  | 'home' | 'ship' | 'forms' | 'budget' | 'more' | 'crew' | 'idCard' | 'certificate' | 'swap' | 'compass' | 'clock' | 'draft'
  | 'plus' | 'convert' | 'book' | 'chevron' | 'check' | 'sun' | 'moon' | 'contrast' | 'lock' | 'backup' | 'tools' | 'settings'
  | 'profiles';

/**
 * The drawing of each icon, on a 24 × 24 grid, as on the canvas. Lines only, except where a shape is filled on purpose. Each is
 * made afresh on every render, because one element must not be placed in the page twice.
 */
const PATHS: Record<IconName, () => JSX.Element> = {
  home: () => <path d="M3 11l9-7 9 7v9h-6v-6H9v6H3z" />,
  ship: () => <path d="M3 14h18l-3 6H6zM7 14V9h10v5M10 9V5h4v4" />,
  forms: () => <path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5" />,
  budget: () => <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18M16 15h2" /></>,
  more: () => <><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></>,
  crew: () => <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.5a3.5 3.5 0 010 7M18 14.8c1.8.7 3 2.4 3.5 5.2" /></>,
  idCard: () => <><rect x="4" y="3" width="16" height="18" rx="2" /><circle cx="12" cy="10" r="3" /><path d="M8 17h8" /></>,
  certificate: () => <path d="M5 3h14v12l-7 6-7-6zM9 10l2 2 4-4" />,
  swap: () => <path d="M4 7h11M4 7l3-3M4 7l3 3M20 17H9M20 17l-3-3M20 17l-3 3" />,
  compass: () => <><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5z" /></>,
  clock: () => <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  draft: () => <path d="M3 15h18l-3 5H6zM12 3v12M12 5h5M12 8h3M12 11h5" />,
  plus: () => <path d="M12 5v14M5 12h14" />,
  convert: () => <path d="M4 8h13l-3-3M20 16H7l3 3" />,
  book: () => <path d="M4 4h6a2 2 0 012 2v14a2 2 0 00-2-2H4zM20 4h-6a2 2 0 00-2 2v14a2 2 0 012-2h6z" />,
  // Pointing right, as at the end of a row; the ship pill turns it down.
  chevron: () => <path d="M9 6l6 6-6 6" />,
  check: () => <path d="M5 12l5 5 9-10" />,
  sun: () => <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5" /></>,
  moon: () => <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
  contrast: () => <><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" /></>,
  lock: () => <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></>,
  backup: () => <path d="M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4" />,
  tools: () => <path d="M14.5 6.5a4 4 0 00-5.2 5.2L3.5 17.5l3 3 5.8-5.8a4 4 0 005.2-5.2l-2.6 2.6-2.5-.6-.6-2.5z" />,
  settings: () => <><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>,
  profiles: () => <path d="M4 7h16M4 12h16M4 17h10" />,
};

/** One of the app's line icons, in the colour of the text around it. It is decoration: the text beside it says what it is. */
export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  return (
    <svg
      class="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
    >
      {PATHS[name]()}
    </svg>
  );
}

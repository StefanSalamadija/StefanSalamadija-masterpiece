import { Icon } from '../icons';
import type { IconName } from '../icons';

/** The screens with no tab of their own. Backup and App lock open Settings at their section. */
const ROWS: { name: string; href: string; icon: IconName }[] = [
  { name: 'Tools', href: '#/tools', icon: 'tools' },
  { name: 'Library', href: '#/library', icon: 'book' },
  { name: 'Profiles', href: '#/profiles', icon: 'profiles' },
  { name: 'Settings', href: '#/settings', icon: 'settings' },
  { name: 'Backup and restore', href: '#/settings?at=backup', icon: 'backup' },
  { name: 'App lock', href: '#/settings?at=lock', icon: 'lock' },
];

/** The More tab: one large row for each screen that has no tab. */
export function More() {
  return (
    <section class="screen">
      <h2>More</h2>
      <nav aria-label="More">
        <ul class="row-list" role="list">
          {ROWS.map((row) => (
            <li key={row.href}>
              <a class="list-row more-row" href={row.href}>
                <span class="more-icon"><Icon name={row.icon} /></span>
                <span class="list-row-text list-row-title">{row.name}</span>
                <span class="list-row-chevron"><Icon name="chevron" size={20} /></span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </section>
  );
}

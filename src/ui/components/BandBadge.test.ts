import { describe, expect, it } from 'vitest';
import type { Band } from '../../domain/types';
import { BandBadge } from './BandBadge';
import type { BadgeKind } from './BandBadge';

/** What the badge renders: nothing, or its band and its words. */
function badge(band: Band, kind: BadgeKind): { band: unknown; text: unknown } | null {
  const vnode = BandBadge({ band, kind });
  if (!vnode) return null;
  const props = (vnode as unknown as { props: Record<string, unknown> }).props;
  return { band: props['data-band'], text: props.children };
}

describe('BandBadge', () => {
  it('says Expires soon and Expired for crew documents', () => {
    expect(badge('amber', 'crew')).toEqual({ band: 'amber', text: 'Expires soon' });
    expect(badge('red', 'crew')).toEqual({ band: 'red', text: 'Expired' });
  });
  it('says Due soon and Overdue for certificates', () => {
    expect(badge('amber', 'certificate')).toEqual({ band: 'amber', text: 'Due soon' });
    expect(badge('red', 'certificate')).toEqual({ band: 'red', text: 'Overdue' });
  });
  it('says Relief due soon and Relief overdue for a contract that is near its end or past it', () => {
    expect(badge('amber', 'contract')).toEqual({ band: 'amber', text: 'Relief due soon' });
    expect(badge('red', 'contract')).toEqual({ band: 'red', text: 'Relief overdue' });
  });
  it('says Near onboard limit and Onboard limit reached for the months onboard', () => {
    expect(badge('amber', 'limit')).toEqual({ band: 'amber', text: 'Near onboard limit' });
    expect(badge('red', 'limit')).toEqual({ band: 'red', text: 'Onboard limit reached' });
  });
  it('shows nothing when there is nothing to warn about', () => {
    for (const kind of ['crew', 'certificate', 'contract', 'limit'] as const) {
      expect(badge('none', kind)).toBeNull();
      expect(badge('ok', kind)).toBeNull();
    }
  });
});

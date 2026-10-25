import { describe, expect, it } from 'vitest';
import type { Band } from '../../domain/types';
import { BandBadge } from './BandBadge';

/** What the badge renders: nothing, or its band and its words. */
function badge(band: Band, kind: 'crew' | 'certificate'): { band: unknown; text: unknown } | null {
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
  it('shows nothing when there is nothing to warn about', () => {
    for (const kind of ['crew', 'certificate'] as const) {
      expect(badge('none', kind)).toBeNull();
      expect(badge('ok', kind)).toBeNull();
    }
  });
});

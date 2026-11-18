import { describe, expect, it } from 'vitest';
import type { Band } from '../../domain/types';
import { BandBadge } from './BandBadge';
import type { BadgeKind } from './BandBadge';

/** What the badge renders: nothing, or its class, tone, band and words. */
function badge(band: Band, kind: BadgeKind): { class: unknown; tone: unknown; band: unknown; text: unknown } | null {
  const vnode = BandBadge({ band, kind });
  if (!vnode) return null;
  const props = (vnode as unknown as { props: Record<string, unknown> }).props;
  return { class: props.class, tone: props['data-tone'], band: props['data-band'], text: props.children };
}

/** A status pill: due soon is outlined (warn), overdue filled (danger), valid a ✓ and a word (ok). */
const pill = (tone: string, band: string, text: string) => ({ class: 'status', tone, band, text });

describe('BandBadge', () => {
  it('says Expires soon and Expired for crew documents', () => {
    expect(badge('amber', 'crew')).toEqual(pill('warn', 'amber', 'Expires soon'));
    expect(badge('red', 'crew')).toEqual(pill('danger', 'red', 'Expired'));
  });
  it('says Due soon and Overdue for certificates', () => {
    expect(badge('amber', 'certificate')).toEqual(pill('warn', 'amber', 'Due soon'));
    expect(badge('red', 'certificate')).toEqual(pill('danger', 'red', 'Overdue'));
  });
  it('says Relief due soon and Relief overdue for a contract that is near its end or past it', () => {
    expect(badge('amber', 'contract')).toEqual(pill('warn', 'amber', 'Relief due soon'));
    expect(badge('red', 'contract')).toEqual(pill('danger', 'red', 'Relief overdue'));
  });
  it('says Near onboard limit and Onboard limit reached for the months onboard', () => {
    expect(badge('amber', 'limit')).toEqual(pill('warn', 'amber', 'Near onboard limit'));
    expect(badge('red', 'limit')).toEqual(pill('danger', 'red', 'Onboard limit reached'));
  });
  it('says ✓ Valid for valid crew papers and certificates (green means valid, spec §6)', () => {
    expect(badge('ok', 'crew')).toEqual(pill('ok', 'ok', '✓ Valid'));
    expect(badge('ok', 'certificate')).toEqual(pill('ok', 'ok', '✓ Valid'));
  });
  it('shows nothing for a contract or the onboard limit that is fine, as before', () => {
    expect(badge('ok', 'contract')).toBeNull();
    expect(badge('ok', 'limit')).toBeNull();
  });
  it('shows nothing when there is nothing to tell', () => {
    for (const kind of ['crew', 'certificate', 'contract', 'limit'] as const) expect(badge('none', kind)).toBeNull();
  });
});

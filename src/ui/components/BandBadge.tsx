import type { Band } from '../../domain/types';

const TEXT = {
  crew: { amber: 'Expires soon', red: 'Expired' },
  certificate: { amber: 'Due soon', red: 'Overdue' },
} as const;

/** The warning for an expiry band: amber or red, in words as well as colour. Nothing is shown when there is nothing to warn about. */
export function BandBadge({ band, kind }: { band: Band; kind: 'crew' | 'certificate' }) {
  if (band !== 'amber' && band !== 'red') return null;
  return <span class="badge band-badge" data-band={band}>{TEXT[kind][band]}</span>;
}

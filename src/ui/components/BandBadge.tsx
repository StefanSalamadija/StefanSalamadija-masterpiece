import type { Band } from '../../domain/types';

const TEXT = {
  crew: { amber: 'Expires soon', red: 'Expired' },
  certificate: { amber: 'Due soon', red: 'Overdue' },
  /** A contract near its end, or past it. */
  contract: { amber: 'Relief due soon', red: 'Relief overdue' },
  /** The months onboard near the ship's limit, or at it. */
  limit: { amber: 'Near onboard limit', red: 'Onboard limit reached' },
} as const;

/** What a badge warns about; each has its own words. */
export type BadgeKind = keyof typeof TEXT;

/** The warning for a band: amber or red, in words as well as colour. Nothing is shown when there is nothing to warn about. */
export function BandBadge({ band, kind }: { band: Band; kind: BadgeKind }) {
  if (band !== 'amber' && band !== 'red') return null;
  return <span class="badge band-badge" data-band={band}>{TEXT[kind][band]}</span>;
}

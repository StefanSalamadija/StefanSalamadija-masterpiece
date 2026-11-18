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

/** The status pill of each band (`.status[data-tone]`): due soon is outlined, overdue filled, valid a ✓ and a word. */
const TONE = { amber: 'warn', red: 'danger', ok: 'ok' } as const;

/** The tint of a list row (`.list-row[data-tone]`) by its band: overdue and due soon only. A valid record is a plain row. */
export const ROW_TONE: Partial<Record<Band, 'warn' | 'danger'>> = { amber: 'warn', red: 'danger' };

/** What is valid says so in green (spec §6, ruling U1); a contract or the months onboard that are fine show nothing, as before. */
const SHOWS_VALID: ReadonlySet<BadgeKind> = new Set(['crew', 'certificate']);

/**
 * The status of a band, in words as well as colour and shape. Nothing is shown when there is nothing to tell. `data-band`
 * stays beside `data-tone`, for the lists' tests.
 */
export function BandBadge({ band, kind }: { band: Band; kind: BadgeKind }) {
  if (band === 'none' || (band === 'ok' && !SHOWS_VALID.has(kind))) return null;
  const text = band === 'ok' ? '✓ Valid' : TEXT[kind][band];
  return <span class="status" data-tone={TONE[band]} data-band={band}>{text}</span>;
}

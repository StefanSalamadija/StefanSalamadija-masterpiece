import { isBackupDue } from '../backup/reminder';
import type { AlertKind } from '../domain/alerts';
import { formatOffset, nextScheduledChange } from '../domain/shipTime';
import { todayRowIndex } from '../domain/dayGrid';
import type { ClockChange, FormDraft, FormTemplate, Settings } from '../domain/types';
import type { BadgeKind } from './components/BandBadge';
import { draftRows, fillHref } from './formsView';
import { historyRows } from './shipTimeView';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Shown on Home while the browser has refused to keep the app's data when the device runs low on space. */
export const PERSISTENCE_DENIED_NOTICE =
  "This browser may clear Masterpiece's data when storage runs low. Install the app and export backups regularly.";

/**
 * What the backup banner says: that there is no backup yet, or how many whole days ago the last one was. A time that
 * cannot be read counts as no backup, as it does for `isBackupDue`.
 */
export function backupBannerText(lastExportAt: string | undefined, now: Date): string {
  const last = lastExportAt === undefined ? NaN : Date.parse(lastExportAt);
  if (Number.isNaN(last)) return 'No backup yet. Export one now.';
  const days = Math.max(0, Math.floor((now.getTime() - last) / MS_PER_DAY));
  return `Last backup ${days} ${days === 1 ? 'day' : 'days'} ago. Export a backup now.`;
}

/** The text of the backup banner when a backup is due (see `isBackupDue`), and nothing when it is not. */
export function backupReminder(
  settings: Pick<Settings, 'lastExportAt' | 'backupReminderDays'>, hasShips: boolean, now: Date,
): string | undefined {
  return isBackupDue(settings, hasShips, now) ? backupBannerText(settings.lastExportAt, now) : undefined;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * `Clock change 26 Oct 01:00 → UTC+05:00` for the next change that has not yet taken effect, and nothing when there is
 * none. The time is the one the Ship's time history lists the change at: the time on the clocks of the offset in
 * effect just before it, which is when the clocks are moved.
 */
export function clockChangeText(changes: ClockChange[], now: Date): string | undefined {
  const next = nextScheduledChange(changes, now);
  const row = next && historyRows(changes, now).find((r) => r.id === next.id);
  if (!next || !row) return undefined;
  const [date, time] = row.when.split(' '); // `2026-10-26 01:00`
  const [, month, day] = date.split('-');
  return `Clock change ${day} ${MONTHS[Number(month) - 1]} ${time} → ${formatOffset(next.toOffsetMinutes)}`;
}

const BADGE_KIND: Record<AlertKind, BadgeKind> = {
  crewDoc: 'crew', crewCertificate: 'crew', certificate: 'certificate', contract: 'contract', onboardLimit: 'limit',
};

/**
 * Which words the badge of an alert uses: `Expires soon` and `Expired` for crew (a passport, a seaman's book or a document), `Due soon` and `Overdue` for
 * certificates, `Relief due soon` and `Relief overdue` for a contract, `Near onboard limit` and `Onboard limit reached`.
 */
export function alertBadgeKind(kind: AlertKind): BadgeKind {
  return BADGE_KIND[kind];
}

/** A line of `Forms in progress`; `href` is missing when the draft's form is not in the library. */
export interface InProgressRow {
  key: string;
  href?: string;
  text: string;
}

/** Whether a row of a day grid holds anything: a tick box that is off and an empty text are nothing. */
function rowEntered(row: Record<string, string | boolean | null> | undefined): boolean {
  return row !== undefined && Object.values(row).some((v) => v !== null && v !== false && v !== '');
}

/**
 * The lines of `Forms in progress`, one for each live draft, in the order of the Forms screen: `<code> <title> — <period>`
 * (`periodLabel` from the forms engine, which Home loads on demand). A month's day grid that has no value in the row for
 * the ship's today reads `<code> <title> — today's row not entered` instead; another month's draft is not nagged about.
 */
export function formsInProgress(
  drafts: FormDraft[], templates: FormTemplate[], shipToday: string, periodLabel: (period: string) => string,
): InProgressRow[] {
  return draftRows(drafts, templates, periodLabel).map(({ draft, template, text }): InProgressRow => {
    if (!template) return { key: draft.id, text };
    const grid = template.schema.rowGroups.find((g) => g.shape === 'dayGrid');
    if (grid && draft.period === shipToday.slice(0, 7)) {
      const index = todayRowIndex(grid, shipToday);
      if (index >= 0 && !rowEntered(draft.values.rows[grid.id]?.[index])) {
        const name = template.code === '' ? template.title : `${template.code} ${template.title}`;
        return { key: draft.id, href: fillHref(template.id), text: `${name} — today's row not entered` };
      }
    }
    return { key: draft.id, href: fillHref(template.id), text };
  });
}

import { isBackupDue } from '../backup/reminder';
import { todayRowIndex } from '../domain/dayGrid';
import type { FormDraft, FormTemplate, Settings } from '../domain/types';
import { draftRows, fillHref } from './formsView';

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

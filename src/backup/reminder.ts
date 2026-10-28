import type { Settings } from '../domain/types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * True when the "back up your data" reminder should show: there is something to lose (`hasShips`) and the last full
 * export is more than `backupReminderDays` days old, or there has never been one.
 */
export function isBackupDue(s: Pick<Settings, 'lastExportAt' | 'backupReminderDays'>, hasShips: boolean, now: Date): boolean {
  if (!hasShips) return false;
  const last = s.lastExportAt === undefined ? NaN : Date.parse(s.lastExportAt);
  if (Number.isNaN(last)) return true; // never exported, or a value that cannot be read
  return now.getTime() - last > s.backupReminderDays * MS_PER_DAY;
}

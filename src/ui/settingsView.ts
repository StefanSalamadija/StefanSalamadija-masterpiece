import { validatePassword } from '../backup/envelope';
import { formatUtcMinute } from '../domain/dates';
import type { Snapshot, TableName } from '../domain/types';

export const REMINDER_ERROR = 'Enter a number of days from 1 to 365.';
export const DEVICE_NAME_REQUIRED = 'Enter a device name.';
export const DEVICE_NAME_MAX = 40;
export const PASSWORD_MISMATCH = "The passwords don't match.";
export const EXPORT_CANCELLED = 'Export cancelled — no backup was made.';

const MIN_REMINDER_DAYS = 1;
const MAX_REMINDER_DAYS = 365;

/** The days typed for the backup reminder: a whole number from 1 to 365, else `undefined`. Digits only: no sign, decimal point or exponent. */
export function parseReminderDays(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^[0-9]+$/.test(trimmed)) return undefined;
  const days = Number(trimmed);
  return days >= MIN_REMINDER_DAYS && days <= MAX_REMINDER_DAYS ? days : undefined;
}

/** The device name as it is kept: trimmed, and at most `DEVICE_NAME_MAX` characters (never cutting a character in half). */
export function cleanDeviceName(text: string): string {
  return Array.from(text.trim()).slice(0, DEVICE_NAME_MAX).join('').trim();
}

/** What is wrong with the passwords typed for an export, by field. Nothing is said about the repeat until the password itself is fine. */
export interface PasswordProblems { password?: string; repeat?: string }

export function passwordProblems(password: string, repeat: string): PasswordProblems {
  const weak = validatePassword(password);
  if (weak) return { password: weak };
  return password === repeat ? {} : { repeat: PASSWORD_MISMATCH };
}

/** Why a snapshot was taken, in words. A manual snapshot is named by its note ("Before restore" for the one a restore takes). */
export function snapshotReason({ reason, note }: Pick<Snapshot, 'reason' | 'note'>): string {
  if (reason === 'before-import') return 'Before import';
  if (reason === 'before-update') return 'Before update';
  if (reason === 'manual') return note?.trim() || 'Manual';
  return 'Snapshot';
}

/** When a snapshot was taken, in UTC: a snapshot belongs to the device, not to a ship, so it has no ship's time. */
export function snapshotDate(createdAt: string): string {
  return formatUtcMinute(createdAt) ?? 'Unknown date';
}

const COUNT_WORDS: readonly (readonly [TableName, string, string])[] = [
  ['ships', 'ship', 'ships'],
  ['crew', 'crew', 'crew'],
  ['voyages', 'voyage', 'voyages'],
  ['certificates', 'certificate', 'certificates'],
  ['clockChanges', 'clock change', 'clock changes'],
];

/** "1 ship · 12 crew · 30 certificates": what a snapshot holds, leaving out what it does not. Deleted records are counted too. */
export function snapshotCountsText(counts: Record<TableName, number>): string {
  const parts = COUNT_WORDS.filter(([table]) => counts[table] > 0).map(([table, one, many]) => `${counts[table]} ${counts[table] === 1 ? one : many}`);
  return parts.length > 0 ? parts.join(' · ') : 'No records';
}

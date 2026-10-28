import { describe, expect, it } from 'vitest';
import { isBackupDue } from './reminder';

const now = new Date('2026-10-25T12:00:00Z');

describe('isBackupDue', () => {
  it('is never due when there are no ships', () => {
    expect(isBackupDue({ backupReminderDays: 7 }, false, now)).toBe(false);
    expect(isBackupDue({ backupReminderDays: 7, lastExportAt: '2026-01-01T00:00:00.000Z' }, false, now)).toBe(false);
  });

  it('is due when there are ships and no export has ever been made', () => {
    expect(isBackupDue({ backupReminderDays: 7 }, true, now)).toBe(true);
  });

  it('is due once more than the reminder period has passed, not before', () => {
    expect(isBackupDue({ backupReminderDays: 7, lastExportAt: '2026-10-17T12:00:00.000Z' }, true, now)).toBe(true);
    expect(isBackupDue({ backupReminderDays: 7, lastExportAt: '2026-10-19T12:00:00.000Z' }, true, now)).toBe(false);
  });

  it('is not due exactly at the limit, but is a millisecond later', () => {
    expect(isBackupDue({ backupReminderDays: 7, lastExportAt: '2026-10-18T12:00:00.000Z' }, true, now)).toBe(false);
    expect(isBackupDue({ backupReminderDays: 7, lastExportAt: '2026-10-18T11:59:59.999Z' }, true, now)).toBe(true);
  });

  it('follows the configured number of days', () => {
    expect(isBackupDue({ backupReminderDays: 1, lastExportAt: '2026-10-24T11:59:00.000Z' }, true, now)).toBe(true);
    expect(isBackupDue({ backupReminderDays: 30, lastExportAt: '2026-09-30T12:00:00.000Z' }, true, now)).toBe(false);
  });

  it('treats an unreadable last-export time as never exported', () => {
    expect(isBackupDue({ backupReminderDays: 7, lastExportAt: 'garbage' }, true, now)).toBe(true);
  });
});

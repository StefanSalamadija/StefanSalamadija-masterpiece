import { describe, expect, it } from 'vitest';
import type { ClockChange, Settings } from '../domain/types';
import { historyRows } from './shipTimeView';
import { alertBadgeKind, backupBannerText, backupReminder, clockChangeText, PERSISTENCE_DENIED_NOTICE } from './homeView';

const NOW = new Date('2026-10-25T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const agoMs = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe('backupBannerText', () => {
  it('asks for a first backup when there has never been one', () => {
    expect(backupBannerText(undefined, NOW)).toBe('No backup yet. Export one now.');
  });

  it('treats a time that cannot be read as no backup', () => {
    expect(backupBannerText('garbage', NOW)).toBe('No backup yet. Export one now.');
    expect(backupBannerText('', NOW)).toBe('No backup yet. Export one now.');
  });

  it('says how many days ago the last backup was', () => {
    expect(backupBannerText(agoMs(10 * DAY), NOW)).toBe('Last backup 10 days ago. Export a backup now.');
    expect(backupBannerText(agoMs(2 * DAY), NOW)).toBe('Last backup 2 days ago. Export a backup now.');
  });

  it('says day, not days, for one', () => {
    expect(backupBannerText(agoMs(DAY), NOW)).toBe('Last backup 1 day ago. Export a backup now.');
    expect(backupBannerText(agoMs(DAY + 23 * 60 * 60 * 1000), NOW)).toBe('Last backup 1 day ago. Export a backup now.');
  });

  it('counts whole days only', () => {
    expect(backupBannerText(agoMs(8 * DAY + 23 * 60 * 60 * 1000), NOW)).toBe('Last backup 8 days ago. Export a backup now.');
    expect(backupBannerText(agoMs(9 * DAY - 1), NOW)).toBe('Last backup 8 days ago. Export a backup now.');
    expect(backupBannerText(agoMs(9 * DAY), NOW)).toBe('Last backup 9 days ago. Export a backup now.');
  });

  it('says days for none, and never counts a backup from the future as negative days', () => {
    expect(backupBannerText(agoMs(60 * 60 * 1000), NOW)).toBe('Last backup 0 days ago. Export a backup now.');
    expect(backupBannerText(agoMs(-3 * DAY), NOW)).toBe('Last backup 0 days ago. Export a backup now.');
  });
});

describe('backupReminder', () => {
  const settings = (over: Partial<Pick<Settings, 'lastExportAt' | 'backupReminderDays'>> = {}) => ({ backupReminderDays: 7, ...over });

  it('is the banner text when a backup is due', () => {
    expect(backupReminder(settings(), true, NOW)).toBe('No backup yet. Export one now.');
    expect(backupReminder(settings({ lastExportAt: agoMs(8 * DAY) }), true, NOW)).toBe('Last backup 8 days ago. Export a backup now.');
  });

  it('is nothing while the last backup is recent enough, the day of the limit included', () => {
    expect(backupReminder(settings({ lastExportAt: agoMs(2 * DAY) }), true, NOW)).toBeUndefined();
    expect(backupReminder(settings({ lastExportAt: agoMs(7 * DAY) }), true, NOW)).toBeUndefined();
  });

  it('follows the reminder days of the settings', () => {
    expect(backupReminder(settings({ backupReminderDays: 1, lastExportAt: agoMs(DAY + 1) }), true, NOW)).toBe('Last backup 1 day ago. Export a backup now.');
    expect(backupReminder(settings({ backupReminderDays: 30, lastExportAt: agoMs(20 * DAY) }), true, NOW)).toBeUndefined();
  });

  it('is nothing when there is no ship to lose', () => {
    expect(backupReminder(settings(), false, NOW)).toBeUndefined();
  });
});

describe('PERSISTENCE_DENIED_NOTICE', () => {
  it('is the copy of the spec', () => {
    expect(PERSISTENCE_DENIED_NOTICE).toBe(
      "This browser may clear Masterpiece's data when storage runs low. Install the app and export backups regularly.",
    );
  });
});

let seq = 0;
function change(effectiveAt: string, toOffsetMinutes: number, over: Partial<ClockChange> = {}): ClockChange {
  seq += 1;
  return {
    id: `cc-${String(seq).padStart(3, '0')}`, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'device', deleted: false, scope: 'ship', shipId: 'ship-1', effectiveAt, toOffsetMinutes, ...over,
  };
}

describe('clockChangeText', () => {
  const past = change('2026-01-01T00:00:00.000Z', 180);

  it('is nothing when no change is scheduled', () => {
    expect(clockChangeText([], NOW)).toBeUndefined();
    expect(clockChangeText([past], NOW)).toBeUndefined();
    expect(clockChangeText([past, change('2026-10-20T00:00:00.000Z', 240)], NOW)).toBeUndefined();
  });

  it('is nothing for a change that is happening this very instant, which has taken effect', () => {
    expect(clockChangeText([past, change(NOW.toISOString(), 240)], NOW)).toBeUndefined();
  });

  it('reads the time on the clocks before the change, as the history does', () => {
    // 22:00Z at +03:00 is 01:00 on the next day.
    expect(clockChangeText([past, change('2026-10-25T22:00:00.000Z', 300)], NOW)).toBe('Clock change 26 Oct 01:00 → UTC+05:00');
  });

  it('reads the time of the first change of a ship at its own offset, as it has nothing before it', () => {
    expect(clockChangeText([change('2026-10-26T00:00:00.000Z', 180)], NOW)).toBe('Clock change 26 Oct 03:00 → UTC+03:00');
  });

  it('reads the time before a scheduled change with the change scheduled before it', () => {
    const changes = [past, change('2026-10-26T00:00:00.000Z', 240), change('2026-10-27T00:00:00.000Z', 120)];
    // The first of the two is at +03:00, the second is read at +04:00.
    expect(clockChangeText(changes, NOW)).toBe('Clock change 26 Oct 03:00 → UTC+04:00');
    expect(clockChangeText(changes, new Date('2026-10-26T00:00:00.000Z'))).toBe('Clock change 27 Oct 04:00 → UTC+02:00');
  });

  it('is the next change of several, whatever order they are in', () => {
    const later = change('2026-11-20T00:00:00.000Z', 120);
    const sooner = change('2026-10-30T00:00:00.000Z', 240);
    expect(clockChangeText([later, past, sooner], NOW)).toBe('Clock change 30 Oct 03:00 → UTC+04:00');
  });

  it('leaves out a change that was cancelled', () => {
    const cancelled = change('2026-10-26T00:00:00.000Z', 240, { deleted: true });
    const kept = change('2026-11-20T00:00:00.000Z', 120);
    expect(clockChangeText([past, cancelled], NOW)).toBeUndefined();
    expect(clockChangeText([past, cancelled, kept], NOW)).toBe('Clock change 20 Nov 03:00 → UTC+02:00');
  });

  it('writes the offset with a sign, hours and minutes', () => {
    expect(clockChangeText([change('2026-10-26T12:00:00.000Z', -570)], NOW)).toBe('Clock change 26 Oct 02:30 → UTC-09:30');
    expect(clockChangeText([change('2026-10-26T12:00:00.000Z', 0)], NOW)).toBe('Clock change 26 Oct 12:00 → UTC+00:00');
  });

  it('writes the day with two digits and the month with three letters', () => {
    expect(clockChangeText([change('2026-11-05T00:00:00.000Z', 0)], NOW)).toBe('Clock change 05 Nov 00:00 → UTC+00:00');
  });

  it.each([
    ['01', 'Jan'], ['02', 'Feb'], ['03', 'Mar'], ['04', 'Apr'], ['05', 'May'], ['06', 'Jun'],
    ['07', 'Jul'], ['08', 'Aug'], ['09', 'Sep'], ['10', 'Oct'], ['11', 'Nov'], ['12', 'Dec'],
  ])('names month %s %s', (month, name) => {
    const text = clockChangeText([change(`2027-${month}-15T00:00:00.000Z`, 0)], NOW);
    expect(text).toBe(`Clock change 15 ${name} 00:00 → UTC+00:00`);
  });

  it('shows the time that the ship time history shows for the same change', () => {
    const changes = [past, change('2026-10-25T22:00:00.000Z', 300), change('2026-12-01T05:30:00.000Z', -60)];
    for (const now of [NOW, new Date('2026-10-26T00:00:00.000Z')]) {
      const next = changes.find((c) => Date.parse(c.effectiveAt) > now.getTime())!;
      const row = historyRows(changes, now).find((r) => r.id === next.id)!;
      const [date, time] = row.when.split(' ');
      expect(clockChangeText(changes, now)).toMatch(new RegExp(` ${date.slice(8)} \\w{3} ${time} `));
    }
  });
});

describe('alertBadgeKind', () => {
  it('words a crew document as a crew warning and a certificate as a certificate warning', () => {
    expect(alertBadgeKind('crewDoc')).toBe('crew');
    expect(alertBadgeKind('certificate')).toBe('certificate');
  });
});

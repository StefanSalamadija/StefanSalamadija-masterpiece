import { describe, expect, it } from 'vitest';
import type { TableName } from '../domain/types';
import {
  cleanDeviceName, DEVICE_NAME_MAX, DEVICE_NAME_REQUIRED, EXPORT_CANCELLED, parseReminderDays, PASSWORD_MISMATCH,
  passwordProblems, REMINDER_ERROR, snapshotCountsText, snapshotDate, snapshotReason,
} from './settingsView';

describe('parseReminderDays', () => {
  it('reads a whole number of days from 1 to 365', () => {
    expect(parseReminderDays('7')).toBe(7);
    expect(parseReminderDays('1')).toBe(1);
    expect(parseReminderDays('365')).toBe(365);
    expect(parseReminderDays('  14 ')).toBe(14);
    expect(parseReminderDays('007')).toBe(7);
  });

  it('refuses everything else', () => {
    for (const bad of ['', '   ', '0', '366', '-3', '7.5', '7,5', '7.0', '1e2', '+7', 'abc', '7 days', '３', '9'.repeat(400)]) {
      expect(parseReminderDays(bad), JSON.stringify(bad)).toBeUndefined();
    }
  });

  it('has the message the screen shows', () => {
    expect(REMINDER_ERROR).toBe('Enter a number of days from 1 to 365.');
  });
});

describe('cleanDeviceName', () => {
  it('trims the name', () => {
    expect(cleanDeviceName('  Bridge laptop \n')).toBe('Bridge laptop');
  });

  it('keeps at most 40 characters', () => {
    expect(DEVICE_NAME_MAX).toBe(40);
    expect(cleanDeviceName('x'.repeat(41))).toBe('x'.repeat(40));
    expect(cleanDeviceName('y'.repeat(40))).toBe('y'.repeat(40));
  });

  it('counts characters, not code units, so that it never cuts a character in half', () => {
    const name = cleanDeviceName('😀'.repeat(41));
    expect(Array.from(name)).toHaveLength(40);
    expect(name).toBe('😀'.repeat(40));
  });

  it('trims again after cutting, so that the name does not end in a space', () => {
    expect(cleanDeviceName(`${'a'.repeat(39)}   b`)).toBe('a'.repeat(39));
  });

  it('keeps diacritics and punctuation exactly as typed', () => {
    expect(cleanDeviceName("Šašić's phone")).toBe("Šašić's phone");
  });

  it('has a message for a name that is empty once trimmed', () => {
    expect(DEVICE_NAME_REQUIRED).toBe('Enter a device name.');
    expect(cleanDeviceName('   ')).toBe('');
  });
});

describe('passwordProblems', () => {
  it('has none for a password of 8 or more characters that is repeated', () => {
    expect(passwordProblems('lozinka-ćevapi', 'lozinka-ćevapi')).toEqual({});
    expect(passwordProblems('12345678', '12345678')).toEqual({});
  });

  it("uses the envelope's message for a short password", () => {
    expect(passwordProblems('short', 'short')).toEqual({ password: 'Use at least 8 characters.' });
  });

  it('counts characters, not code units', () => {
    expect(passwordProblems('ćććććććć', 'ćććććććć')).toEqual({});
    expect(passwordProblems('ććććććć', 'ććććććć')).toEqual({ password: 'Use at least 8 characters.' });
  });

  it("says the passwords don't match when the repeat differs, and puts it on the repeat field", () => {
    expect(PASSWORD_MISMATCH).toBe("The passwords don't match.");
    expect(passwordProblems('lozinka-ćevapi', 'lozinka-cevapi')).toEqual({ repeat: PASSWORD_MISMATCH });
    expect(passwordProblems('lozinka-ćevapi', '')).toEqual({ repeat: PASSWORD_MISMATCH });
  });

  it('compares the repeat exactly: case and spaces count', () => {
    expect(passwordProblems('Password1', 'password1')).toEqual({ repeat: PASSWORD_MISMATCH });
    expect(passwordProblems('Password1', 'Password1 ')).toEqual({ repeat: PASSWORD_MISMATCH });
  });

  it('reports the short password first, and nothing about the repeat until that is fixed', () => {
    expect(passwordProblems('short', 'different')).toEqual({ password: 'Use at least 8 characters.' });
  });
});

describe('snapshotReason', () => {
  it('says what each stored reason means', () => {
    expect(snapshotReason({ reason: 'before-import' })).toBe('Before import');
    expect(snapshotReason({ reason: 'before-update' })).toBe('Before update');
  });

  it('shows the note of a manual snapshot, which is "Before restore" for the one a restore takes', () => {
    expect(snapshotReason({ reason: 'manual', note: 'Before restore' })).toBe('Before restore');
    expect(snapshotReason({ reason: 'manual', note: '  Before the audit ' })).toBe('Before the audit');
  });

  it('calls a manual snapshot without a note Manual', () => {
    expect(snapshotReason({ reason: 'manual' })).toBe('Manual');
    expect(snapshotReason({ reason: 'manual', note: '   ' })).toBe('Manual');
  });

  it('does not fail on a reason it does not know (a snapshot kept by a later version)', () => {
    expect(snapshotReason({ reason: 'from-the-future' as never })).toBe('Snapshot');
  });
});

describe('snapshotDate', () => {
  it('writes the instant in UTC', () => {
    expect(snapshotDate('2026-10-25T09:05:59.000Z')).toBe('2026-10-25 09:05 UTC');
  });

  it('does not fail on a time that cannot be read', () => {
    expect(snapshotDate('yesterday')).toBe('Unknown date');
  });
});

describe('snapshotCountsText', () => {
  const counts = (over: Partial<Record<TableName, number>>): Record<TableName, number> =>
    ({ ships: 0, crew: 0, voyages: 0, certificates: 0, clockChanges: 0, ...over });

  it('lists what the snapshot holds, with the right plural', () => {
    expect(snapshotCountsText(counts({ ships: 1, crew: 12, voyages: 1, certificates: 30, clockChanges: 2 })))
      .toBe('1 ship · 12 crew · 1 voyage · 30 certificates · 2 clock changes');
  });

  it('leaves out what it does not hold', () => {
    expect(snapshotCountsText(counts({ ships: 1, clockChanges: 1 }))).toBe('1 ship · 1 clock change');
  });

  it('says so when there is nothing', () => {
    expect(snapshotCountsText(counts({}))).toBe('No records');
  });
});

describe('EXPORT_CANCELLED', () => {
  it('says that closing the share sheet made no backup', () => {
    expect(EXPORT_CANCELLED).toBe('Export cancelled — no backup was made.');
  });
});

import { describe, expect, it } from 'vitest';
import type { FormDraft, FormTemplate, Settings } from '../domain/types';
import type { FieldDef, FormSchema, FormSetup, RowGroupDef } from '../forms/types';
import { backupBannerText, backupReminder, formsInProgress, PERSISTENCE_DENIED_NOTICE } from './homeView';

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

describe('formsInProgress', () => {
  const STAMP = '2026-10-01T00:00:00.000Z';
  const label = (period: string) => (period === '2026-10' ? 'October 2026' : period === '2026-W44' ? 'Week 44, 2026' : period);
  const col = { id: 'c1', label: 'Hold 1', kind: 'text' } as unknown as FieldDef;
  const grid = { id: 'g1', label: 'Days', section: '', loc: '', columns: [col], capacity: 31, growable: false, shape: 'dayGrid' } as unknown as RowGroupDef;
  const plain = { ...grid, id: 'g2', shape: 'rows' } as RowGroupDef;
  function tpl(id: string, code: string, title: string, rowGroups: RowGroupDef[] = []): FormTemplate {
    const schema = { kind: 'xlsx', identity: { code, title, revision: '00' }, fields: [], rowGroups, unsupported: [] } as unknown as FormSchema;
    return {
      id, code, title, revision: '00', kind: 'xlsx', fileName: 'f.xlsx', fileBase64: '', schema, setup: {} as FormSetup,
      createdAt: STAMP, updatedAt: STAMP, updatedBy: 'dev', deleted: false, scope: 'personal',
    };
  }
  function dr(id: string, templateId: string, code: string, period: string, rows: FormDraft['values']['rows'] = {}): FormDraft {
    return {
      id, shipId: 's1', templateId, code, period, values: { fields: {}, rows }, photoIds: [],
      createdAt: STAMP, updatedAt: STAMP, updatedBy: 'dev', deleted: false, scope: 'ship',
    };
  }
  const toolbox = tpl('t1', 'TST-01', 'Toolbox Talk');
  const days = tpl('t2', 'TST-12', 'Demo Day Grid', [grid]);

  it('is one line per live draft: code title — period, linking to fill', () => {
    const rows = formsInProgress([dr('d1', 't1', 'TST-01', '2026-W44')], [toolbox], '2026-10-28', label);
    expect(rows).toEqual([{ key: 'd1', href: '#/forms/t1/fill', text: 'TST-01 Toolbox Talk — Week 44, 2026' }]);
  });

  it('says today\'s row not entered for a day grid whose row for today is empty', () => {
    const rows = formsInProgress([dr('d2', 't2', 'TST-12', '2026-10', { g1: [{ c1: '1' }] })], [days], '2026-10-28', label);
    expect(rows[0].text).toBe("TST-12 Demo Day Grid — today's row not entered");
  });

  it('shows the period once today\'s row has a value', () => {
    const rows = Array.from({ length: 28 }, (_, i) => (i === 27 ? { c1: '3' } : { c1: null }));
    expect(formsInProgress([dr('d2', 't2', 'TST-12', '2026-10', { g1: rows })], [days], '2026-10-28', label)[0].text)
      .toBe('TST-12 Demo Day Grid — October 2026');
  });

  it('does not count an unticked box or blank text as entered, and does not nag about another month or a plain table', () => {
    const blank = Array.from({ length: 28 }, () => ({ c1: false, c2: '' }));
    expect(formsInProgress([dr('d2', 't2', 'TST-12', '2026-10', { g1: blank })], [days], '2026-10-28', label)[0].text).toContain('not entered');
    expect(formsInProgress([dr('d2', 't2', 'TST-12', '2026-10')], [days], '2026-11-02', label)[0].text).toBe('TST-12 Demo Day Grid — October 2026');
    const other = tpl('t3', 'TST-13', 'Inventory', [plain]);
    expect(formsInProgress([dr('d3', 't3', 'TST-13', '2026-10')], [other], '2026-10-28', label)[0].text).toBe('TST-13 Inventory — October 2026');
  });

  it('finds the form by code and revision when the template id is gone, and leaves out deleted drafts', () => {
    const rows = formsInProgress(
      [{ ...dr('d1', 'old-id', 'TST-01', '2026-W44'), revision: toolbox.revision }, { ...dr('d9', 't1', 'TST-01', '2026-W44'), deleted: true }], [toolbox], '2026-10-28', label,
    );
    expect(rows.map((r) => [r.key, r.href])).toEqual([['d1', '#/forms/t1/fill']]);
  });

  it('keeps a draft whose form is not here, without a link', () => {
    const rows = formsInProgress([dr('d1', 'gone', 'TST-77', '2026-W44')], [toolbox], '2026-10-28', label);
    expect(rows).toEqual([{ key: 'd1', text: 'TST-77 — import this form to continue' }]);
  });
});

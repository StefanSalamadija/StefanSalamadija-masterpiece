import { describe, expect, it } from 'vitest';
import { RANKS } from '../domain/catalogues';
import { FIELD_NAMES } from '../domain/fieldDictionary';
import { suggestLinks } from '../forms/autofill';
import { importForm } from '../forms/engine';
import { conditionListXlsx, dayGridXlsx, inventoryXlsx, matrixXlsx } from '../forms/testing/excelFixtures';
import { permitDocx, toolboxTalkDocx, weeklyJobsDotx } from '../forms/testing/wordFixtures';
import { LINK_GROUPS, linkFromValue, linkName, linkOptions, linkValue } from './formLinks';

describe('the sources a field can be linked to', () => {
  const options = linkOptions();
  const values = options.map((o) => o.value);

  it('has every dictionary name but the crew list, every time source, and each rank with its three parts', () => {
    for (const name of FIELD_NAMES.filter((n) => n !== 'crew.onboard')) expect(values, name).toContain(`link:${name}`);
    for (const time of ['date', 'time', 'timeUtc', 'month', 'yearWeek', 'weekRange', 'weekStart', 'weekEnd']) expect(values).toContain(`link:time.${time}`);
    for (const { key } of RANKS.filter((r) => r.key !== 'other')) {
      for (const part of ['name', 'rank', 'nameRank']) expect(values).toContain(`link:crew.byRank.${key}|${part}`);
    }
    // A list of people gives no value a field can hold, and `Other` names no one rank.
    expect(values).not.toContain('link:crew.onboard');
    expect(values.some((v) => v.startsWith('link:crew.byRank.other'))).toBe(false);
  });

  it('names each one for a person, never by its dictionary name, and each value once', () => {
    for (const option of options) {
      expect(option.label.trim(), option.value).not.toBe('');
      expect(option.label, option.value).not.toMatch(/\b(?:vessel|voyage|time|crew)\./);
      expect(LINK_GROUPS).toContain(option.group);
    }
    expect(new Set(values).size).toBe(values.length);
    expect(options.find((o) => o.value === 'link:vessel.name')?.label).toBe('Ship name');
    expect(options.find((o) => o.value === 'link:time.date')?.label).toBe("The form's date");
    expect(options.find((o) => o.value === 'link:crew.byRank.master|nameRank')?.label).toBe('Master: name / rank');
    expect(options.find((o) => o.value === 'link:crew.byRank.chiefOfficer|rank')?.label).toBe('Chief Officer: rank');
  });

  it('lists every link that detection suggests for the sample forms', () => {
    const fixtures: [string, Uint8Array][] = [
      ['toolbox.docx', toolboxTalkDocx()], ['permit.docx', permitDocx()], ['weekly.dotx', weeklyJobsDotx()],
      ['inventory.xlsx', inventoryXlsx()], ['daygrid.xlsx', dayGridXlsx()], ['matrix.xlsx', matrixXlsx()],
      ['conditions.xlsx', conditionListXlsx()],
    ];
    for (const [name, bytes] of fixtures) {
      for (const link of Object.values(suggestLinks(importForm(name, bytes).schema))) {
        expect(values, `${name}: ${link.source}`).toContain(linkValue(link));
      }
    }
  });
});

describe('a link as a select value, and back', () => {
  it('round-trips plain sources and people, and gives a person the name part when none is set', () => {
    expect(linkValue({ source: 'vessel.imo' })).toBe('link:vessel.imo');
    expect(linkValue({ source: 'crew.byRank.master', part: 'nameRank' })).toBe('link:crew.byRank.master|nameRank');
    expect(linkValue({ source: 'crew.byRank.master' })).toBe('link:crew.byRank.master|name');
    expect(linkFromValue('link:vessel.imo')).toEqual({ source: 'vessel.imo' });
    expect(linkFromValue('link:crew.byRank.master|rank')).toEqual({ source: 'crew.byRank.master', part: 'rank' });
  });

  it('has no value for an unlinked field, and reads nothing from what is not a link', () => {
    expect(linkValue({ source: 'none' })).toBeUndefined();
    for (const value of ['you', 'empty', '', 'link:', 'link:none', 'link:crew.byRank.master|everything']) expect(linkFromValue(value), value).toBeUndefined();
  });

  it('names a link it does not know by its source, so that a link from another device is kept and shown', () => {
    expect(linkName({ source: 'cert.loadLine.number' })).toBe('cert.loadLine.number');
    expect(linkName({ source: 'vessel.flag' })).toBe('Flag');
    expect(linkName({ source: 'crew.byRank.bosun', part: 'name' })).toBe('Bosun: name');
  });
});

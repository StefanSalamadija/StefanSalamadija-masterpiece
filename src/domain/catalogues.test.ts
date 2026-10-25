import { describe, expect, it } from 'vitest';
import { CERTIFICATES, RANKS, rankLabel } from './catalogues';

describe('RANKS', () => {
  it('lists the 20 ranks in spec order, ending with Other', () => {
    expect(RANKS.map(r => r.label)).toEqual([
      'Master', 'Chief Officer', '2nd Officer', '3rd Officer', 'Deck Cadet', 'Bosun', 'AB', 'OS',
      'Chief Engineer', '2nd Engineer', '3rd Engineer', '4th Engineer', 'ETO', 'Engine Cadet', 'Fitter', 'Oiler',
      'Wiper', 'Chief Cook', 'Messman', 'Other',
    ]);
    expect(new Set(RANKS.map(r => r.key)).size).toBe(20);
  });
});

describe('rankLabel', () => {
  it('uses the catalogue label for a standard rank', () => {
    expect(rankLabel({ rank: 'chiefOfficer' })).toBe('Chief Officer');
    expect(rankLabel({ rank: 'master', rankOther: 'ignored' })).toBe('Master');
  });
  it('uses the free text for Other, falling back to "Other"', () => {
    expect(rankLabel({ rank: 'other', rankOther: ' Pumpman ' })).toBe('Pumpman');
    expect(rankLabel({ rank: 'other', rankOther: '' })).toBe('Other');
    expect(rankLabel({ rank: 'other' })).toBe('Other');
  });
});

describe('CERTIFICATES', () => {
  it('has unique keys and ends with Other', () => {
    expect(new Set(CERTIFICATES.map(c => c.key)).size).toBe(CERTIFICATES.length);
    expect(CERTIFICATES[CERTIFICATES.length - 1]).toEqual({ key: 'other', name: 'Other', group: 'Other' });
  });

  it('has every key the plan names, plus Other (31 entries)', () => {
    const keys = [
      'loadLine', 'safetyConstruction', 'safetyEquipment', 'safetyRadio', 'iopp', 'ispp', 'iapp', 'iee', 'bwm', 'iafs', 'ihm',
      'docIsm', 'smc', 'issc', 'mlc', 'dmlc1', 'dmlc2', 'registry', 'tonnage', 'csr', 'safeManning', 'classHull',
      'classMachinery', 'grainAuthorization', 'docDangerousGoods', 'pandiEntry', 'bunkerClc', 'wreckRemoval',
      'hullMachineryInsurance', 'sanitation', 'other',
    ];
    expect(CERTIFICATES.map(c => c.key).sort()).toEqual([...keys].sort());
    expect(CERTIFICATES).toHaveLength(31);
  });

  it('names the certificates the later screens refer to', () => {
    const name = (key: string) => CERTIFICATES.find(c => c.key === key)?.name;
    expect(name('loadLine')).toBe('International Load Line');
    expect(name('iopp')).toBe('IOPP');
    expect(name('issc')).toBe('ISSC');
  });

  it('groups follow spec section 4.6', () => {
    expect([...new Set(CERTIFICATES.map(c => c.group))]).toEqual([
      'Registry and tonnage', 'Statutory safety', 'Pollution and environment', 'Management and security',
      'Class', 'Cargo', 'Liability and insurance', 'Health', 'Other',
    ]);
  });
});

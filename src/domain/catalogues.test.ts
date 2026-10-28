import { describe, expect, it } from 'vitest';
import { CERTIFICATES, CREW_DOC_TYPES, RANKS, rankLabel } from './catalogues';

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

describe('CREW_DOC_TYPES', () => {
  it('lists the 21 papers in spec order, ending with Other', () => {
    expect(CREW_DOC_TYPES.map((t) => t.key)).toEqual([
      'coc', 'endorsement', 'gmdss', 'medical', 'yellowFever', 'bst', 'aff', 'pscrb', 'frb', 'mfa', 'medicalCare',
      'securityAwareness', 'dsd', 'sso', 'ecdis', 'brm', 'erm', 'highVoltage', 'usVisa', 'schengenVisa', 'other',
    ]);
    expect(CREW_DOC_TYPES).toHaveLength(21);
  });

  it('names them as the document form shows them', () => {
    expect(CREW_DOC_TYPES.map((t) => t.label)).toEqual([
      'Certificate of Competency (CoC)', 'Flag endorsement', 'GMDSS certificate', 'Medical fitness certificate',
      'Yellow fever certificate', 'Basic safety training', 'Advanced fire fighting', 'Survival craft and rescue boats',
      'Fast rescue boats', 'Medical first aid', 'Medical care', 'Security awareness', 'Designated security duties',
      'Ship security officer', 'ECDIS', 'Bridge resource management', 'Engine-room resource management', 'High voltage',
      'US C1/D visa', 'Schengen visa', 'Other',
    ]);
  });

  it('groups them as Competency, Health, STCW courses, Visas and Other', () => {
    expect([...new Set(CREW_DOC_TYPES.map((t) => t.group))]).toEqual(['Competency', 'Health', 'STCW courses', 'Visas', 'Other']);
    const group = (name: string) => CREW_DOC_TYPES.filter((t) => t.group === name).map((t) => t.key);
    expect(group('Competency')).toEqual(['coc', 'endorsement', 'gmdss']);
    expect(group('Health')).toEqual(['medical', 'yellowFever']);
    expect(group('STCW courses')).toHaveLength(13);
    expect(group('Visas')).toEqual(['usVisa', 'schengenVisa']);
    expect(CREW_DOC_TYPES[CREW_DOC_TYPES.length - 1]).toEqual({ key: 'other', label: 'Other', group: 'Other', graded: false });
  });

  it('has a grade only for the certificates of competency, endorsements and GMDSS', () => {
    expect(CREW_DOC_TYPES.filter((t) => t.graded).map((t) => t.key)).toEqual(['coc', 'endorsement', 'gmdss']);
  });
});

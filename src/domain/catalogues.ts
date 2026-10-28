import type { CrewDocType, CrewMember, RankKey } from './types';

export const RANKS: readonly { key: RankKey; label: string }[] = [
  { key: 'master', label: 'Master' },
  { key: 'chiefOfficer', label: 'Chief Officer' },
  { key: 'secondOfficer', label: '2nd Officer' },
  { key: 'thirdOfficer', label: '3rd Officer' },
  { key: 'deckCadet', label: 'Deck Cadet' },
  { key: 'bosun', label: 'Bosun' },
  { key: 'ab', label: 'AB' },
  { key: 'os', label: 'OS' },
  { key: 'chiefEngineer', label: 'Chief Engineer' },
  { key: 'secondEngineer', label: '2nd Engineer' },
  { key: 'thirdEngineer', label: '3rd Engineer' },
  { key: 'fourthEngineer', label: '4th Engineer' },
  { key: 'eto', label: 'ETO' },
  { key: 'engineCadet', label: 'Engine Cadet' },
  { key: 'fitter', label: 'Fitter' },
  { key: 'oiler', label: 'Oiler' },
  { key: 'wiper', label: 'Wiper' },
  { key: 'chiefCook', label: 'Chief Cook' },
  { key: 'messman', label: 'Messman' },
  { key: 'other', label: 'Other' },
];

/** Display label for a crew member's rank; free-text for 'other' (falling back to "Other" when blank). */
export function rankLabel(m: Pick<CrewMember, 'rank' | 'rankOther'>): string {
  if (m.rank === 'other') return m.rankOther?.trim() || 'Other';
  return RANKS.find(r => r.key === m.rank)?.label ?? m.rank;
}

const REGISTRY = 'Registry and tonnage';
const SAFETY = 'Statutory safety';
const POLLUTION = 'Pollution and environment';
const MANAGEMENT = 'Management and security';
const CLASS = 'Class';
const CARGO = 'Cargo';
const LIABILITY = 'Liability and insurance';
const HEALTH = 'Health';

export const CERTIFICATES: readonly { key: string; name: string; group: string }[] = [
  { key: 'registry', name: 'Certificate of Registry', group: REGISTRY },
  { key: 'tonnage', name: 'International Tonnage Certificate (1969)', group: REGISTRY },
  { key: 'csr', name: 'Continuous Synopsis Record', group: REGISTRY },

  { key: 'safeManning', name: 'Minimum Safe Manning Document', group: SAFETY },
  { key: 'safetyConstruction', name: 'Cargo Ship Safety Construction', group: SAFETY },
  { key: 'safetyEquipment', name: 'Cargo Ship Safety Equipment', group: SAFETY },
  { key: 'safetyRadio', name: 'Cargo Ship Safety Radio', group: SAFETY },
  { key: 'loadLine', name: 'International Load Line', group: SAFETY },

  { key: 'iopp', name: 'IOPP', group: POLLUTION },
  { key: 'ispp', name: 'ISPP (sewage)', group: POLLUTION },
  { key: 'iapp', name: 'IAPP', group: POLLUTION },
  { key: 'iee', name: 'IEE', group: POLLUTION },
  { key: 'bwm', name: 'Ballast Water Management', group: POLLUTION },
  { key: 'iafs', name: 'Anti-Fouling System (IAFS)', group: POLLUTION },
  { key: 'ihm', name: 'Inventory of Hazardous Materials (Statement of Compliance)', group: POLLUTION },

  { key: 'docIsm', name: 'Document of Compliance (ISM, copy)', group: MANAGEMENT },
  { key: 'smc', name: 'Safety Management Certificate', group: MANAGEMENT },
  { key: 'issc', name: 'ISSC', group: MANAGEMENT },
  { key: 'mlc', name: 'Maritime Labour Certificate', group: MANAGEMENT },
  { key: 'dmlc1', name: 'DMLC Part I', group: MANAGEMENT },
  { key: 'dmlc2', name: 'DMLC Part II', group: MANAGEMENT },

  { key: 'classHull', name: 'Class Certificate (Hull)', group: CLASS },
  { key: 'classMachinery', name: 'Class Certificate (Machinery)', group: CLASS },

  { key: 'grainAuthorization', name: 'Document of Authorization for carriage of grain', group: CARGO },
  { key: 'docDangerousGoods', name: 'Document of Compliance for Dangerous Goods / IMSBC solid bulk cargoes', group: CARGO },

  { key: 'pandiEntry', name: 'P&I Certificate of Entry', group: LIABILITY },
  { key: 'bunkerClc', name: 'Bunker Convention (CLC) Certificate', group: LIABILITY },
  { key: 'wreckRemoval', name: 'Wreck Removal Certificate', group: LIABILITY },
  { key: 'hullMachineryInsurance', name: 'Hull & Machinery insurance', group: LIABILITY },

  { key: 'sanitation', name: 'Ship Sanitation Control (Exemption) Certificate', group: HEALTH },

  { key: 'other', name: 'Other', group: 'Other' },
];

const COMPETENCY = 'Competency';
const CREW_HEALTH = 'Health';
const STCW = 'STCW courses';
const VISAS = 'Visas';

/**
 * The papers a crew member can hold, in the order of the document form's select. `graded` is true for the ones that
 * name a grade or capacity (the rank or limits the holder may serve in).
 */
export const CREW_DOC_TYPES: readonly { key: CrewDocType; label: string; group: string; graded: boolean }[] = [
  { key: 'coc', label: 'Certificate of Competency (CoC)', group: COMPETENCY, graded: true },
  { key: 'endorsement', label: 'Flag endorsement', group: COMPETENCY, graded: true },
  { key: 'gmdss', label: 'GMDSS certificate', group: COMPETENCY, graded: true },

  { key: 'medical', label: 'Medical fitness certificate', group: CREW_HEALTH, graded: false },
  { key: 'yellowFever', label: 'Yellow fever certificate', group: CREW_HEALTH, graded: false },

  { key: 'bst', label: 'Basic safety training', group: STCW, graded: false },
  { key: 'aff', label: 'Advanced fire fighting', group: STCW, graded: false },
  { key: 'pscrb', label: 'Survival craft and rescue boats', group: STCW, graded: false },
  { key: 'frb', label: 'Fast rescue boats', group: STCW, graded: false },
  { key: 'mfa', label: 'Medical first aid', group: STCW, graded: false },
  { key: 'medicalCare', label: 'Medical care', group: STCW, graded: false },
  { key: 'securityAwareness', label: 'Security awareness', group: STCW, graded: false },
  { key: 'dsd', label: 'Designated security duties', group: STCW, graded: false },
  { key: 'sso', label: 'Ship security officer', group: STCW, graded: false },
  { key: 'ecdis', label: 'ECDIS', group: STCW, graded: false },
  { key: 'brm', label: 'Bridge resource management', group: STCW, graded: false },
  { key: 'erm', label: 'Engine-room resource management', group: STCW, graded: false },
  { key: 'highVoltage', label: 'High voltage', group: STCW, graded: false },

  { key: 'usVisa', label: 'US C1/D visa', group: VISAS, graded: false },
  { key: 'schengenVisa', label: 'Schengen visa', group: VISAS, graded: false },

  { key: 'other', label: 'Other', group: 'Other', graded: false },
];

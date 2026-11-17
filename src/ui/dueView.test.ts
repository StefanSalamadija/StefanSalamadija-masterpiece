import { describe, expect, it } from 'vitest';
import type { Alert } from '../domain/alerts';
import { CREW_DOC_KINDS, daysBetween, dueChipText, dueRow, groupDue, NOTHING_DUE, shortDate } from './dueView';

const TODAY = '2026-11-17';
const PERSON = { rank: '2nd Officer', name: 'R. EXAMPLE' };

function alert(over: Partial<Alert>): Alert {
  return {
    key: 'crewDoc:c-1', kind: 'crewDoc', band: 'red', title: 'Robert EXAMPLE', detail: 'Passport expired 2026-11-12',
    href: '#/ship/crew/c-1', due: '2026-11-12', what: 'Passport', person: PERSON, ...over,
  };
}

describe('daysBetween', () => {
  it('counts whole days from the first date to the second', () => {
    expect(daysBetween('2026-11-17', '2026-12-01')).toBe(14);
    expect(daysBetween('2026-11-17', '2026-11-17')).toBe(0);
    expect(daysBetween('2026-11-17', '2026-11-12')).toBe(-5);
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2); // across the clocks going back in Europe
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
  });
});

describe('dueChipText', () => {
  it('says in N d, today or N d over', () => {
    expect(dueChipText('2026-12-01', TODAY)).toBe('in 14 d');
    expect(dueChipText('2026-11-17', TODAY)).toBe('today');
    expect(dueChipText('2026-11-12', TODAY)).toBe('5 d over');
    expect(dueChipText('2026-11-18', TODAY)).toBe('in 1 d');
    expect(dueChipText('2026-11-16', TODAY)).toBe('1 d over');
  });

  it('counts across a month end and a year end', () => {
    expect(dueChipText('2026-12-02', '2026-11-28')).toBe('in 4 d');
    expect(dueChipText('2026-11-28', '2026-12-02')).toBe('4 d over');
    expect(dueChipText('2027-01-03', '2026-12-30')).toBe('in 4 d');
    expect(dueChipText('2026-12-30', '2027-01-03')).toBe('4 d over');
  });
});

describe('shortDate', () => {
  it('gives the day and the month, and the year when it is not this one', () => {
    expect(shortDate('2026-11-12', TODAY)).toBe('12 Nov');
    expect(shortDate('2026-12-01', TODAY)).toBe('1 Dec');
    expect(shortDate('2027-01-03', TODAY)).toBe('3 Jan 2027');
    expect(shortDate('2025-12-31', TODAY)).toBe('31 Dec 2025');
  });

  it('gives back text that is not a date as it is', () => {
    expect(shortDate('', TODAY)).toBe('');
    expect(shortDate('2026-02-30', TODAY)).toBe('2026-02-30');
  });
});

describe('dueRow', () => {
  it('names a crew paper by what it is and who has it', () => {
    expect(dueRow(alert({}), TODAY)).toEqual({
      key: 'crewDoc:c-1', href: '#/ship/crew/c-1', tone: 'danger', title: 'Passport · 2nd Officer R. EXAMPLE', meta: 'Expired 12 Nov', chip: '5 d over',
    });
    expect(dueRow(alert({ band: 'amber', what: "Seaman's book", due: '2026-12-12' }), TODAY)).toMatchObject({
      tone: 'warn', title: "Seaman's book · 2nd Officer R. EXAMPLE", meta: 'Expires 12 Dec', chip: 'in 25 d',
    });
    expect(dueRow(alert({ kind: 'crewCertificate', key: 'crewCertificate:d-1', band: 'amber', what: 'Medical fitness certificate', due: '2027-01-10' }), TODAY))
      .toMatchObject({ title: 'Medical fitness certificate · 2nd Officer R. EXAMPLE', meta: 'Expires 10 Jan 2027', chip: 'in 54 d' });
  });

  it('says whether the relief of a contract is planned', () => {
    const contract = alert({ kind: 'contract', key: 'contract:c-1', band: 'amber', what: 'Contract end', due: '2026-12-01', href: '#/ship/reliefs' });
    expect(dueRow({ ...contract, reliefPlanned: '2026-12-05' }, TODAY)).toEqual({
      key: 'contract:c-1', href: '#/ship/reliefs', tone: 'warn', title: 'Contract end · 2nd Officer R. EXAMPLE', meta: 'Relief planned 5 Dec', chip: 'in 14 d',
    });
    expect(dueRow(contract, TODAY).meta).toBe('Relief not planned');
    expect(dueRow({ ...contract, band: 'red', due: '2026-11-10' }, TODAY)).toMatchObject({ tone: 'danger', meta: 'Relief not planned', chip: '7 d over' });
  });

  it('says when the onboard limit is reached', () => {
    const limit = alert({ kind: 'onboardLimit', key: 'onboardLimit:c-1', what: '11-month limit', due: '2026-11-03', href: '#/ship/reliefs' });
    expect(dueRow(limit, TODAY)).toMatchObject({ tone: 'danger', title: '11-month limit · 2nd Officer R. EXAMPLE', meta: 'Reached 3 Nov', chip: '14 d over' });
    expect(dueRow({ ...limit, band: 'amber', due: '2026-12-03' }, TODAY)).toMatchObject({ tone: 'warn', meta: 'Reaches 3 Dec', chip: 'in 16 d' });
    expect(dueRow({ ...limit, due: TODAY }, TODAY)).toMatchObject({ meta: 'Reached 17 Nov', chip: 'today' });
  });

  it('keeps the title of a ship certificate, and says what and when in the meta', () => {
    const certificate = alert({
      kind: 'certificate', key: 'certificate:k-1', band: 'amber', title: 'International Load Line', detail: 'Expires 2026-12-01',
      href: '#/ship/certificates/k-1', due: '2026-12-01', what: 'Ship certificate', person: undefined,
    });
    expect(dueRow(certificate, TODAY)).toEqual({
      key: 'certificate:k-1', href: '#/ship/certificates/k-1', tone: 'warn', title: 'International Load Line', meta: 'Ship certificate · 1 Dec', chip: 'in 14 d',
    });
    expect(dueRow({ ...certificate, band: 'red', what: 'Survey', due: '2026-10-02' }, TODAY)).toMatchObject({ tone: 'danger', meta: 'Survey · 2 Oct', chip: '46 d over' });
  });

  it('leaves out a rank that is empty', () => {
    expect(dueRow(alert({ person: { rank: '', name: 'SAMPLE' } }), TODAY).title).toBe('Passport · SAMPLE');
  });
});

describe('groupDue', () => {
  it('puts red under overdue and amber under due soon, in the order given', () => {
    const list = [
      alert({ key: 'a', band: 'red' }), alert({ key: 'b', band: 'red' }), alert({ key: 'c', band: 'amber' }),
      alert({ key: 'd', band: 'amber' }), alert({ key: 'e', band: 'amber' }),
    ];
    const { overdue, soon } = groupDue(list);
    expect(overdue.map((x) => x.key)).toEqual(['a', 'b']);
    expect(soon.map((x) => x.key)).toEqual(['c', 'd', 'e']);
    expect(groupDue([])).toEqual({ overdue: [], soon: [] });
  });
});

describe('the words', () => {
  it('has the empty line and the crew document kinds', () => {
    expect(NOTHING_DUE).toBe('✓ Nothing due');
    expect(CREW_DOC_KINDS).toEqual(['crewDoc', 'crewCertificate']);
  });
});

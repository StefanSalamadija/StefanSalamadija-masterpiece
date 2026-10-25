import { describe, expect, it } from 'vitest';
import type { CrewMember } from '../types';
import { guessMapping } from './mapping';
import { buildPreview } from './preview';
import type { PreviewRow } from './preview';
import type { Cell } from './readSpreadsheet';
import { recheckRows } from './recheck';

const TODAY = '2026-10-25';
const HEADER: Cell[] = ['Surname', 'Given names', 'Rank', 'Date of birth', 'Passport No', 'Sign on', 'Sign off'];
const DUPLICATE = { field: 'passportNo', message: 'Duplicate passport number in this file.', severity: 'error' };

let seq = 0;
function crewMember(over: Partial<CrewMember> = {}): CrewMember {
  seq += 1;
  return {
    id: `crew-${seq}`, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'test-device', deleted: false, scope: 'ship', shipId: 'ship-1',
    surname: 'PETROVIĆ', givenNames: 'Ivan', rank: 'master', nationality: 'Croatian',
    dateOfBirth: '1985-01-05', placeOfBirth: 'Split', passportNo: 'OLD 1', passportExpiry: '2030-01-01',
    seamansBookNo: 'SB1', seamansBookExpiry: '2030-02-02', signOnDate: '2026-06-01', signOnPort: 'Rijeka',
    ...over,
  };
}

/** The preview of a sheet below the header, as the wizard has it before the user does anything. */
function preview(existing: CrewMember[], ...data: Cell[][]): PreviewRow[] {
  return buildPreview({
    rows: [HEADER, ...data], headerRow: 0, mapping: guessMapping(HEADER), dateFormat: 'day-first', existing,
    currentYear: 2026, today: TODAY, defaultSignOnDate: TODAY,
  });
}
const recheck = (rows: PreviewRow[], existing: CrewMember[] = []): PreviewRow[] => recheckRows(rows, existing, TODAY);
const withSkip = (row: PreviewRow, skip = true): PreviewRow => ({ ...row, skip });
const statuses = (rows: PreviewRow[]): string[] => rows.map(row => row.status);
interface FieldErrorLike { field: string; message: string; severity: string }

describe('recheckRows', () => {
  it('leaves a preview with nothing wrong across rows as it was built, and does not change its input', () => {
    const rows = preview([], ['PETROVIĆ', 'Ivan', 'Master', '05.01.1985', 'P1', ''], ['ŠAŠIĆ', 'Marko', 'C/O', '12.12.1990', 'P2', ''], ["O'BRIEN", 'Jean-Luc', 'A/B', '31.02.1990', 'X1', '']);
    const before = structuredClone(rows);
    expect(recheck(rows)).toEqual(rows);
    expect(rows).toEqual(before);
  });

  it('revalidates each row against its edited draft, keeping the row number and the skip flag', () => {
    const [bad] = preview([], ["O'BRIEN", 'Jean-Luc', 'A/B', '31.02.1990', 'X1', '']);
    expect(bad.status).toBe('error');
    const fixed = recheck([withSkip({ ...bad, draft: { ...bad.draft, dateOfBirth: '1990-02-28' } })]);
    expect(fixed[0]).toMatchObject({ status: 'new', errors: [], rowNumber: bad.rowNumber, skip: true });
  });

  describe('duplicate passport numbers', () => {
    it('flags every row that shares a passport number, whatever the spaces and case, and keeps their other errors', () => {
      const rows = preview([], ['A', 'Ana', 'AB', '', 'P 77', ''], ['B', 'Ben', 'AB', '31.02.1990', 'p77', ''], ['C', 'Cid', 'AB', '', 'P78', '']);
      const result = recheck(rows);
      expect(statuses(result)).toEqual(['error', 'error', 'new']);
      expect(result[0].errors).toEqual([DUPLICATE]);
      expect(result[1].errors).toEqual([{ field: 'dateOfBirth', message: 'Enter a valid date.', severity: 'error' }, DUPLICATE]);
      expect(result[2].errors).toEqual([]);
    });

    it('notices a passport number edited to be another row\'s, and lets go of both when it is edited back', () => {
      const rows = preview([], ['A', 'Ana', 'AB', '', 'P1', ''], ['B', 'Ben', 'AB', '', 'P2', '']);
      const edited = rows.map((row, i) => (i === 1 ? { ...row, draft: { ...row.draft, passportNo: 'P1' } } : row));
      const clash = recheck(edited);
      expect(statuses(clash)).toEqual(['error', 'error']);
      const back = recheck(clash.map((row, i) => (i === 1 ? { ...row, draft: { ...row.draft, passportNo: 'P2' } } : row)));
      expect(statuses(back)).toEqual(['new', 'new']);
      expect(back.map(row => row.errors)).toEqual([[], []]);
    });

    it('does not count a skipped row, so skipping one of two frees the other', () => {
      const rows = preview([], ['A', 'Ana', 'AB', '', 'P1', ''], ['B', 'Ben', 'AB', '', 'P1', '']);
      const result = recheck([rows[0], withSkip(rows[1])]);
      expect(statuses(result)).toEqual(['new', 'new']);
      expect(result[1].skip).toBe(true);
      expect(recheck([withSkip(rows[0]), withSkip(rows[1])]).map(row => row.errors)).toEqual([[], []]);
    });

    it('ignores empty passport numbers', () => {
      const rows = preview([], ['A', 'Ana', 'AB', '', '', ''], ['B', 'Ben', 'AB', '', '', '']);
      expect(statuses(recheck(rows))).toEqual(['new', 'new']);
    });
  });

  describe('a passport of an earlier contract', () => {
    const old = crewMember({ surname: 'HORVAT', givenNames: 'Ana', dateOfBirth: '1977-07-07', passportNo: 'P1', signOnDate: '2025-01-01', signOffDate: '2025-06-30' });
    const current = crewMember({ surname: 'HORVAT', givenNames: 'Ana', dateOfBirth: '1977-07-07', passportNo: 'P2', signOnDate: '2026-06-01' }); // the passport was renewed
    const crew = [old, current];
    const ana = (passport: string): Cell[] => ['HORVAT', 'Ana', 'C/O', '07.07.1977', passport, ''];
    const earlier = (later: CrewMember): FieldErrorLike => ({
      field: 'passportNo', severity: 'error',
      message: `This passport belongs to an earlier contract. Ana HORVAT's latest contract (from ${later.signOnDate}) has passport ${later.passportNo}.`,
    });

    it('makes an update that would change the earlier contract an error, naming the latest contract of the person', () => {
      const [row] = recheck(preview(crew, ana('P1')), crew);
      expect(row).toMatchObject({ status: 'error', existingId: old.id });
      expect(row.errors).toEqual([earlier(current)]);
    });

    it('leaves an update of the latest contract alone', () => {
      const [row] = recheck(preview(crew, ana('P2')), crew);
      expect(row).toMatchObject({ status: 'update', existingId: current.id, errors: [] });
    });

    it('names the latest of several later contracts, and a passport it does not have', () => {
      const middle = crewMember({ surname: 'HORVAT', givenNames: 'Ana', dateOfBirth: '1977-07-07', passportNo: 'P3', signOnDate: '2025-09-01', signOffDate: '2025-12-31' });
      const [row] = recheck(preview([old, middle, current], ana('P1')), [old, middle, current]);
      expect(row.errors).toEqual([earlier(current)]);
      const noPassport = { ...current, passportNo: '' };
      const [blank] = recheck(preview([old, noPassport], ana('P1')), [old, noPassport]);
      expect(blank.errors[0].message).toBe("This passport belongs to an earlier contract. Ana HORVAT's latest contract (from 2026-06-01) has no passport number.");
    });

    it('is cleared when the passport is fixed to the latest contract\'s, which the row then updates', () => {
      const [row] = recheck(preview(crew, ana('P1')), crew);
      // The row carried the dates of the earlier contract, so the user moves those to the latest one's as well.
      const { signOffDate: _ended, ...kept } = row.draft;
      const fixed = recheck([{ ...row, draft: { ...kept, passportNo: 'P2', signOnDate: '2026-06-01' } }], crew);
      expect(fixed[0]).toMatchObject({ status: 'update', existingId: current.id, errors: [] });
    });

    it('does not apply to a skipped row, or to a row that changes nothing, which writes nothing', () => {
      const [row] = preview(crew, ana('P1'));
      expect(recheck([withSkip(row)], crew)[0]).toMatchObject({ status: 'update', errors: [] });
      const [same] = preview(crew, ['HORVAT', 'Ana', 'Master', '07.07.1977', 'P1', '']);
      expect(same).toMatchObject({ status: 'update', changes: [] });
      expect(recheck([same], crew)[0]).toMatchObject({ status: 'update', errors: [] });
    });

    it('does not apply to someone who only has the same passport number as nobody else, or whose later contract is deleted', () => {
      expect(recheck(preview([old], ana('P1')), [old])[0].status).toBe('update');
      const deleted = { ...current, deleted: true };
      expect(recheck(preview([old, deleted], ana('P1')), [old, deleted])[0].status).toBe('update');
    });
  });

  describe('overlapping contracts', () => {
    const onboard = crewMember(); // open since 2026-06-01, passport OLD 1
    const ivan = ['PETROVIĆ', 'Ivan', 'Master', '05.01.1985', 'NEW 1', ''] as Cell[];

    it('flags a new row whose person is already onboard under another passport, linked by name and date of birth', () => {
      const [row] = recheck(preview([onboard], ivan), [onboard]);
      expect(row.status).toBe('error');
      expect(row.errors).toEqual([{
        field: 'signOnDate', severity: 'error', message: "This overlaps Ivan PETROVIĆ's contract from 2026-06-01 (still onboard).",
      }]);
    });

    it('names the dates of a contract that ended', () => {
      const ended = crewMember({ signOffDate: '2026-11-30' });
      const [row] = recheck(preview([ended], ivan), [ended]);
      expect(row.errors[0].message).toBe("This overlaps Ivan PETROVIĆ's contract from 2026-06-01 to 2026-11-30.");
    });

    it('accepts a contract that starts after the other one ended', () => {
      const ended = crewMember({ signOffDate: '2026-10-24' });
      expect(statuses(recheck(preview([ended], ivan), [ended]))).toEqual(['new']);
    });

    it('flags an update that moves the contract into another one of the same person, but not into itself', () => {
      const earlier = crewMember({ passportNo: 'P9', signOnDate: '2025-01-01', signOffDate: '2025-06-30' });
      const latest = crewMember({ passportNo: 'P9', signOnDate: '2026-06-01' });
      const own = recheck(preview([earlier, latest], ['PETROVIĆ', 'Ivan', 'Master', '05.01.1985', 'P9', '02.06.2026']), [earlier, latest]);
      expect(own[0]).toMatchObject({ status: 'update', existingId: latest.id, errors: [] });
      const clash = recheck(preview([earlier, latest], ['PETROVIĆ', 'Ivan', 'Master', '05.01.1985', 'P9', '01.05.2025']), [earlier, latest]);
      expect(clash[0].status).toBe('error');
      expect(clash[0].errors[0].message).toBe("This overlaps Ivan PETROVIĆ's contract from 2025-01-01 to 2025-06-30.");
    });

    it('flags both of two new rows for one person that run into each other, and frees the other when one is skipped', () => {
      const rows = preview([], ['PETROVIĆ', 'Ivan', 'Master', '05.01.1985', 'A1', '01.07.2026'], ['PETROVIĆ', 'Ivan', 'Master', '05.01.1985', 'B1', '15.08.2026']);
      const both = recheck(rows);
      expect(statuses(both)).toEqual(['error', 'error']);
      expect(both[0].errors[0]).toMatchObject({ field: 'signOnDate', message: `This overlaps row ${rows[1].rowNumber} of this file.` });
      expect(both[1].errors[0]).toMatchObject({ field: 'signOnDate', message: `This overlaps row ${rows[0].rowNumber} of this file.` });
      const one = recheck([rows[0], withSkip(rows[1])]);
      expect(statuses(one)).toEqual(['new', 'new']);
      expect(one[1].errors).toEqual([]);
    });

    it('does not flag a new row against a contract that another row of the file ends', () => {
      const open = crewMember({ passportNo: 'P9' });
      const rows = preview([open],
        ['PETROVIĆ', 'Ivan', 'Master', '05.01.1985', 'P9', '01.06.2026', '30.09.2026'],
        ['PETROVIĆ', 'Ivan', 'Master', '05.01.1985', 'NEW 1', '01.10.2026']);
      expect(rows[0]).toMatchObject({ status: 'update', changes: [{ field: 'signOffDate', from: '', to: '2026-09-30' }] });
      expect(statuses(recheck(rows, [open]))).toEqual(['update', 'new']);
    });

    it('flags that same new row once the row that ends the other contract is skipped', () => {
      const open = crewMember({ passportNo: 'P9' });
      const rows = preview([open],
        ['PETROVIĆ', 'Ivan', 'Master', '05.01.1985', 'P9', '01.06.2026', '30.09.2026'],
        ['PETROVIĆ', 'Ivan', 'Master', '05.01.1985', 'NEW 1', '01.10.2026']);
      expect(statuses(recheck([withSkip(rows[0]), rows[1]], [open]))).toEqual(['update', 'error']);
    });

    it('does not check a skipped row', () => {
      const [row] = preview([onboard], ivan);
      expect(recheck([withSkip(row)], [onboard])[0]).toMatchObject({ status: 'new', errors: [], skip: true });
    });

    it('does not check an update that changes nothing, so a clash that was already in the records is not blamed on the file', () => {
      const first = crewMember({ passportNo: 'P9' });
      const second = crewMember({ passportNo: 'P9B', signOnDate: '2026-07-01' }); // the same person, running into the first
      const [row] = preview([first, second], ['PETROVIĆ', 'Ivan', 'Master', '05.01.1985', 'P9B', '']);
      expect(row).toMatchObject({ status: 'update', changes: [] });
      expect(recheck([row], [first, second])[0]).toMatchObject({ status: 'update', errors: [] });
    });

    it('does not take a row that is itself wrong for a contract to run into', () => {
      const rows = preview([], ['PETROVIĆ', 'Ivan', 'Master', '05.01.1985', 'A1', '01.07.2026'], ['PETROVIĆ', 'Ivan', 'Master', '05.01.1985', 'B1', '15.08.2026', '31.02.2026']);
      expect(rows[1].status).toBe('error');
      expect(statuses(recheck(rows))).toEqual(['new', 'error']);
    });

    it('leaves people who only share a name or a birth date alone', () => {
      const other = crewMember({ surname: 'HORVAT', givenNames: 'Ana', dateOfBirth: '1985-01-05', passportNo: 'Z1' });
      const rows = preview([other], ['PETROVIĆ', 'Ivan', 'Master', '05.01.1985', 'NEW 1', ''], ['HORVAT', 'Ana', 'AB', '07.07.1977', 'NEW 2', '']);
      expect(statuses(recheck(rows, [other]))).toEqual(['new', 'new']);
    });

    it('ignores deleted crew', () => {
      const gone = crewMember({ deleted: true });
      expect(statuses(recheck(preview([], ivan), [gone]))).toEqual(['new']);
    });
  });

  it('stays fast for a long list: 6,000 rows born on one day, rechecked in well under a second each time', () => {
    const rows = Array.from({ length: 6000 }, (_, i): Cell[] => [`SURNAME${i}`, `Name${i}`, 'AB', '14.03.1980', `P${i}`, '']);
    const existing = Array.from({ length: 100 }, (_, i) => crewMember({ surname: `OLD${i}`, givenNames: `Crew${i}`, passportNo: `E${i}`, dateOfBirth: '1980-03-14' }));
    const built = preview(existing, ...rows);
    const started = performance.now();
    const checked = recheck(built, existing);
    const again = recheck(checked.map((row, i) => (i === 0 ? withSkip(row) : row)), existing);
    expect((performance.now() - started) / 2).toBeLessThan(1000);
    expect(checked.filter(row => row.status === 'new')).toHaveLength(6000);
    expect(again[0].skip).toBe(true);
  });
});

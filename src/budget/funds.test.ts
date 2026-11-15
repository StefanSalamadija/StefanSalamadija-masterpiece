import { describe, expect, it } from 'vitest';
import { fund, move } from '../test/budgetRecords';
import { fundPayment, fundStatus } from './funds';

describe('fundStatus', () => {
  const car = fund({ id: 'car', amount: 60000, dueYm: '2027-03', createdAt: '2026-11-02T08:00:00.000Z' });

  it('spreads what is missing over the months left, the due month included', () => {
    expect(fundStatus(car, [], '2026-11')).toEqual({ balance: 0, dueYm: '2027-03', monthsLeft: 5, setAside: 12000, behind: false });
    expect(fundStatus(car, [], '2027-03')).toMatchObject({ monthsLeft: 1, setAside: 60000 });
  });

  it('counts the start balance and the set-asides so far', () => {
    const withStart = fund({ id: 'car', amount: 60000, dueYm: '2027-03', startBalance: 10000, createdAt: '2026-11-02T08:00:00.000Z' });
    const moves = [move('car', '2026-11', 'setaside', 10000), move('car', '2026-12', 'setaside', 10000), move('car', '2027-05', 'setaside', 999)];
    // December asks for (60,000 − 20,000) ÷ 4, from the balance before December's own set-aside.
    expect(fundStatus(withStart, moves, '2026-12')).toEqual({ balance: 30000, dueYm: '2027-03', monthsLeft: 4, setAside: 10000, behind: false });
  });

  it('rounds a set-aside up to the cent, so the fund is full on time', () => {
    const odd = fund({ id: 'odd', amount: 10000, dueYm: '2027-01' });
    expect(fundStatus(odd, [], '2026-11').setAside).toBe(3334);
  });

  it('asks for the whole remainder when the fund is overdue', () => {
    const moves = [move('car', '2026-12', 'setaside', 20000)];
    expect(fundStatus(car, moves, '2027-04')).toEqual({ balance: 20000, dueYm: '2027-03', monthsLeft: 0, setAside: 40000, behind: true });
    expect(fundStatus(car, moves, '2027-09')).toMatchObject({ monthsLeft: 0, setAside: 40000, behind: true });
  });

  it('needs nothing once the fund holds its amount or more', () => {
    expect(fundStatus(car, [move('car', '2026-11', 'setaside', 60000)], '2026-12')).toMatchObject({ balance: 60000, setAside: 0, behind: false });
    expect(fundStatus(car, [move('car', '2026-11', 'setaside', 70000)], '2027-04')).toMatchObject({ balance: 70000, setAside: 0, behind: false });
  });

  it('is behind when last month\'s set-aside fell short, but not in the fund\'s first month', () => {
    expect(fundStatus(car, [], '2026-11').behind).toBe(false);
    expect(fundStatus(car, [], '2026-12')).toMatchObject({ setAside: 15000, behind: true });
    expect(fundStatus(car, [move('car', '2026-11', 'setaside', 12000)], '2026-12')).toMatchObject({ setAside: 12000, behind: false });
    expect(fundStatus(car, [move('car', '2026-11', 'setaside', 11999)], '2026-12').behind).toBe(true);
  });

  it('a repeating fund starts its next cycle when the bill is paid, and carries the leftover', () => {
    const insurance = fund({ id: 'ins', amount: 60000, dueYm: '2027-03', repeatMonths: 12, createdAt: '2026-11-02T08:00:00.000Z' });
    const moves = [
      move('ins', '2026-11', 'setaside', 70000),
      move('ins', '2027-03', 'paid', 58000, { entryId: 'bill' }),
    ];
    expect(fundStatus(insurance, moves, '2027-02')).toMatchObject({ dueYm: '2027-03', setAside: 0 });
    // 12,000 left over; 48,000 more over March 2027 to March 2028 (13 months).
    expect(fundStatus(insurance, moves, '2027-03')).toEqual({ balance: 12000, dueYm: '2028-03', monthsLeft: 13, setAside: 3693, behind: false });
    expect(fundStatus(insurance, moves, '2027-04')).toMatchObject({ dueYm: '2028-03', monthsLeft: 12, setAside: 4000 });
    // March's set-aside for the new cycle, made after the bill, keeps March asking for the same.
    const after = [move('ins', '2026-11', 'setaside', 70000), move('ins', '2027-03', 'paid', 58000, { seq: 1 }), move('ins', '2027-03', 'setaside', 3693, { seq: 2 })];
    expect(fundStatus(insurance, after, '2027-03')).toMatchObject({ balance: 15693, setAside: 3693, behind: false });
    expect(fundStatus(insurance, after, '2027-04')).toMatchObject({ setAside: 3693, behind: false });
  });

  it('a repeating fund paid late still keeps its yearly due month', () => {
    const insurance = fund({ id: 'ins', amount: 60000, dueYm: '2027-03', repeatMonths: 12 });
    const moves = [move('ins', '2026-11', 'setaside', 60000), move('ins', '2027-05', 'paid', 60000)];
    expect(fundStatus(insurance, moves, '2027-05')).toMatchObject({ balance: 0, dueYm: '2028-03', monthsLeft: 11 });
  });

  it('a one-off fund is done once its bill is paid', () => {
    const moves = [move('car', '2026-11', 'setaside', 50000), move('car', '2027-03', 'paid', 50000)];
    expect(fundStatus(car, moves, '2027-03')).toEqual({ balance: 0, dueYm: '2027-03', monthsLeft: 1, setAside: 0, behind: false });
    expect(fundStatus(car, moves, '2027-06')).toMatchObject({ setAside: 0, behind: false });
  });

  it('a bill bigger than the fund empties it', () => {
    const moves = [move('car', '2026-11', 'setaside', 40000), move('car', '2027-03', 'paid', 65000)];
    expect(fundStatus(car, moves, '2027-03').balance).toBe(0);
  });

  it('ignores deleted records and other funds\' records', () => {
    const moves = [move('car', '2026-11', 'setaside', 40000, { deleted: true }), move('other', '2026-11', 'setaside', 40000)];
    expect(fundStatus(car, moves, '2026-12').balance).toBe(0);
  });
});

describe('fundPayment', () => {
  const car = fund({ id: 'car', amount: 60000, dueYm: '2027-03' });

  it('takes the bill from the fund, up to what it holds; the rest is overspend', () => {
    const moves = [move('car', '2026-11', 'setaside', 40000)];
    expect(fundPayment(car, moves, '2027-03', 30000)).toEqual({ fromFund: 30000, overspend: 0 });
    expect(fundPayment(car, moves, '2027-03', 65000)).toEqual({ fromFund: 40000, overspend: 25000 });
    expect(fundPayment(car, [], '2027-03', 5000)).toEqual({ fromFund: 0, overspend: 5000 });
  });
});

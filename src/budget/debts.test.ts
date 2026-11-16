import { describe, expect, it } from 'vitest';
import { amortise, extraDebtLine } from './debts';

describe('amortise', () => {
  it('pays a 0% loan down by the full instalment, the last one only what is left', () => {
    const plan = amortise({ balance: 100000, yearlyRatePct: 0, instalment: 30000 }, '2026-11');
    expect(plan.months).toEqual([
      { ym: '2026-11', interest: 0, principal: 30000, balance: 70000 },
      { ym: '2026-12', interest: 0, principal: 30000, balance: 40000 },
      { ym: '2027-01', interest: 0, principal: 30000, balance: 10000 },
      { ym: '2027-02', interest: 0, principal: 10000, balance: 0 },
    ]);
    expect(plan.debtFreeYm).toBe('2027-02');
    expect(plan.totalInterest).toBe(0);
  });

  it('matches a hand-computed table for a 6% loan (0.5% a month, interest rounded to the cent each month)', () => {
    // €1,000.00 at 6% a year, €300.00 a month including interest:
    //   month 1: interest 100,000 × 0.005 = 500.000 → 500;  principal 30,000 − 500 = 29,500; balance 70,500
    //   month 2: interest  70,500 × 0.005 = 352.500 → 353;  principal 29,647;                balance 40,853
    //   month 3: interest  40,853 × 0.005 = 204.265 → 204;  principal 29,796;                balance 11,057
    //   month 4: interest  11,057 × 0.005 =  55.285 →  55;  the last payment is 11,112;      balance 0
    const plan = amortise({ balance: 100000, yearlyRatePct: 6, instalment: 30000 }, '2026-11');
    expect(plan.months).toEqual([
      { ym: '2026-11', interest: 500, principal: 29500, balance: 70500 },
      { ym: '2026-12', interest: 353, principal: 29647, balance: 40853 },
      { ym: '2027-01', interest: 204, principal: 29796, balance: 11057 },
      { ym: '2027-02', interest: 55, principal: 11057, balance: 0 },
    ]);
    expect(plan.debtFreeYm).toBe('2027-02');
    expect(plan.totalInterest).toBe(500 + 353 + 204 + 55);
  });

  it('is paid off sooner, with less interest, with an extra payment', () => {
    const loan = { balance: 1000000, yearlyRatePct: 6, instalment: 20000 };
    const plain = amortise(loan, '2026-11');
    const extra = amortise({ ...loan, extra: (ym) => (ym === '2027-01' ? 100000 : 5000) }, '2026-11');
    expect(plain.debtFreeYm).toBeDefined();
    expect(extra.debtFreeYm).toBeDefined();
    expect(extra.months.length).toBeLessThan(plain.months.length);
    expect(extra.debtFreeYm! < plain.debtFreeYm!).toBe(true);
    expect(extra.totalInterest).toBeLessThan(plain.totalInterest);
    // The extra payment is all principal: January pays 20,000 + 100,000.
    const january = extra.months.find((m) => m.ym === '2027-01')!;
    expect(january.interest + january.principal).toBe(120000);
  });

  it('has no debt-free month when the instalment never covers the interest', () => {
    // €1,000.00 at 6% costs €5.00 a month in interest; €4.00 a month never pays it off.
    const plan = amortise({ balance: 100000, yearlyRatePct: 6, instalment: 400 }, '2026-11');
    expect(plan.debtFreeYm).toBeUndefined();
    expect(plan.months).toHaveLength(720);
    expect(plan.months[0]).toEqual({ ym: '2026-11', interest: 500, principal: -100, balance: 100100 });
    expect(plan.totalInterest).toBe(plan.months.reduce((sum, m) => sum + m.interest, 0));
  });

  it('stops at maxMonths', () => {
    expect(amortise({ balance: 100000, yearlyRatePct: 0, instalment: 0 }, '2026-11', 12).months).toHaveLength(12);
  });

  it('is already debt-free (from the month before) when there is nothing to pay', () => {
    expect(amortise({ balance: 0, yearlyRatePct: 6, instalment: 30000 }, '2026-11')).toEqual({ months: [], debtFreeYm: '2026-10', totalInterest: 0 });
  });
});

describe('extraDebtLine', () => {
  it('says how much sooner an extra amount pays the debt off', () => {
    expect(extraDebtLine(5000, '2027-02', '2026-12')).toBe("With an extra €50.00/month you'd be debt-free in December 2026 (2 months sooner)");
    expect(extraDebtLine(5000, '2027-02', '2027-01')).toBe("With an extra €50.00/month you'd be debt-free in January 2027 (1 month sooner)");
    expect(extraDebtLine(5000, undefined, '2027-01')).toBe("With an extra €50.00/month you'd be debt-free in January 2027");
    expect(extraDebtLine(5000, '2027-02', undefined)).toBeUndefined();
  });
});

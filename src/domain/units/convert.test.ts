import { describe, expect, it } from 'vitest';
import { beaufortRange, convertFrom, fromBase, parseUnitInput, toBase } from './convert';
import { GROUPS, UNITS, unitById, unitsOf } from './table';

const close = (a: number, b: number, rel = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(Math.abs(b) * rel + 1e-12);

describe('unit conversions', () => {
  it('pins definitions', () => {
    close(unitById('ft').factor!, 0.3048);
    close(unitById('nm').factor!, 1852);
    close(unitById('cable').factor!, 185.2);
    close(unitById('fathom').factor!, 1.8288);
    close(unitById('shackle').factor!, 27.5);
    close(unitById('lt').factor!, 1016.0469088);
    close(unitById('st').factor!, 907.18474);
    close(unitById('lb').factor!, 0.45359237);
    close(unitById('usgal').factor!, 0.003785411784);
    close(unitById('impgal').factor!, 0.00454609);
    close(unitById('bbl').factor!, 42 * 0.003785411784);
    close(unitById('kn').factor!, 1852 / 3600);
    close(unitById('psi').factor!, 6894.757293168);
    close(unitById('kgfcm2').factor!, 98066.5);
    close(unitById('mmhg').factor!, 133.322387415);
    close(unitById('inhg').factor!, 3386.389);
    close(unitById('hp').factor!, 745.69987158227022);
    close(unitById('ps').factor!, 735.49875);
  });

  it('round-trips every unit', () => {
    for (const u of UNITS) if (u.kind !== 'beaufort' && u.kind !== 'ftin') close(fromBase(u, toBase(u, 7.25) as number), 7.25);
  });

  it('known values', () => {
    expect(convertFrom('nm', '1')).toMatchObject({ ok: true, values: { ft: '6076.12' } });
    expect(convertFrom('lt', '1')).toMatchObject({ values: { t: '1.016' } });
    expect(convertFrom('m3t', '1')).toMatchObject({ values: { ft3lt: '35.88' } });
    expect(convertFrom('api', '10')).toMatchObject({ values: { sg: '1.0000' } });
    expect(convertFrom('kpa', '100')).toMatchObject({ values: { psi: '14.5' } });
    expect(convertFrom('kn', '30')).toMatchObject({ values: { bf: '7' } });
    expect(convertFrom('bf', '7')).toMatchObject({ values: { kn: '30.5' } });
    expect(convertFrom('c', '-40')).toMatchObject({ values: { f: '-40.0' } });
    expect(convertFrom('shackle', '1')).toMatchObject({ values: { m: '27.500' } });
  });

  it('gives every other unit of the same quantity, never the source', () => {
    const r = convertFrom('m', '1');
    expect(r?.ok && Object.keys(r.values).sort()).toEqual(unitsOf('length').map((u) => u.id).filter((id) => id !== 'm').sort());
  });

  it('reads comma and spaces', () => {
    expect(parseUnitInput(unitById('m'), ' 12,5 ')).toBe(12.5);
  });

  it('refuses out of range', () => {
    expect(convertFrom('m', '-1')).toEqual({ ok: false, message: 'Must be 0 or more' });
    expect(convertFrom('c', '-274')).toEqual({ ok: false, message: 'Below absolute zero' });
    expect(convertFrom('k', '-1')).toEqual({ ok: false, message: 'Below absolute zero' });
    expect(convertFrom('sg', '0')).toEqual({ ok: false, message: 'Must be above 0' });
    expect(convertFrom('api', '-131.5')).toEqual({ ok: false, message: 'Must be above -131.5' });
    expect(convertFrom('bf', '13')).toEqual({ ok: false, message: 'Whole number 0–12' });
    expect(convertFrom('bf', '2.5')).toEqual({ ok: false, message: 'Whole number 0–12' });
    expect(convertFrom('m', 'abc')).toEqual({ ok: false, message: 'Not a number' });
    expect(convertFrom('m', '')).toBeUndefined();
  });

  it('every group quantity has units', () => {
    for (const g of GROUPS) for (const q of g.quantities) expect(unitsOf(q.id).length).toBeGreaterThan(1);
  });

  it('gives the knot range of a Beaufort force (review I2)', () => {
    expect(beaufortRange(0)).toBe('Force 0: under 1 kn');
    expect(beaufortRange(6)).toBe('Force 6: 22–27 kn');
    expect(beaufortRange(12)).toBe('Force 12: 64 kn and over');
  });
});

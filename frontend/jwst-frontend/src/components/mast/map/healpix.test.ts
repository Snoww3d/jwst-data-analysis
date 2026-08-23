import { describe, expect, it } from 'vitest';
import { ang2pixNest, orderForNside } from './healpix';

describe('ang2pixNest', () => {
  it('matches astropy_healpix (nside 64, nested) on pinned points', () => {
    // same points as processing-engine/tests/test_healpix.py
    const ra = [45.0, 123.4, 300.0, 10.0, 200.0];
    const dec = [89.9999, -41.8, 10.0, -89.0, 0.5];
    const expected = [4095, 39317, 30555, 32770, 26204];
    expect(ra.map((r, i) => ang2pixNest(64, r, dec[i]))).toEqual(expected);
  });

  it('nside 1 is the base face', () => {
    expect([45, 135, 225, 315].map((r) => ang2pixNest(1, r, 80))).toEqual([0, 1, 2, 3]);
    expect([45, 135, 225, 315].map((r) => ang2pixNest(1, r, -80))).toEqual([8, 9, 10, 11]);
  });

  it('wraps RA and stays in range', () => {
    expect(ang2pixNest(64, 370, 5)).toBe(ang2pixNest(64, 10, 5));
    expect(ang2pixNest(64, -10, 5)).toBe(ang2pixNest(64, 350, 5));
    for (let i = 0; i < 500; i++) {
      const p = ang2pixNest(64, (i * 7.3) % 360, -89 + ((i * 0.356) % 178));
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(12 * 64 * 64);
    }
  });

  it('orderForNside validates', () => {
    expect(orderForNside(64)).toBe(6);
    expect(() => orderForNside(6)).toThrow();
    expect(() => orderForNside(0)).toThrow();
  });
});

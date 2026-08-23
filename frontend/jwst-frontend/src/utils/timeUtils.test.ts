import { describe, it, expect } from 'vitest';
import { mjdToDate, dateToMjd, toMjd, formatMjdDate } from './timeUtils';

describe('timeUtils', () => {
  it('maps the Unix epoch to MJD 40587', () => {
    expect(mjdToDate(40587).toISOString()).toBe('1970-01-01T00:00:00.000Z');
    expect(dateToMjd(new Date('1970-01-01T00:00:00Z'))).toBe(40587);
  });

  it('round-trips through dateToMjd / mjdToDate', () => {
    const d = new Date('2023-07-12T13:45:00Z');
    expect(mjdToDate(dateToMjd(d)).getTime()).toBe(d.getTime());
    expect(dateToMjd(mjdToDate(60137.5))).toBeCloseTo(60137.5, 9);
  });

  it('handles fractional days', () => {
    expect(mjdToDate(40587.5).toISOString()).toBe('1970-01-01T12:00:00.000Z');
  });

  it('toMjd coerces numbers, numeric strings and ISO strings; rejects junk', () => {
    expect(toMjd(60000)).toBe(60000);
    expect(toMjd('60000.25')).toBe(60000.25);
    expect(toMjd('1970-01-02T00:00:00Z')).toBe(40588);
    expect(toMjd(undefined)).toBeNull();
    expect(toMjd(null)).toBeNull();
    expect(toMjd('not a date')).toBeNull();
    expect(toMjd(NaN)).toBeNull();
  });

  it('formatMjdDate renders a date or a dash', () => {
    expect(formatMjdDate(undefined)).toBe('-');
    expect(formatMjdDate(40587)).toBe(new Date(0).toLocaleDateString());
    expect(formatMjdDate('garbage')).toBe('garbage');
  });
});

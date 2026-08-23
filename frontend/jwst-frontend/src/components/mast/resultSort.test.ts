import { describe, it, expect } from 'vitest';
import {
  compareValues,
  sortRows,
  parseSortParam,
  toSortParam,
  nextSort,
  DEFAULT_SORT,
} from './resultSort';
import type { MastObservationResult } from '../../types/MastTypes';

describe('compareValues', () => {
  it('compares strings case-insensitively with numeric awareness', () => {
    expect(compareValues('ngc 3324', 'NGC 3372', 'string', 'asc')).toBeLessThan(0);
    expect(compareValues('F200W', 'F090W', 'string', 'asc')).toBeGreaterThan(0);
    expect(compareValues('jw02', 'jw10', 'string', 'asc')).toBeLessThan(0);
    expect(compareValues('a', 'b', 'string', 'desc')).toBeGreaterThan(0);
  });

  it('compares numbers, including numeric strings', () => {
    expect(compareValues(5, 50, 'number', 'asc')).toBeLessThan(0);
    expect(compareValues('5', 50, 'number', 'asc')).toBeLessThan(0);
    expect(compareValues(5, 50, 'number', 'desc')).toBeGreaterThan(0);
  });

  it('compares MJD columns whether given as MJD numbers or ISO strings', () => {
    expect(compareValues(60000, 60001, 'mjd', 'asc')).toBeLessThan(0);
    expect(compareValues('1970-01-03T00:00:00Z', 40588, 'mjd', 'asc')).toBeGreaterThan(0);
    expect(compareValues(60001, 60000, 'mjd', 'desc')).toBeLessThan(0);
  });

  it('sorts missing values last in either direction', () => {
    for (const dir of ['asc', 'desc'] as const) {
      expect(compareValues(undefined, 1, 'number', dir)).toBeGreaterThan(0);
      expect(compareValues(1, null, 'number', dir)).toBeLessThan(0);
      expect(compareValues('', 'x', 'string', dir)).toBeGreaterThan(0);
      expect(compareValues(NaN, 0, 'number', dir)).toBeGreaterThan(0);
      expect(compareValues('garbage', 60000, 'mjd', dir)).toBeGreaterThan(0);
    }
    expect(compareValues(undefined, null, 'number', 'asc')).toBe(0);
  });
});

describe('sortRows', () => {
  const rows: MastObservationResult[] = [
    { obs_id: 'b', t_exptime: 10, t_obs_release: 60002 },
    { obs_id: 'a', t_exptime: 10, t_obs_release: 60001 },
    { obs_id: 'c', t_exptime: undefined, t_obs_release: 60003 },
    { obs_id: 'd', t_exptime: 2, t_obs_release: undefined },
  ];

  it('defaults to newest release first with missing dates last', () => {
    expect(sortRows(rows, DEFAULT_SORT).map((r) => r.obs_id)).toEqual(['c', 'b', 'a', 'd']);
  });

  it('breaks ties on obs_id and keeps missing values last', () => {
    expect(sortRows(rows, { key: 't_exptime', dir: 'asc' }).map((r) => r.obs_id)).toEqual([
      'd',
      'a',
      'b',
      'c',
    ]);
    expect(sortRows(rows, { key: 't_exptime', dir: 'desc' }).map((r) => r.obs_id)).toEqual([
      'a',
      'b',
      'd',
      'c',
    ]);
  });

  it('does not mutate the input', () => {
    const copy = [...rows];
    sortRows(rows, { key: 'obs_id', dir: 'asc' });
    expect(rows).toEqual(copy);
  });
});

describe('sort URL param', () => {
  it('round-trips and omits the default', () => {
    expect(toSortParam(DEFAULT_SORT)).toBeUndefined();
    expect(toSortParam({ key: 't_exptime', dir: 'asc' })).toBe('t_exptime:asc');
    expect(parseSortParam('t_exptime:asc')).toEqual({ key: 't_exptime', dir: 'asc' });
  });

  it('falls back to the default for unknown columns or directions', () => {
    expect(parseSortParam(undefined)).toEqual(DEFAULT_SORT);
    expect(parseSortParam('nope:asc')).toEqual(DEFAULT_SORT);
    expect(parseSortParam('obs_id:sideways')).toEqual(DEFAULT_SORT);
  });

  it('nextSort flips the active column and starts a new one ascending', () => {
    expect(nextSort({ key: 'obs_id', dir: 'asc' }, 'obs_id')).toEqual({
      key: 'obs_id',
      dir: 'desc',
    });
    expect(nextSort({ key: 'obs_id', dir: 'desc' }, 't_min')).toEqual({ key: 't_min', dir: 'asc' });
  });
});

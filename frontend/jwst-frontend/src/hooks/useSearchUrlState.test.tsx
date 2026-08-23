import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigationType } from 'react-router-dom';
import type { ReactNode } from 'react';
import {
  DEFAULT_SEARCH_RADIUS,
  fromSearchParams,
  hasSearchIn,
  toSearchKey,
  toSearchParams,
  useSearchUrlState,
} from './useSearchUrlState';
import { EMPTY_FACETS } from '../utils/mastCriteria';

describe('toSearchParams / fromSearchParams', () => {
  it('round-trips every field', () => {
    const state = { q: '10h 37m -58°', r: '0.5', allLevels: true };
    // Phase 4 adds `facets` to what is read back; the hand-built state's
    // `allLevels: true` reads back as levels 1–3.
    expect(fromSearchParams(toSearchParams(state))).toEqual({
      ...state,
      facets: { ...EMPTY_FACETS, calibLevels: [1, 2, 3] },
    });
  });

  it('omits defaults so shared URLs stay short', () => {
    const params = toSearchParams({ q: 'M16', r: DEFAULT_SEARCH_RADIUS, allLevels: false });
    expect(params.toString()).toBe('q=M16');
  });

  it('omits a blank query', () => {
    expect(toSearchParams({ q: '   ', r: '1', allLevels: false }).toString()).toBe('r=1');
  });

  it('fills defaults when reading a bare URL', () => {
    expect(fromSearchParams(new URLSearchParams(''))).toEqual({
      q: '',
      r: DEFAULT_SEARCH_RADIUS,
      allLevels: false,
      facets: EMPTY_FACETS,
    });
  });

  it('falls back to the default radius for an unusable ?r=', () => {
    expect(fromSearchParams(new URLSearchParams('r=abc')).r).toBe(DEFAULT_SEARCH_RADIUS);
    expect(fromSearchParams(new URLSearchParams('r=0')).r).toBe(DEFAULT_SEARCH_RADIUS);
    expect(fromSearchParams(new URLSearchParams('r=50')).r).toBe(DEFAULT_SEARCH_RADIUS);
    expect(fromSearchParams(new URLSearchParams('r=2.5')).r).toBe('2.5');
  });

  it('treats only calib=all as all levels', () => {
    expect(fromSearchParams(new URLSearchParams('calib=all')).allLevels).toBe(true);
    expect(fromSearchParams(new URLSearchParams('calib=3')).allLevels).toBe(false);
  });

  describe('sort / view (Phase 3)', () => {
    it('round-trips a well-formed sort and view', () => {
      const state = { q: 'M16', r: '0.2', allLevels: false, sort: 't_exptime:asc' };
      expect(toSearchParams(state).toString()).toBe('q=M16&sort=t_exptime%3Aasc');
      expect(fromSearchParams(toSearchParams(state))).toEqual({ ...state, facets: EMPTY_FACETS });
      expect(fromSearchParams(new URLSearchParams('view=split')).view).toBe('split');
    });

    it('drops malformed sort and unknown view values', () => {
      expect(fromSearchParams(new URLSearchParams('sort=obs_id')).sort).toBeUndefined();
      expect(fromSearchParams(new URLSearchParams('sort=x:up')).sort).toBeUndefined();
      expect(fromSearchParams(new URLSearchParams('view=map')).view).toBeUndefined();
      expect(toSearchParams({ q: 'a', r: '0.2', allLevels: false, sort: 'bad' }).has('sort')).toBe(
        false
      );
    });

    it('searchKey ignores sort and view', () => {
      const a = toSearchKey({ q: 'M16', r: '0.5', allLevels: true, sort: 'obs_id:asc' });
      const b = toSearchKey({ q: 'M16', r: '0.5', allLevels: true, view: 'split' });
      expect(a).toBe(b);
      expect(a).toBe('q=M16&r=0.5&calib=all');
    });
  });

  describe('facets (Phase 4)', () => {
    const facets = {
      ...EMPTY_FACETS,
      instruments: ['MIRI', 'NIRCAM'],
      modes: ['IFU'],
      filters: ['F770W'],
      dataproductTypes: ['cube'],
      calibLevels: [2, 3],
      dateFrom: '2024-01-01',
      dateTo: '2024-06-30',
      expMin: '10',
      expMax: '',
      intent: 'any' as const,
    };

    it('round-trips every facet with a query', () => {
      const state = { q: 'M16', r: '0.2', allLevels: false, facets };
      const back = fromSearchParams(toSearchParams(state));
      expect(back.facets).toEqual(facets);
      expect(back.allLevels).toBe(false);
      expect(back.q).toBe('M16');
    });

    it('round-trips a facet-only URL including the release window', () => {
      const state = { q: '', r: '0.2', allLevels: false, facets: { ...facets, daysBack: 365 } };
      const params = toSearchParams(state);
      expect(params.getAll('inst')).toEqual(['MIRI', 'NIRCAM']);
      expect(params.get('days')).toBe('365');
      expect(fromSearchParams(params).facets).toEqual({ ...facets, daysBack: 365 });
    });

    it('drops the release window when there is a query (a position bounds it)', () => {
      const params = toSearchParams({
        q: 'M16',
        r: '0.2',
        allLevels: false,
        facets: { ...EMPTY_FACETS, daysBack: 365 },
      });
      expect(params.has('days')).toBe(false);
    });

    it('facets.calibLevels wins over allLevels and reads back consistently', () => {
      const params = toSearchParams({
        q: 'M16',
        r: '0.2',
        allLevels: true,
        facets: { ...EMPTY_FACETS, calibLevels: [3] },
      });
      expect(params.has('calib')).toBe(false);
      const all = fromSearchParams(new URLSearchParams('calib=all'));
      expect(all.allLevels).toBe(true);
      expect(all.facets?.calibLevels).toEqual([1, 2, 3]);
      const subset = fromSearchParams(new URLSearchParams('calib=2,3'));
      expect(subset.allLevels).toBe(false);
      expect(subset.facets?.calibLevels).toEqual([2, 3]);
    });

    it('searchKey includes the facets, so a filtered search is a different cache entry', () => {
      const plain = toSearchKey({ q: 'M16', r: '0.2', allLevels: false, facets: EMPTY_FACETS });
      const filtered = toSearchKey({
        q: 'M16',
        r: '0.2',
        allLevels: false,
        facets: { ...EMPTY_FACETS, instruments: ['MIRI'] },
      });
      expect(plain).toBe('q=M16');
      expect(filtered).toBe('q=M16&inst=MIRI');
    });

    it('hasSearchIn: a query, or narrowing facets; calib/intent alone are not a search', () => {
      expect(hasSearchIn({ q: '', r: '0.2', allLevels: false, facets: EMPTY_FACETS })).toBe(false);
      expect(hasSearchIn({ q: '', r: '0.2', allLevels: true })).toBe(false);
      expect(
        hasSearchIn({
          q: '',
          r: '0.2',
          allLevels: false,
          facets: { ...EMPTY_FACETS, intent: 'any' },
        })
      ).toBe(false);
      expect(
        hasSearchIn({
          q: '',
          r: '0.2',
          allLevels: false,
          facets: { ...EMPTY_FACETS, dataproductTypes: ['cube'] },
        })
      ).toBe(true);
      expect(hasSearchIn({ q: 'M16', r: '0.2', allLevels: false })).toBe(true);
    });
  });
});

describe('useSearchUrlState', () => {
  const wrapper =
    (initial: string) =>
    ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
    );

  it('reads state from the URL', () => {
    const { result } = renderHook(() => useSearchUrlState(), {
      wrapper: wrapper('/search?q=NGC+3324&r=0.5&calib=all'),
    });
    expect(result.current.q).toBe('NGC 3324');
    expect(result.current.r).toBe('0.5');
    expect(result.current.allLevels).toBe(true);
  });

  it('push writes the URL, changes navKey, and adds a history entry', () => {
    const { result } = renderHook(() => ({ url: useSearchUrlState(), location: useLocation() }), {
      wrapper: wrapper('/search'),
    });
    const before = result.current.url.navKey;

    act(() => result.current.url.push({ q: 'M16', r: '0.2', allLevels: false }));

    expect(result.current.location.search).toBe('?q=M16');
    expect(result.current.url.q).toBe('M16');
    expect(result.current.url.navKey).not.toBe(before);
  });

  it('re-pushing identical params still changes navKey (so a re-submit re-runs)', () => {
    const { result } = renderHook(() => useSearchUrlState(), {
      wrapper: wrapper('/search?q=M16'),
    });
    const before = result.current.navKey;
    act(() => result.current.push({ q: 'M16', r: '0.2', allLevels: false }));
    expect(result.current.navKey).not.toBe(before);
  });

  it('push is a PUSH and replace is a REPLACE (Back skips replaced entries)', () => {
    const { result } = renderHook(
      () => ({ url: useSearchUrlState(), location: useLocation(), nav: useNavigationType() }),
      { wrapper: wrapper('/search?q=M16') }
    );
    act(() => result.current.url.push({ q: 'M16', r: '1', allLevels: false }));
    expect(result.current.nav).toBe('PUSH');
    act(() => result.current.url.replace({ q: 'M16', r: '1', allLevels: true }));
    expect(result.current.nav).toBe('REPLACE');
    expect(result.current.location.search).toBe('?q=M16&r=1&calib=all');
    expect(result.current.url.allLevels).toBe(true);
  });
});

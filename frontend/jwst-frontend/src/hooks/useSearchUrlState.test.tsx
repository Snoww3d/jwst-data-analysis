import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigationType } from 'react-router-dom';
import type { ReactNode } from 'react';
import {
  DEFAULT_SEARCH_RADIUS,
  fromSearchParams,
  toSearchKey,
  toSearchParams,
  useSearchUrlState,
} from './useSearchUrlState';

describe('toSearchParams / fromSearchParams', () => {
  it('round-trips every field', () => {
    const state = { q: '10h 37m -58°', r: '0.5', allLevels: true };
    expect(fromSearchParams(toSearchParams(state))).toEqual(state);
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
      expect(fromSearchParams(toSearchParams(state))).toEqual(state);
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

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MAX_RECENT_SEARCHES,
  RECENT_SEARCHES_KEY,
  loadRecentSearches,
  pushRecentSearch,
  recentSearchKey,
  recordRecentSearch,
  saveRecentSearches,
  type RecentSearch,
} from './recentSearches';

const entry = (q: string, r = '0.2', at = 1): RecentSearch => ({ q, r, at });

describe('recentSearchKey', () => {
  it('folds case and whitespace, normalises the radius', () => {
    expect(recentSearchKey({ q: '  NGC   3324 ', r: '0.20' })).toBe('ngc 3324|0.2');
    expect(recentSearchKey({ q: 'ngc 3324', r: '0.2' })).toBe('ngc 3324|0.2');
  });

  it('distinguishes radii', () => {
    expect(recentSearchKey({ q: 'M16', r: '0.2' })).not.toBe(recentSearchKey({ q: 'M16', r: '1' }));
  });
});

describe('pushRecentSearch', () => {
  it('prepends and does not mutate the input', () => {
    const list = [entry('a')];
    const next = pushRecentSearch(list, entry('b'));
    expect(next.map((e) => e.q)).toEqual(['b', 'a']);
    expect(list).toHaveLength(1);
  });

  it('dedupes on normalised q+r, moving the repeat to the front', () => {
    const list = [entry('a'), entry('NGC 3324'), entry('c')];
    const next = pushRecentSearch(list, entry('ngc  3324', '0.20', 9));
    expect(next.map((e) => e.q)).toEqual(['ngc  3324', 'a', 'c']);
    expect(next[0].at).toBe(9);
  });

  it('keeps the same query at a different radius as a separate entry', () => {
    const next = pushRecentSearch([entry('M16', '0.2')], entry('M16', '1'));
    expect(next).toHaveLength(2);
  });

  it(`caps at ${MAX_RECENT_SEARCHES}, dropping the oldest`, () => {
    let list: RecentSearch[] = [];
    for (let i = 0; i < MAX_RECENT_SEARCHES + 3; i++) {
      list = pushRecentSearch(list, entry(`q${i}`));
    }
    expect(list).toHaveLength(MAX_RECENT_SEARCHES);
    expect(list[0].q).toBe(`q${MAX_RECENT_SEARCHES + 2}`);
    expect(list[list.length - 1].q).toBe('q3');
  });
});

describe('storage', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips through localStorage', () => {
    saveRecentSearches([entry('a'), entry('b')]);
    expect(loadRecentSearches().map((e) => e.q)).toEqual(['a', 'b']);
  });

  it('returns [] for missing or malformed storage', () => {
    expect(loadRecentSearches()).toEqual([]);
    localStorage.setItem(RECENT_SEARCHES_KEY, '{not json');
    expect(loadRecentSearches()).toEqual([]);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify([{ q: 1 }, entry('ok')]));
    expect(loadRecentSearches().map((e) => e.q)).toEqual(['ok']);
  });

  it('recordRecentSearch loads, pushes, saves, and returns the list', () => {
    recordRecentSearch({ q: 'M16', r: '0.2' }, 100);
    const list = recordRecentSearch({ q: 'NGC 3324', r: '0.2' }, 200);
    expect(list.map((e) => [e.q, e.at])).toEqual([
      ['NGC 3324', 200],
      ['M16', 100],
    ]);
    expect(loadRecentSearches()).toEqual(list);
  });
});

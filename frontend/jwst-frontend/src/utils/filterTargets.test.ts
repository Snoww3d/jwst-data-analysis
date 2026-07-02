import { describe, it, expect } from 'vitest';
import { filterTargets, categoriesOf, type TargetFilter } from './filterTargets';
import type { FeaturedTarget } from '../types/DiscoveryTypes';

function makeTarget(overrides: Partial<FeaturedTarget>): FeaturedTarget {
  return {
    name: 'Carina Nebula',
    catalogId: 'NGC 3372',
    category: 'nebula',
    description: 'A star-forming region',
    instruments: ['NIRCam'],
    filterCount: 6,
    compositePotential: 'great',
    mastSearchParams: { target: 'Carina Nebula' },
    ...overrides,
  };
}

const targets: FeaturedTarget[] = [
  makeTarget({}),
  makeTarget({
    name: 'Phantom Galaxy',
    catalogId: 'M74',
    category: 'galaxy',
    compositePotential: 'good',
  }),
  makeTarget({
    name: 'Southern Ring',
    catalogId: 'NGC 3132',
    category: 'planetary',
    compositePotential: 'limited',
  }),
  makeTarget({
    name: 'Westerlund 2',
    catalogId: undefined,
    category: 'star cluster',
    compositePotential: 'good',
  }),
];

describe('filterTargets', () => {
  it('returns everything for the all filter with no query', () => {
    expect(filterTargets(targets, 'all', '')).toHaveLength(4);
  });

  it('filters to great potential', () => {
    const result = filterTargets(targets, 'great', '');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Carina Nebula');
  });

  it('filters by category, case-insensitively', () => {
    const result = filterTargets(targets, 'Galaxy' as TargetFilter, '');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Phantom Galaxy');
  });

  it('matches query against name, catalog id, and category', () => {
    expect(filterTargets(targets, 'all', 'ngc 31')[0].name).toBe('Southern Ring');
    expect(filterTargets(targets, 'all', 'GALAXY')).toHaveLength(1);
    expect(filterTargets(targets, 'all', 'westerlund')).toHaveLength(1);
  });

  it('AND-combines filter and query', () => {
    expect(filterTargets(targets, 'great', 'phantom')).toHaveLength(0);
    expect(filterTargets(targets, 'galaxy', 'phantom')).toHaveLength(1);
  });

  it('trims the query and treats whitespace as no query', () => {
    expect(filterTargets(targets, 'all', '   ')).toHaveLength(4);
  });

  it('returns empty for no matches', () => {
    expect(filterTargets(targets, 'all', 'zzz-no-such-target')).toHaveLength(0);
  });

  it('handles targets without a catalog id', () => {
    expect(filterTargets(targets, 'all', 'ngc')).toHaveLength(2);
  });
});

describe('categoriesOf', () => {
  it('returns unique lowercased categories in first-seen order', () => {
    expect(categoriesOf(targets)).toEqual(['nebula', 'galaxy', 'planetary', 'star cluster']);
  });

  it('deduplicates repeated categories', () => {
    expect(categoriesOf([...targets, makeTarget({ name: 'Eagle' })])).toEqual([
      'nebula',
      'galaxy',
      'planetary',
      'star cluster',
    ]);
  });

  it('returns empty for no targets', () => {
    expect(categoriesOf([])).toEqual([]);
  });
});

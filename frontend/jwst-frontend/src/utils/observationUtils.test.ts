import { describe, it, expect } from 'vitest';
import { observationIdsForFilters, buildFilterCoverage } from './observationUtils';
import type { MastObservationResult } from '../types/MastTypes';

// TargetDetail's grouped availability map and RecipeCard's standalone
// self-check both key off this selection — these tests lock the "both
// consumers agree" invariant the helper exists to enforce.
describe('observationIdsForFilters', () => {
  const obs = (obs_id: string | undefined, filters: string) =>
    ({
      obs_id,
      filters,
      instrument_name: 'MIRI',
      dataproduct_type: 'image',
    }) as MastObservationResult;

  it('collects EVERY observation per filter — coverage must not depend on MAST row order', () => {
    // Cas A regression: the library held F1800W from obs set B while obs
    // set A sorted first; first-per-filter selection read the filter as
    // missing even though renderable data existed. Any obs may cover it.
    const result = observationIdsForFilters(
      [obs('first-f770w', 'F770W'), obs('second-f770w', 'F770W')],
      ['F770W']
    );
    expect(result).toEqual(['first-f770w', 'second-f770w']);
  });

  it('skips observations without an obs_id', () => {
    const result = observationIdsForFilters(
      [obs(undefined, 'F770W'), obs('with-id', 'F770W')],
      ['F770W']
    );
    expect(result).toEqual(['with-id']);
  });

  it('does not duplicate an obs_id listed twice', () => {
    const result = observationIdsForFilters([obs('o1', 'F770W'), obs('o1', 'F770W')], ['F770W']);
    expect(result).toEqual(['o1']);
  });

  it('matches filters case-insensitively', () => {
    const result = observationIdsForFilters([obs('o1', 'f770w')], ['F770W']);
    expect(result).toEqual(['o1']);
  });

  it('ignores observations whose filter is not in the recipe', () => {
    const result = observationIdsForFilters([obs('o1', 'F770W'), obs('o2', 'F090W')], ['F770W']);
    expect(result).toEqual(['o1']);
  });

  it('returns empty for empty inputs', () => {
    expect(observationIdsForFilters([], ['F770W'])).toEqual([]);
    expect(observationIdsForFilters([obs('o1', 'F770W')], [])).toEqual([]);
  });
});

describe('buildFilterCoverage', () => {
  const obs = (obs_id: string, filters: string) =>
    ({
      obs_id,
      filters,
      instrument_name: 'MIRI',
      dataproduct_type: 'image',
    }) as MastObservationResult;

  it('covers a filter when ANY observation provides data (Cas A regression)', () => {
    // first-in-row-order obs has no data; a later obs of the same filter does
    const coverage = buildFilterCoverage(
      { 'obs-b': { available: true, dataIds: ['d1'], filter: 'F1800W' } },
      [obs('obs-a', 'F1800W'), obs('obs-b', 'F1800W')]
    );
    expect(coverage.get('F1800W')).toEqual(['d1']);
  });

  it('falls back to the observation filter only when the entry filter is null', () => {
    const coverage = buildFilterCoverage(
      { 'obs-a': { available: true, dataIds: ['d1'], filter: null as unknown as string } },
      [obs('obs-a', 'f770w')]
    );
    expect(coverage.get('F770W')).toEqual(['d1']);
  });

  it('ignores unavailable and empty-dataIds entries', () => {
    const coverage = buildFilterCoverage(
      {
        'obs-a': { available: false, dataIds: ['d1'], filter: 'F770W' },
        'obs-b': { available: true, dataIds: [], filter: 'F1800W' },
      },
      [obs('obs-a', 'F770W'), obs('obs-b', 'F1800W')]
    );
    expect(coverage.size).toBe(0);
  });
});

describe('observationIdsForFilters multi-filter union', () => {
  const obs = (obs_id: string, filters: string) =>
    ({
      obs_id,
      filters,
      instrument_name: 'MIRI',
      dataproduct_type: 'image',
    }) as MastObservationResult;

  it('collects observations across several filters', () => {
    expect(
      observationIdsForFilters([obs('a', 'F770W'), obs('b', 'F1800W')], ['F770W', 'F1800W'])
    ).toEqual(['a', 'b']);
  });
});

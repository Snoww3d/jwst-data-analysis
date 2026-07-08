import { describe, it, expect } from 'vitest';
import { observationIdsForFilters } from './observationUtils';
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

  it('picks the first observation per filter (dedup)', () => {
    const result = observationIdsForFilters(
      [obs('first-f770w', 'F770W'), obs('second-f770w', 'F770W')],
      ['F770W']
    );
    expect(result).toEqual(['first-f770w']);
  });

  it('skips observations without an obs_id and takes the next matching one', () => {
    const result = observationIdsForFilters(
      [obs(undefined, 'F770W'), obs('with-id', 'F770W')],
      ['F770W']
    );
    expect(result).toEqual(['with-id']);
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

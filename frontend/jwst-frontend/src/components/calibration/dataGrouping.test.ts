/**
 * Data grouping + recipe matching (#1738). These replace `path.includes('_cal')`
 * over a flat list, which is what the old input picker amounted to.
 */

import { describe, expect, it } from 'vitest';
import { fitRecipes, formatBytes, groupByTarget, instrumentOf, suffixOf } from './dataGrouping';
import type { JwstDataModel } from '../../types/JwstDataTypes';
import type { CalibrationRecipe } from '../../types/CalibrationTypes';

function item(over: Partial<JwstDataModel> & { id: string }): JwstDataModel {
  return {
    fileName: 'file_cal.fits',
    dataType: 'image',
    uploadDate: '',
    metadata: {},
    fileSize: 1024 ** 2,
    processingStatus: 'completed',
    tags: [],
    isArchived: false,
    processingResults: [],
    ...over,
  } as JwstDataModel;
}

function recipe(id: string, instrument: string): CalibrationRecipe {
  return { id, name: id, instrument, description: '' } as CalibrationRecipe;
}

describe('groupByTarget', () => {
  it('groups by target name and collects filters and instruments', () => {
    const groups = groupByTarget([
      item({
        id: 'a',
        metadata: {
          mast_target_name: 'NGC 3132',
          mast_filters: 'F090W;F187N',
          mast_instrument_name: 'NIRCAM/IMAGE',
        },
      }),
      item({
        id: 'b',
        metadata: {
          mast_target_name: 'NGC 3132',
          mast_filters: 'F090W',
          mast_instrument_name: 'NIRCAM',
        },
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('NGC 3132');
    expect(groups[0].items).toHaveLength(2);
    // Filters de-duplicate across files in the group.
    expect(groups[0].filters).toEqual(['F090W', 'F187N']);
    // "NIRCAM/IMAGE" and "NIRCAM" are the same instrument.
    expect(groups[0].instruments).toEqual(['NIRCAM']);
  });

  it('falls back to the observation id, then a catch-all group', () => {
    const groups = groupByTarget([
      item({ id: 'a', observationBaseId: 'jw02733-o001' }),
      item({ id: 'b' }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['jw02733-o001', 'Other files']);
  });

  it('sorts the catch-all group last even when alphabetically early', () => {
    const groups = groupByTarget([
      item({ id: 'a' }),
      item({ id: 'b', metadata: { mast_target_name: 'ZZ Top' } }),
    ]);
    expect(groups[groups.length - 1].label).toBe('Other files');
  });
});

describe('suffixOf / instrumentOf', () => {
  it('reads the product suffix from the path', () => {
    expect(suffixOf(item({ id: 'a', filePath: 'mast/x/a_uncal.fits' }))).toBe('_uncal');
    expect(suffixOf(item({ id: 'b', filePath: 'mast/x/b_i2d.fits' }))).toBe('_i2d');
    expect(
      suffixOf(item({ id: 'c', filePath: 'mast/x/mystery.fits', fileName: 'mystery.fits' }))
    ).toBeNull();
  });

  it('normalises the instrument name', () => {
    expect(instrumentOf(item({ id: 'a', metadata: { mast_instrument_name: 'MIRI/IMAGE' } }))).toBe(
      'MIRI'
    );
    expect(instrumentOf(item({ id: 'b' }))).toBeNull();
  });
});

describe('fitRecipes', () => {
  const recipes = [recipe('miri-imaging', 'miri'), recipe('nircam-imaging', 'nircam')];

  it('marks instrument mismatches inapplicable and sorts them last', () => {
    const fits = fitRecipes(recipes, [
      item({ id: 'a', metadata: { mast_instrument_name: 'NIRCAM' } }),
    ]);
    expect(fits[0].recipe.id).toBe('nircam-imaging');
    expect(fits[0].applicable).toBe(true);
    expect(fits[1].applicable).toBe(false);
    expect(fits[1].reason).toMatch(/MIRI/);
  });

  it('treats everything as applicable when the instrument is unknown', () => {
    // Hand-uploaded files carry no MAST metadata; don't hide every recipe.
    const fits = fitRecipes(recipes, [item({ id: 'a' })]);
    expect(fits.every((f) => f.applicable)).toBe(true);
  });

  it("does not disqualify on product suffix — that is the timeline's job", () => {
    // _i2d data can't usefully run anything, but the recipe still matches the
    // instrument; #1736's stage rules explain what can actually run.
    const fits = fitRecipes(recipes, [
      item({ id: 'a', filePath: 'x/a_i2d.fits', metadata: { mast_instrument_name: 'MIRI' } }),
    ]);
    expect(fits[0].applicable).toBe(true);
  });
});

describe('formatBytes', () => {
  it('switches to GB above a gigabyte', () => {
    expect(formatBytes(0)).toBe('—');
    expect(formatBytes(5 * 1024 ** 2)).toBe('5 MB');
    expect(formatBytes(2.5 * 1024 ** 3)).toBe('2.5 GB');
  });
});

/**
 * Comparing calibration attempts (#1758) — the "run it three ways, keep the
 * best, feed that into the next step" loop.
 */

import { describe, expect, it } from 'vitest';
import { comparableGroups, differingParams, groupAttempts, isCalibrationOutput } from './attempts';
import type { JwstDataModel } from '../../types/JwstDataTypes';

const output = (over: Partial<JwstDataModel>): JwstDataModel =>
  ({
    id: 'x',
    fileName: 'nircam-imaging_i2d.fits',
    observationBaseId: 'jw02733001001',
    uploadDate: '2026-07-01T00:00:00Z',
    tags: ['calibration'],
    metadata: { source: 'calibration' },
    processingLevel: 'L3',
    ...over,
  }) as JwstDataModel;

describe('isCalibrationOutput', () => {
  it('recognises what a run produced', () => {
    expect(isCalibrationOutput(output({}))).toBe(true);
  });

  it('excludes archive data', () => {
    const imported = output({ metadata: {}, tags: ['nircam'] });
    expect(isCalibrationOutput(imported)).toBe(false);
  });
});

describe('groupAttempts', () => {
  it('groups by observation and level', () => {
    const groups = groupAttempts([
      output({ id: 'a', processingLevel: 'L3' }),
      output({ id: 'b', processingLevel: 'L3' }),
      output({ id: 'c', processingLevel: 'L2b', fileName: 'x_cal.fits' }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.level === 'L3')?.attempts).toHaveLength(2);
  });

  it('keeps different observations apart', () => {
    const groups = groupAttempts([
      output({ id: 'a', observationBaseId: 'jw02733001001' }),
      output({ id: 'b', observationBaseId: 'jw02739001001' }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('puts the newest attempt first', () => {
    const groups = groupAttempts([
      output({ id: 'old', uploadDate: '2026-07-01T00:00:00Z' }),
      output({ id: 'new', uploadDate: '2026-07-20T00:00:00Z' }),
    ]);
    expect(groups[0].attempts.map((a) => a.item.id)).toEqual(['new', 'old']);
  });

  it('leaves out archive data, so a comparison is between YOUR runs', () => {
    const groups = groupAttempts([
      output({ id: 'mine' }),
      output({ id: 'theirs', metadata: {}, tags: [] }),
    ]);
    expect(groups[0].attempts.map((a) => a.item.id)).toEqual(['mine']);
  });

  it('leaves out outputs that cannot be placed', () => {
    // No observation, or no determinable level: pooling these would make a
    // group that means nothing.
    const groups = groupAttempts([
      output({ id: 'a', observationBaseId: undefined }),
      output({ id: 'b', processingLevel: 'unknown', fileName: 'mystery.fits' }),
    ]);
    expect(groups).toEqual([]);
  });

  it('reads the settings that produced each attempt', () => {
    const groups = groupAttempts([
      output({
        metadata: {
          source: 'calibration',
          run_overrides: { tweakreg: { snr_threshold: 5 }, skymatch: { skymethod: 'match' } },
        },
      }),
    ]);
    expect(groups[0].attempts[0].settings).toEqual([
      { step: 'skymatch', param: 'skymethod', value: '"match"' },
      { step: 'tweakreg', param: 'snr_threshold', value: '5' },
    ]);
    expect(groups[0].attempts[0].isDefaults).toBe(false);
  });

  it('marks a run that used the recipe as-is', () => {
    const groups = groupAttempts([output({})]);
    expect(groups[0].attempts[0].isDefaults).toBe(true);
  });
});

describe('differingParams', () => {
  const withOverrides = (id: string, overrides: Record<string, unknown>) =>
    output({ id, metadata: { source: 'calibration', run_overrides: overrides } });

  it('names only what actually changed between attempts', () => {
    // Showing every parameter on every attempt buries the one that differs,
    // which is the whole reason to put them side by side.
    const [group] = groupAttempts([
      withOverrides('a', { tweakreg: { snr_threshold: 5, searchrad: 2 } }),
      withOverrides('b', { tweakreg: { snr_threshold: 10, searchrad: 2 } }),
    ]);
    expect(differingParams(group)).toEqual(['tweakreg.snr_threshold']);
  });

  it('counts "not set" as a difference from "set"', () => {
    const [group] = groupAttempts([
      withOverrides('a', { tweakreg: { snr_threshold: 5 } }),
      withOverrides('b', {}),
    ]);
    expect(differingParams(group)).toEqual(['tweakreg.snr_threshold']);
  });

  it('is empty when two runs used identical settings', () => {
    const [group] = groupAttempts([
      withOverrides('a', { tweakreg: { snr_threshold: 5 } }),
      withOverrides('b', { tweakreg: { snr_threshold: 5 } }),
    ]);
    expect(differingParams(group)).toEqual([]);
  });
});

describe('comparableGroups', () => {
  it('drops groups with a single attempt — that is not a comparison', () => {
    const groups = groupAttempts([
      output({ id: 'a', observationBaseId: 'obs1' }),
      output({ id: 'b', observationBaseId: 'obs2' }),
      output({ id: 'c', observationBaseId: 'obs2' }),
    ]);
    const comparable = comparableGroups(groups);
    expect(comparable).toHaveLength(1);
    expect(comparable[0].observationBaseId).toBe('obs2');
  });
});

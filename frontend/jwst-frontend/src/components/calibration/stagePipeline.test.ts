/**
 * Stage validity + estimates (#1736). These are the rules that used to be
 * absent entirely: any stage combination was selectable and an invalid one
 * only failed at runtime, potentially hours into a run.
 */

import { describe, expect, it } from 'vitest';
import { IMAGING_PIPELINE, blockedReason, estimateMinutes, formatEstimate } from './stagePipeline';

// Positional rather than specFor(...)!: the pipeline order IS the contract, so
// a reordering should break these tests loudly.
const [detector1, image2, image3] = IMAGING_PIPELINE;

describe('blockedReason', () => {
  it('blocks raw-data stages when the inputs are already calibrated', () => {
    // The exact case the old UI allowed you to submit: _cal files cannot be
    // fed to Detector1, which needs _uncal frames.
    expect(blockedReason(detector1, ['_cal'])).toMatch(/needs _uncal/);
    expect(blockedReason(image2, ['_cal'])).toMatch(/needs _rate/);
    expect(blockedReason(image3, ['_cal'])).toBeNull();
  });

  it('allows the whole pipeline for raw inputs', () => {
    for (const stage of IMAGING_PIPELINE) {
      expect(blockedReason(stage, ['_uncal'])).toBeNull();
    }
  });

  it('blocks nothing before inputs are chosen', () => {
    for (const stage of IMAGING_PIPELINE) {
      expect(blockedReason(stage, [])).toBeNull();
    }
  });

  it('judges a mixed selection by its least-processed file', () => {
    // One raw file means Detector1 still has work to do.
    expect(blockedReason(detector1, ['_uncal', '_cal'])).toBeNull();
  });

  it('does not block on an unrecognised suffix', () => {
    // Better to let the engine reject it than to guess wrong and hide a stage.
    expect(blockedReason(detector1, ['_weird'])).toBeNull();
  });
});

describe('estimateMinutes', () => {
  it('scales per-file stages with the file count but not per-run ones', () => {
    const perFileOnly = estimateMinutes([image2], 4);
    expect(perFileOnly).toBe(image2.minutesPerFile * 4);
    // image3 builds one mosaic regardless of how many frames feed it.
    expect(estimateMinutes([image3], 4)).toBe(image3.minutesPerFile);
  });

  it('treats an empty selection as a single file so the estimate is non-zero', () => {
    expect(estimateMinutes([image2], 0)).toBe(image2.minutesPerFile);
  });

  it('is zero when nothing is enabled', () => {
    expect(estimateMinutes([], 10)).toBe(0);
  });
});

describe('formatEstimate', () => {
  it('reads as minutes under an hour and hours above', () => {
    expect(formatEstimate(20)).toBe('~20 min');
    expect(formatEstimate(60)).toBe('~1h');
    expect(formatEstimate(95)).toBe('~1h 35m');
    expect(formatEstimate(0)).toBe('—');
  });
});

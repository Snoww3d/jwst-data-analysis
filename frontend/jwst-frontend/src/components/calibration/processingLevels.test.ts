/**
 * Level-based calibration offers (#1756). These decide what every library card
 * says, so they carry the feature's whole vocabulary: a run raises a file from
 * one level to the next, and the card names the outcome, not the stage.
 */

import { describe, expect, it } from 'vitest';
import {
  advanceActionFor,
  levelFromFileName,
  levelOf,
  noActionReason,
  reachableLevels,
  stagesBetween,
} from './processingLevels';
import type { JwstDataModel } from '../../types/JwstDataTypes';

const file = (over: Partial<JwstDataModel>) => over as JwstDataModel;

describe('levelFromFileName', () => {
  it('reads the level off real product names', () => {
    expect(levelFromFileName('jw02733001001_02101_00001_nrca1_uncal.fits')).toBe('L1');
    expect(levelFromFileName('jw02733001001_02101_00001_nrca1_rate.fits')).toBe('L2a');
    expect(levelFromFileName('jw02733-o001_t001_nircam_f200w_i2d.fits')).toBe('L3');
  });

  it('matches the end of the stem, not anywhere in the name', () => {
    // A calibration output is named {product_name}_i2d.fits and a product name
    // may contain "_" — searching anywhere would call this mosaic L2b.
    expect(levelFromFileName('ngc_calibration_i2d.fits')).toBe('L3');
  });

  it('does not read _rateints as _rate', () => {
    expect(levelFromFileName('jw01_rateints.fits')).toBe('L2a');
    expect(levelFromFileName('jw01_calints.fits')).toBe('L2b');
  });

  it('returns null when there is no recognisable suffix', () => {
    expect(levelFromFileName('my-export.fits')).toBeNull();
    expect(levelFromFileName(undefined)).toBeNull();
  });
});

describe('levelOf', () => {
  it('prefers the stored label', () => {
    expect(levelOf(file({ fileName: 'x_uncal.fits', processingLevel: 'L2b' }))).toBe('L2b');
  });

  it('falls back to the filename when the label is missing or unusable', () => {
    // Records predating the backfill, and every calibration output saved
    // before #1754, have no level — falling back keeps them usable.
    expect(levelOf(file({ fileName: 'x_cal.fits' }))).toBe('L2b');
    expect(levelOf(file({ fileName: 'x_cal.fits', processingLevel: 'unknown' }))).toBe('L2b');
  });

  it('is null when neither source knows', () => {
    expect(levelOf(file({ fileName: 'mystery.fits', processingLevel: 'unknown' }))).toBeNull();
  });
});

describe('stagesBetween', () => {
  it('takes a raw file all the way to a mosaic', () => {
    expect(stagesBetween('L1', 'L3')).toEqual(['detector1', 'image2', 'image3']);
  });

  it('runs only what is left when the file is part-way there', () => {
    expect(stagesBetween('L2a', 'L3')).toEqual(['image2', 'image3']);
    expect(stagesBetween('L2b', 'L3')).toEqual(['image3']);
  });

  it('supports stopping short of L3', () => {
    expect(stagesBetween('L1', 'L2a')).toEqual(['detector1']);
    expect(stagesBetween('L1', 'L2b')).toEqual(['detector1', 'image2']);
  });

  it('is empty when there is nothing to do or the direction is backwards', () => {
    expect(stagesBetween('L3', 'L3')).toEqual([]);
    // Calibration cannot un-process a file.
    expect(stagesBetween('L3', 'L1')).toEqual([]);
  });
});

describe('reachableLevels', () => {
  it('lists what a file could become, nearest first', () => {
    expect(reachableLevels('L1')).toEqual(['L2a', 'L2b', 'L3']);
    expect(reachableLevels('L2b')).toEqual(['L3']);
  });

  it('is empty for a finished product', () => {
    expect(reachableLevels('L3')).toEqual([]);
  });
});

describe('advanceActionFor', () => {
  it('offers a raw file the whole pipeline', () => {
    const action = advanceActionFor(file({ fileName: 'x_uncal.fits' }));
    expect(action).toEqual({
      label: 'Process to L3',
      fromLevel: 'L1',
      targetLevel: 'L3',
      stages: ['detector1', 'image2', 'image3'],
    });
  });

  it('calls the last hop combining, because that is what it does', () => {
    // Image3 mosaics several exposures into one image — a different promise
    // from calibrating a single file.
    const action = advanceActionFor(file({ fileName: 'x_cal.fits' }));
    expect(action?.label).toBe('Combine to L3');
    expect(action?.stages).toEqual(['image3']);
  });

  it('offers nothing on a finished mosaic', () => {
    expect(advanceActionFor(file({ fileName: 'x_i2d.fits' }))).toBeNull();
  });

  it('offers nothing when the level is unknown', () => {
    expect(advanceActionFor(file({ fileName: 'mystery.fits' }))).toBeNull();
  });

  it('is offered on the levels that make up most of a real library', () => {
    // The old entry point appeared only on _cal files — 6 of 1523 items here.
    for (const name of ['a_uncal.fits', 'a_rate.fits', 'a_cal.fits']) {
      expect(advanceActionFor(file({ fileName: name }))).not.toBeNull();
    }
  });
});

describe('noActionReason', () => {
  it('says a finished file is finished rather than hiding the control', () => {
    expect(noActionReason(file({ fileName: 'x_i2d.fits' }))).toMatch(/Already fully processed/);
  });

  it('explains an unknown level', () => {
    expect(noActionReason(file({ fileName: 'mystery.fits' }))).toMatch(/unknown/i);
  });

  it('is null when there IS an action, so nothing contradicts the button', () => {
    expect(noActionReason(file({ fileName: 'x_cal.fits' }))).toBeNull();
  });
});

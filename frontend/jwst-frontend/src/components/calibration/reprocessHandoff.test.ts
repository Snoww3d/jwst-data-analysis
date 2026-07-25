/**
 * The join between a library card and the run page (#1756).
 *
 * The dashboard decides three things when you click the action: which files go
 * in, which recipe, and which levels to travel between. Each was previously
 * wrong in a way that only showed up at run time — a single-frame mosaic, a
 * "not imaging" toast on a file that is imaging, or an Image3-only run on raw
 * data — so they are exercised here rather than through the dashboard's DOM.
 */

import { describe, expect, it } from 'vitest';
import { instrumentOf, reprocessInputIds } from './dataGrouping';
import { advanceActionFor } from './processingLevels';
import type { JwstDataModel } from '../../types/JwstDataTypes';

const item = (over: Partial<JwstDataModel>): JwstDataModel =>
  ({ id: 'x', fileName: 'a_cal.fits', metadata: {}, tags: [], ...over }) as JwstDataModel;

describe('instrumentOf', () => {
  it('reads the MAST metadata first', () => {
    expect(instrumentOf(item({ metadata: { mast_instrument_name: 'MIRI/IMAGE' } }))).toBe('MIRI');
  });

  it('falls back to imageInfo, which uploads and scans carry instead', () => {
    expect(instrumentOf(item({ imageInfo: { instrument: 'NIRCam' } as never }))).toBe('NIRCAM');
  });

  it('falls back to the filename, which encodes it for stage-3 products', () => {
    // Engine-written outputs carry no ImageInfo at all, so without this the
    // action dead-ends on every file the pipeline itself produced.
    expect(instrumentOf(item({ fileName: 'jw02733-o001_t001_niriss_f200w_i2d.fits' }))).toBe(
      'NIRISS'
    );
  });

  it('falls back to tags', () => {
    expect(instrumentOf(item({ fileName: 'x.fits', tags: ['nircam', 'deep'] }))).toBe('NIRCAM');
  });

  it('is null when nothing knows, rather than guessing an instrument', () => {
    expect(instrumentOf(item({ fileName: 'my-upload.fits' }))).toBeNull();
  });
});

describe('reprocessInputIds', () => {
  const obs = 'jw02733001001';

  it('gathers the observation siblings at the same level as the clicked file', () => {
    const data = [
      item({ id: 'a', fileName: 'a_cal.fits', observationBaseId: obs }),
      item({ id: 'b', fileName: 'b_cal.fits', observationBaseId: obs }),
      item({ id: 'c', fileName: 'c_uncal.fits', observationBaseId: obs }),
    ];
    expect(reprocessInputIds(data, data[0])).toEqual(['a', 'b']);
  });

  it('gathers raw siblings too, not just calibrated ones', () => {
    // Every route to L3 ends in Image3, and a mosaic needs the observation's
    // other exposures — one member alone is a single-frame drizzle.
    const data = [
      item({ id: 'a', fileName: 'a_uncal.fits', observationBaseId: obs }),
      item({ id: 'b', fileName: 'b_uncal.fits', observationBaseId: obs }),
      item({ id: 'c', fileName: 'c_cal.fits', observationBaseId: obs }),
    ];
    expect(reprocessInputIds(data, data[0])).toEqual(['a', 'b']);
  });

  it('does not mix levels — a rate file does not pull in calibrated ones', () => {
    const data = [
      item({ id: 'a', fileName: 'a_rate.fits', observationBaseId: obs }),
      item({ id: 'b', fileName: 'b_cal.fits', observationBaseId: obs }),
    ];
    expect(reprocessInputIds(data, data[0])).toEqual(['a']);
  });

  it('falls back to the clicked file when it has no siblings', () => {
    const only = item({ id: 'a', fileName: 'a_cal.fits' });
    expect(reprocessInputIds([only], only)).toEqual(['a']);
  });
});

describe('the hand-off as a whole', () => {
  it('sends a raw file the whole way, with its siblings', () => {
    const data = [
      item({
        id: 'a',
        fileName: 'jw02733001001_02101_00001_nrca1_uncal.fits',
        observationBaseId: 'jw02733001001',
        metadata: { mast_instrument_name: 'NIRCAM/IMAGE' },
      }),
      item({
        id: 'b',
        fileName: 'jw02733001001_02101_00002_nrca1_uncal.fits',
        observationBaseId: 'jw02733001001',
      }),
    ];
    const action = advanceActionFor(data[0]);
    expect(action).toMatchObject({ fromLevel: 'L1', targetLevel: 'L3' });
    expect(instrumentOf(data[0])).toBe('NIRCAM');
    expect(reprocessInputIds(data, data[0])).toEqual(['a', 'b']);
  });
});

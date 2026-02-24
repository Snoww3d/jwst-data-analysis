import { describe, it, expect } from 'vitest';
import {
  getFitsFileInfo,
  isFitsViewable,
  isSpectralFile,
  getFitsTypeLabel,
  calculateZScale,
} from './fitsUtils';

describe('getFitsFileInfo', () => {
  describe('image files', () => {
    it('identifies _cal.fits as image', () => {
      const info = getFitsFileInfo('jw02107_nircam_cal.fits');
      expect(info.type).toBe('image');
      expect(info.viewable).toBe(true);
      expect(info.label).toBe('CAL');
    });

    it('identifies _i2d.fits as image', () => {
      const info = getFitsFileInfo('jw02107_nircam_clear-f444w_i2d.fits');
      expect(info.type).toBe('image');
      expect(info.viewable).toBe(true);
      expect(info.label).toBe('I2D');
    });

    it('identifies _rate.fits as image', () => {
      const info = getFitsFileInfo('jw02107_rate.fits');
      expect(info.type).toBe('image');
      expect(info.viewable).toBe(true);
      expect(info.label).toBe('RATE');
    });

    it('identifies _s3d.fits as image', () => {
      const info = getFitsFileInfo('jw01234_s3d.fits');
      expect(info.type).toBe('image');
      expect(info.viewable).toBe(true);
      expect(info.label).toBe('S3D');
    });

    it('identifies _uncal.fits as image', () => {
      const info = getFitsFileInfo('jw01234_uncal.fits');
      expect(info.type).toBe('image');
      expect(info.viewable).toBe(true);
      expect(info.label).toBe('UNCAL');
    });
  });

  describe('table files', () => {
    it('identifies _x1d.fits as table', () => {
      const info = getFitsFileInfo('jw02107_x1d.fits');
      expect(info.type).toBe('table');
      expect(info.viewable).toBe(false);
      expect(info.label).toBe('X1D');
    });

    it('identifies _cat.fits as table', () => {
      const info = getFitsFileInfo('jw02107_cat.fits');
      expect(info.type).toBe('table');
      expect(info.viewable).toBe(false);
      expect(info.label).toBe('CAT');
    });

    it('identifies _asn.fits as table', () => {
      const info = getFitsFileInfo('jw02107_asn.fits');
      expect(info.type).toBe('table');
      expect(info.viewable).toBe(false);
      expect(info.label).toBe('ASN');
    });

    it('identifies _c1d.fits as table', () => {
      const info = getFitsFileInfo('jw01234_c1d.fits');
      expect(info.type).toBe('table');
      expect(info.viewable).toBe(false);
      expect(info.label).toBe('C1D');
    });
  });

  describe('unknown / non-FITS', () => {
    it('returns unknown with viewable=true for unrecognized suffix .fits', () => {
      const info = getFitsFileInfo('random_data.fits');
      expect(info.type).toBe('unknown');
      expect(info.viewable).toBe(true);
      expect(info.label).toBe('FITS');
    });

    it('returns non-FITS for .png file', () => {
      const info = getFitsFileInfo('image.png');
      expect(info.type).toBe('unknown');
      expect(info.viewable).toBe(false);
      expect(info.label).toBe('Non-FITS');
    });

    it('returns unknown for empty string', () => {
      const info = getFitsFileInfo('');
      expect(info.type).toBe('unknown');
      expect(info.viewable).toBe(false);
      expect(info.label).toBe('Unknown');
    });

    it('handles .fit extension', () => {
      const info = getFitsFileInfo('jw02107_cal.fit');
      expect(info.type).toBe('image');
      expect(info.viewable).toBe(true);
    });
  });

  describe('case insensitivity', () => {
    it('handles uppercase filenames', () => {
      const info = getFitsFileInfo('JW02107_CAL.FITS');
      expect(info.type).toBe('image');
      expect(info.viewable).toBe(true);
    });

    it('handles mixed case', () => {
      const info = getFitsFileInfo('Jw02107_Cal.Fits');
      expect(info.type).toBe('image');
    });
  });
});

describe('isFitsViewable', () => {
  it('returns true for _cal.fits', () => {
    expect(isFitsViewable('jw02107_cal.fits')).toBe(true);
  });

  it('returns true for _i2d.fits', () => {
    expect(isFitsViewable('jw02107_i2d.fits')).toBe(true);
  });

  it('returns false for _cat.fits', () => {
    expect(isFitsViewable('jw02107_cat.fits')).toBe(false);
  });

  it('returns false for _x1d.fits', () => {
    expect(isFitsViewable('jw02107_x1d.fits')).toBe(false);
  });

  it('returns true for unknown suffix .fits (attempts to view)', () => {
    expect(isFitsViewable('something.fits')).toBe(true);
  });

  it('returns false for non-FITS', () => {
    expect(isFitsViewable('image.jpg')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isFitsViewable('')).toBe(false);
  });
});

describe('isSpectralFile', () => {
  it('returns true for _x1d', () => {
    expect(isSpectralFile('jw02107_x1d.fits')).toBe(true);
  });

  it('returns true for _c1d', () => {
    expect(isSpectralFile('jw02107_c1d.fits')).toBe(true);
  });

  it('returns true for _x1dints', () => {
    expect(isSpectralFile('jw02107_x1dints.fits')).toBe(true);
  });

  it('returns false for _cat', () => {
    expect(isSpectralFile('jw02107_cat.fits')).toBe(false);
  });

  it('returns false for _cal', () => {
    expect(isSpectralFile('jw02107_cal.fits')).toBe(false);
  });

  it('returns false for _spec', () => {
    expect(isSpectralFile('jw02107_spec.fits')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isSpectralFile('')).toBe(false);
  });

  it('returns false for null/undefined', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(isSpectralFile(null as any)).toBe(false);
  });
});

describe('getFitsTypeLabel', () => {
  it('returns "CAL" for _cal.fits', () => {
    expect(getFitsTypeLabel('jw02107_cal.fits')).toBe('CAL');
  });

  it('returns "I2D" for _i2d.fits', () => {
    expect(getFitsTypeLabel('jw02107_i2d.fits')).toBe('I2D');
  });

  it('returns "X1D" for _x1d.fits', () => {
    expect(getFitsTypeLabel('jw02107_x1d.fits')).toBe('X1D');
  });

  it('returns "FITS" for unknown suffix', () => {
    expect(getFitsTypeLabel('random.fits')).toBe('FITS');
  });

  it('returns "Non-FITS" for non-FITS files', () => {
    expect(getFitsTypeLabel('image.png')).toBe('Non-FITS');
  });

  it('returns "Unknown" for empty string', () => {
    expect(getFitsTypeLabel('')).toBe('Unknown');
  });
});

describe('calculateZScale', () => {
  it('returns {min:0, max:1} for empty array', () => {
    const result = calculateZScale([]);
    expect(result).toEqual({ min: 0, max: 1 });
  });

  it('returns {min:0, max:1} for null-like data', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = calculateZScale(null as any);
    expect(result).toEqual({ min: 0, max: 1 });
  });

  it('expands range for all same values (non-zero)', () => {
    const data = new Float32Array([5, 5, 5, 5, 5]);
    const result = calculateZScale(data);
    expect(result.min).toBeLessThan(5);
    expect(result.max).toBeGreaterThan(5);
    // Should be min=4.5, max=5.5 (10% expansion)
    expect(result.min).toBeCloseTo(4.5);
    expect(result.max).toBeCloseTo(5.5);
  });

  it('expands range for all zeros', () => {
    const data = new Float32Array([0, 0, 0, 0, 0]);
    const result = calculateZScale(data);
    expect(result.min).toBe(0);
    expect(result.max).toBe(1);
  });

  it('computes reasonable bounds for normal data', () => {
    // Create sorted data 0..99
    const data = new Float32Array(100);
    for (let i = 0; i < 100; i++) data[i] = i;
    const result = calculateZScale(data);
    // With default limits [0.005, 0.995], should clip 0.5% from each end
    expect(result.min).toBeGreaterThanOrEqual(0);
    expect(result.max).toBeLessThanOrEqual(99);
    expect(result.min).toBeLessThan(result.max);
  });

  it('filters out NaN values', () => {
    const data = new Float32Array([NaN, 1, 2, 3, NaN, 4, 5, NaN]);
    const result = calculateZScale(data);
    // Should only consider 1, 2, 3, 4, 5
    expect(result.min).toBeGreaterThanOrEqual(1);
    expect(result.max).toBeLessThanOrEqual(5);
  });

  it('returns {min:0, max:1} for all-NaN data', () => {
    const data = new Float32Array([NaN, NaN, NaN]);
    const result = calculateZScale(data);
    expect(result).toEqual({ min: 0, max: 1 });
  });

  it('uses all data when length < sampleSize', () => {
    // Small array, all data should be used
    const data = new Float32Array([10, 20, 30, 40, 50]);
    const result = calculateZScale(data, 5000);
    expect(result.min).toBeGreaterThanOrEqual(10);
    expect(result.max).toBeLessThanOrEqual(50);
  });

  it('samples data when length > sampleSize', () => {
    // Create large dataset
    const data = new Float32Array(10000);
    for (let i = 0; i < 10000; i++) data[i] = i;
    const result = calculateZScale(data, 100);
    // Should still get reasonable bounds
    expect(result.min).toBeGreaterThanOrEqual(0);
    expect(result.max).toBeLessThanOrEqual(9999);
    expect(result.min).toBeLessThan(result.max);
  });

  it('respects custom percentile limits', () => {
    const data = new Float32Array(1000);
    for (let i = 0; i < 1000; i++) data[i] = i;
    const result = calculateZScale(data, 5000, [0.1, 0.9]);
    // min should be around 100, max around 900
    expect(result.min).toBeGreaterThanOrEqual(90);
    expect(result.min).toBeLessThanOrEqual(110);
    expect(result.max).toBeGreaterThanOrEqual(890);
    expect(result.max).toBeLessThanOrEqual(910);
  });

  it('handles single element', () => {
    const data = new Float32Array([42]);
    const result = calculateZScale(data);
    // Single value -> flat -> expansion
    expect(result.min).toBeLessThan(42);
    expect(result.max).toBeGreaterThan(42);
  });

  it('handles negative values', () => {
    const data = new Float32Array([-100, -50, 0, 50, 100]);
    const result = calculateZScale(data);
    expect(result.min).toBeLessThan(0);
    expect(result.max).toBeGreaterThan(0);
  });
});

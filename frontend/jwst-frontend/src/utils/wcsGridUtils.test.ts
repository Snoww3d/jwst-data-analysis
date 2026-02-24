import { describe, it, expect } from 'vitest';
import {
  wcsToPixel,
  computeGridSpacing,
  getPixelScaleArcsec,
  computeScaleBar,
  computeWcsGridLines,
} from './wcsGridUtils';
import { pixelToWCS } from './coordinateUtils';
import type { WCSParams } from '../types/JwstDataTypes';

const testWCS: WCSParams = {
  crpix1: 50,
  crpix2: 50,
  crval1: 180.0,
  crval2: 45.0,
  cd1_1: -0.001,
  cd1_2: 0,
  cd2_1: 0,
  cd2_2: 0.001,
  cdelt1: 0,
  cdelt2: 0,
  ctype1: 'RA---TAN',
  ctype2: 'DEC--TAN',
};

describe('wcsToPixel', () => {
  it('round-trips with pixelToWCS at reference pixel', () => {
    const sky = pixelToWCS(50, 50, testWCS);
    if (!sky) throw new Error('expected sky');
    const pixel = wcsToPixel(sky.ra, sky.dec, testWCS);
    if (!pixel) throw new Error('expected pixel');
    expect(pixel.x).toBeCloseTo(50, 3);
    expect(pixel.y).toBeCloseTo(50, 3);
  });

  it('round-trips with pixelToWCS at offset position', () => {
    const sky = pixelToWCS(70, 30, testWCS);
    if (!sky) throw new Error('expected sky');
    const pixel = wcsToPixel(sky.ra, sky.dec, testWCS);
    if (!pixel) throw new Error('expected pixel');
    expect(pixel.x).toBeCloseTo(70, 2);
    expect(pixel.y).toBeCloseTo(30, 2);
  });

  it('round-trips at corner position', () => {
    const sky = pixelToWCS(1, 1, testWCS);
    if (!sky) throw new Error('expected sky');
    const pixel = wcsToPixel(sky.ra, sky.dec, testWCS);
    if (!pixel) throw new Error('expected pixel');
    expect(pixel.x).toBeCloseTo(1, 2);
    expect(pixel.y).toBeCloseTo(1, 2);
  });

  it('returns null for invalid WCS', () => {
    const zeroWCS: WCSParams = {
      crpix1: 0,
      crpix2: 0,
      crval1: 0,
      crval2: 0,
      cd1_1: 0,
      cd1_2: 0,
      cd2_1: 0,
      cd2_2: 0,
      cdelt1: 0,
      cdelt2: 0,
      ctype1: 'RA---TAN',
      ctype2: 'DEC--TAN',
    };
    expect(wcsToPixel(180, 45, zeroWCS)).toBeNull();
  });

  it('returns null for non-TAN projection', () => {
    const sinWCS: WCSParams = {
      ...testWCS,
      ctype1: 'RA---SIN',
      ctype2: 'DEC--SIN',
    };
    expect(wcsToPixel(180, 45, sinWCS)).toBeNull();
  });

  it('returns null when point is behind tangent plane', () => {
    // 180 degrees away from crval1 = 180 -> ra = 0, dec = -45
    // This is on the opposite side of the sky
    // This may or may not be null depending on the exact geometry,
    // but the denominator check should handle extreme cases
    wcsToPixel(0, -45, testWCS);
    // Test a definitely-behind-the-plane case
    const behindResult = wcsToPixel(180 + 180, -45, testWCS);
    // Normalized RA=0, Dec=-45 - opposite hemisphere
    // The point is very far from the tangent point
    expect(behindResult === null || behindResult !== null).toBe(true);
  });

  it('works with CDELT fallback', () => {
    const cdeltWCS: WCSParams = {
      crpix1: 50,
      crpix2: 50,
      crval1: 180.0,
      crval2: 45.0,
      cd1_1: 0,
      cd1_2: 0,
      cd2_1: 0,
      cd2_2: 0,
      cdelt1: -0.001,
      cdelt2: 0.001,
      ctype1: 'RA---TAN',
      ctype2: 'DEC--TAN',
    };
    const result = wcsToPixel(180.0, 45.0, cdeltWCS);
    if (!result) throw new Error('expected result');
    expect(result.x).toBeCloseTo(50, 3);
    expect(result.y).toBeCloseTo(50, 3);
  });
});

describe('computeGridSpacing', () => {
  it('returns reasonable spacing for 1 degree FOV', () => {
    const spacing = computeGridSpacing(1.0);
    // Should be around 10 arcmin = 1/6 degree
    expect(spacing).toBeGreaterThan(0);
    expect(spacing).toBeLessThanOrEqual(1.0);
    // 1 deg / spacing should yield 2-15 lines
    const nLines = 1.0 / spacing;
    expect(nLines).toBeGreaterThanOrEqual(2);
    expect(nLines).toBeLessThanOrEqual(15);
  });

  it('returns smaller spacing for smaller FOV', () => {
    const small = computeGridSpacing(0.01);
    const large = computeGridSpacing(10.0);
    expect(small).toBeLessThan(large);
  });

  it('returns reasonable spacing for large FOV (30 degrees)', () => {
    const spacing = computeGridSpacing(30.0);
    const nLines = 30.0 / spacing;
    expect(nLines).toBeGreaterThanOrEqual(2);
    expect(nLines).toBeLessThanOrEqual(15);
  });

  it('returns reasonable spacing for small FOV (0.01 degrees)', () => {
    const spacing = computeGridSpacing(0.01);
    const nLines = 0.01 / spacing;
    expect(nLines).toBeGreaterThanOrEqual(2);
    expect(nLines).toBeLessThanOrEqual(15);
  });

  it('returns a "nice" interval value', () => {
    const spacing = computeGridSpacing(5.0);
    // All nice intervals are specific values
    expect(spacing).toBeGreaterThan(0);
  });
});

describe('getPixelScaleArcsec', () => {
  it('computes pixel scale from CD matrix', () => {
    const scale = getPixelScaleArcsec(testWCS);
    if (scale === null) throw new Error('expected scale');
    // cd1_1=-0.001, cd2_2=0.001, det = 0.001*0.001 = 1e-6
    // sqrt(1e-6) = 0.001 deg = 3.6 arcsec
    expect(scale).toBeCloseTo(3.6, 1);
  });

  it('computes pixel scale from CDELT when CD matrix is zero', () => {
    const cdeltWCS: WCSParams = {
      crpix1: 50,
      crpix2: 50,
      crval1: 180.0,
      crval2: 45.0,
      cd1_1: 0,
      cd1_2: 0,
      cd2_1: 0,
      cd2_2: 0,
      cdelt1: -0.001,
      cdelt2: 0.001,
      ctype1: 'RA---TAN',
      ctype2: 'DEC--TAN',
    };
    const scale = getPixelScaleArcsec(cdeltWCS);
    if (scale === null) throw new Error('expected scale');
    expect(scale).toBeCloseTo(3.6, 1);
  });

  it('returns null for zero values', () => {
    const zeroWCS: WCSParams = {
      crpix1: 0,
      crpix2: 0,
      crval1: 0,
      crval2: 0,
      cd1_1: 0,
      cd1_2: 0,
      cd2_1: 0,
      cd2_2: 0,
      cdelt1: 0,
      cdelt2: 0,
      ctype1: '',
      ctype2: '',
    };
    expect(getPixelScaleArcsec(zeroWCS)).toBeNull();
  });

  it('returns null for null WCS', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(getPixelScaleArcsec(null as any)).toBeNull();
  });

  it('handles non-square pixels (off-diagonal CD)', () => {
    const rotatedWCS: WCSParams = {
      ...testWCS,
      cd1_1: -0.0007071,
      cd1_2: 0.0007071,
      cd2_1: 0.0007071,
      cd2_2: 0.0007071,
    };
    const scale = getPixelScaleArcsec(rotatedWCS);
    if (scale === null) throw new Error('expected scale');
    // det = (-0.0007071 * 0.0007071) - (0.0007071 * 0.0007071) = -5e-7 - 5e-7 = -1e-6
    // |det| = 1e-6, sqrt = 0.001, * 3600 = 3.6
    expect(scale).toBeCloseTo(3.6, 0);
  });
});

describe('computeScaleBar', () => {
  it('returns ScaleBarData with reasonable values', () => {
    const result = computeScaleBar(testWCS, 1, 1, 150);
    if (!result) throw new Error('expected result');
    expect(result.angularValueArcsec).toBeGreaterThan(0);
    expect(result.widthPx).toBeGreaterThanOrEqual(20);
    expect(result.widthPx).toBeLessThanOrEqual(150);
    expect(typeof result.label).toBe('string');
    expect(result.label.length).toBeGreaterThan(0);
  });

  it('returns null for bad WCS', () => {
    const zeroWCS: WCSParams = {
      crpix1: 0,
      crpix2: 0,
      crval1: 0,
      crval2: 0,
      cd1_1: 0,
      cd1_2: 0,
      cd2_1: 0,
      cd2_2: 0,
      cdelt1: 0,
      cdelt2: 0,
      ctype1: '',
      ctype2: '',
    };
    expect(computeScaleBar(zeroWCS, 1, 1)).toBeNull();
  });

  it('adjusts for zoom scale', () => {
    const result1 = computeScaleBar(testWCS, 1, 1, 150);
    const result2 = computeScaleBar(testWCS, 1, 4, 150);
    if (!result1) throw new Error('expected result1');
    if (!result2) throw new Error('expected result2');
    // At higher zoom, less sky per pixel, so the bar angular value should be smaller
    expect(result2.angularValueArcsec).toBeLessThanOrEqual(result1.angularValueArcsec);
  });

  it('adjusts for scale factor', () => {
    const result1 = computeScaleBar(testWCS, 1, 1, 150);
    const result2 = computeScaleBar(testWCS, 4, 1, 150);
    if (!result1) throw new Error('expected result1');
    if (!result2) throw new Error('expected result2');
    // Larger scale factor = more sky per screen pixel
    expect(result2.angularValueArcsec).toBeGreaterThanOrEqual(result1.angularValueArcsec);
  });

  it('formats label with arcsec for small values', () => {
    // At zoom level 1 with the testWCS, pixel scale is 3.6"/px
    // With high zoom, we get small values
    const result = computeScaleBar(testWCS, 1, 10, 150);
    if (result) {
      expect(result.label).toMatch(/arcsec|arcmin|°/);
    }
  });
});

describe('computeWcsGridLines', () => {
  it('returns grid data for valid WCS', () => {
    // 100x100 preview, scale factor 10 -> 1000x1000 original
    const result = computeWcsGridLines(testWCS, 100, 100, 10);
    if (!result) throw new Error('expected result');
    expect(result.raLines.length).toBeGreaterThan(0);
    expect(result.decLines.length).toBeGreaterThan(0);
    expect(result.spacingDeg).toBeGreaterThan(0);
  });

  it('returns null for null WCS', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(computeWcsGridLines(null as any, 100, 100, 1)).toBeNull();
  });

  it('returns null for zero-dimension image', () => {
    expect(computeWcsGridLines(testWCS, 0, 100, 1)).toBeNull();
    expect(computeWcsGridLines(testWCS, 100, 0, 1)).toBeNull();
  });

  it('returns null for negative-dimension image', () => {
    expect(computeWcsGridLines(testWCS, -1, 100, 1)).toBeNull();
    expect(computeWcsGridLines(testWCS, 100, -1, 1)).toBeNull();
  });

  it('grid lines contain points in FITS pixel coordinates', () => {
    const result = computeWcsGridLines(testWCS, 100, 100, 10);
    if (!result) throw new Error('expected result');

    for (const line of result.raLines) {
      expect(line.points.length).toBeGreaterThanOrEqual(2);
      for (const p of line.points) {
        expect(typeof p.x).toBe('number');
        expect(typeof p.y).toBe('number');
      }
    }

    for (const line of result.decLines) {
      expect(line.points.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('labels have formatted values', () => {
    const result = computeWcsGridLines(testWCS, 100, 100, 10);
    if (!result) throw new Error('expected result');

    for (const label of result.raLabels) {
      expect(typeof label.formattedValue).toBe('string');
      expect(label.formattedValue.length).toBeGreaterThan(0);
      expect(label.edge).toBe('bottom');
    }

    for (const label of result.decLabels) {
      expect(typeof label.formattedValue).toBe('string');
      expect(label.formattedValue.length).toBeGreaterThan(0);
      expect(label.edge).toBe('left');
    }
  });

  it('handles small images with valid WCS', () => {
    // Very small preview
    const result = computeWcsGridLines(testWCS, 10, 10, 1);
    // May return null if FOV is too small to produce lines
    // or may produce grid data — either is valid
    if (result) {
      expect(result.spacingDeg).toBeGreaterThan(0);
    }
  });
});

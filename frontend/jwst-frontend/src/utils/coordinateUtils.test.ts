import { describe, it, expect, vi } from 'vitest';
import {
  decodePixelData,
  getPixelValue,
  pixelToWCS,
  formatRA,
  formatDec,
  formatPixelValue,
  calculateCursorInfo,
} from './coordinateUtils';
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

// Helper to encode a Float32Array to base64 without Node Buffer
function float32ToBase64(arr: Float32Array): string {
  const bytes = new Uint8Array(arr.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return globalThis.btoa(binary);
}

describe('decodePixelData', () => {
  it('decodes a base64 Float32Array', () => {
    const original = new Float32Array([1.0, 2.0, 3.0]);
    const base64 = float32ToBase64(original);

    const decoded = decodePixelData(base64);
    expect(decoded).toBeInstanceOf(Float32Array);
    expect(decoded.length).toBe(3);
    expect(decoded[0]).toBeCloseTo(1.0);
    expect(decoded[1]).toBeCloseTo(2.0);
    expect(decoded[2]).toBeCloseTo(3.0);
  });

  it('returns empty Float32Array for empty base64', () => {
    vi.stubGlobal('window', {
      atob: () => '',
    });

    const decoded = decodePixelData('');
    expect(decoded).toBeInstanceOf(Float32Array);
    expect(decoded.length).toBe(0);
  });
});

describe('getPixelValue', () => {
  // 3x3 pixel array (row-major, top-left origin):
  // [1, 2, 3,   <- top row (FITS Y=2)
  //  4, 5, 6,   <- middle row (FITS Y=1)
  //  7, 8, 9]   <- bottom row (FITS Y=0)
  const pixels = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const width = 3;
  const height = 3;

  it('returns correct value for in-bounds pixel (0,0) -> bottom-left in FITS', () => {
    // FITS (0,0) = bottom-left, array row = height-1-0 = 2, col = 0 -> index 6 -> 7
    const val = getPixelValue(pixels, width, height, 0, 0);
    expect(val).toBe(7);
  });

  it('returns correct value for center pixel (1,1)', () => {
    // FITS (1,1) = center, array row = height-1-1 = 1, col = 1 -> index 4 -> 5
    const val = getPixelValue(pixels, width, height, 1, 1);
    expect(val).toBe(5);
  });

  it('returns correct value for top-right (2,2) in FITS', () => {
    // FITS (2,2) = top-right, array row = height-1-2 = 0, col = 2 -> index 2 -> 3
    const val = getPixelValue(pixels, width, height, 2, 2);
    expect(val).toBe(3);
  });

  it('returns NaN for x out of bounds (negative)', () => {
    expect(getPixelValue(pixels, width, height, -1, 0)).toBeNaN();
  });

  it('returns NaN for x out of bounds (>= width)', () => {
    expect(getPixelValue(pixels, width, height, 3, 0)).toBeNaN();
  });

  it('returns NaN for y out of bounds (negative)', () => {
    expect(getPixelValue(pixels, width, height, 0, -1)).toBeNaN();
  });

  it('returns NaN for y out of bounds (>= height)', () => {
    expect(getPixelValue(pixels, width, height, 0, 3)).toBeNaN();
  });
});

describe('pixelToWCS', () => {
  it('returns crval1/crval2 at reference pixel', () => {
    // At reference pixel (crpix1, crpix2), dx=0, dy=0, should return crval
    const result = pixelToWCS(50, 50, testWCS);
    if (!result) throw new Error('expected result');
    expect(result.ra).toBeCloseTo(180.0, 5);
    expect(result.dec).toBeCloseTo(45.0, 5);
  });

  it('returns non-null for valid pixel coordinates', () => {
    const result = pixelToWCS(60, 60, testWCS);
    if (!result) throw new Error('expected result');
    // Offset by 10 pixels in each direction
    // xi = -0.001 * 10 + 0 * 10 = -0.01 deg
    // eta = 0 * 10 + 0.001 * 10 = 0.01 deg
    expect(result.ra).toBeDefined();
    expect(result.dec).toBeDefined();
  });

  it('returns null for zero WCS (no transformation)', () => {
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
    expect(pixelToWCS(10, 10, zeroWCS)).toBeNull();
  });

  it('uses CDELT fallback when CD matrix is zero', () => {
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
    const result = pixelToWCS(50, 50, cdeltWCS);
    if (!result) throw new Error('expected result');
    expect(result.ra).toBeCloseTo(180.0, 5);
    expect(result.dec).toBeCloseTo(45.0, 5);
  });

  it('normalizes RA to [0, 360) range', () => {
    // Large offset should still produce valid RA
    const result = pixelToWCS(200, 50, testWCS);
    if (!result) throw new Error('expected result');
    expect(result.ra).toBeGreaterThanOrEqual(0);
    expect(result.ra).toBeLessThan(360);
  });

  it('returns null for null WCS', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(pixelToWCS(10, 10, null as any)).toBeNull();
  });
});

describe('formatRA', () => {
  it('formats 0 degrees as 00h 00m 00.00s', () => {
    expect(formatRA(0)).toBe('00h 00m 00.00s');
  });

  it('formats 180 degrees as 12h 00m 00.00s', () => {
    expect(formatRA(180)).toBe('12h 00m 00.00s');
  });

  it('formats 90 degrees as 06h 00m 00.00s', () => {
    expect(formatRA(90)).toBe('06h 00m 00.00s');
  });

  it('formats 15 degrees as 01h 00m 00.00s (1 hour)', () => {
    expect(formatRA(15)).toBe('01h 00m 00.00s');
  });

  it('formats 360 degrees as 24h', () => {
    // 360/15 = 24 hours
    const result = formatRA(360);
    // Should wrap or display as 24h
    expect(result).toContain('24h');
  });

  it('formats fractional degrees correctly', () => {
    // 45 deg = 3h 0m 0s
    expect(formatRA(45)).toBe('03h 00m 00.00s');
  });
});

describe('formatDec', () => {
  it('formats 0 degrees as +00d 00\' 00.0"', () => {
    expect(formatDec(0)).toBe('+00d 00\' 00.0"');
  });

  it('formats positive declination', () => {
    expect(formatDec(45)).toBe('+45d 00\' 00.0"');
  });

  it('formats negative declination', () => {
    const result = formatDec(-45);
    expect(result).toMatch(/^-45d 00' 00\.0"$/);
  });

  it('formats -90 (south pole)', () => {
    expect(formatDec(-90)).toBe('-90d 00\' 00.0"');
  });

  it('formats +90 (north pole)', () => {
    expect(formatDec(90)).toBe('+90d 00\' 00.0"');
  });

  it('formats fractional degrees with arcminutes and arcseconds', () => {
    // 45.5 deg = 45d 30' 0"
    const result = formatDec(45.5);
    expect(result).toContain("+45d 30'");
  });
});

describe('formatPixelValue', () => {
  it('returns "N/A" for NaN', () => {
    expect(formatPixelValue(NaN)).toBe('N/A');
  });

  it('returns "N/A" for Infinity', () => {
    expect(formatPixelValue(Infinity)).toBe('N/A');
  });

  it('returns "N/A" for -Infinity', () => {
    expect(formatPixelValue(-Infinity)).toBe('N/A');
  });

  it('returns "0.000" for 0', () => {
    expect(formatPixelValue(0)).toBe('0.000');
  });

  it('uses scientific notation for large values (>= 1e4)', () => {
    const result = formatPixelValue(50000);
    expect(result).toMatch(/5\.000e\+4/);
  });

  it('uses scientific notation for very small values (< 1e-2)', () => {
    const result = formatPixelValue(0.001);
    expect(result).toMatch(/1\.000e-3/);
  });

  it('uses fixed decimal for medium values', () => {
    expect(formatPixelValue(42.123)).toBe('42.123');
  });

  it('appends units when provided', () => {
    expect(formatPixelValue(42.123, 'MJy/sr')).toBe('42.123 MJy/sr');
  });

  it('does not append units when not provided', () => {
    expect(formatPixelValue(42.123)).toBe('42.123');
  });

  it('handles negative values', () => {
    expect(formatPixelValue(-5.678)).toBe('-5.678');
  });

  it('uses scientific notation for large negative values', () => {
    const result = formatPixelValue(-50000);
    expect(result).toMatch(/-5\.000e\+4/);
  });
});

describe('calculateCursorInfo', () => {
  // 4x4 pixel array
  const width = 4;
  const height = 4;
  const pixels = new Float32Array(16);
  for (let i = 0; i < 16; i++) pixels[i] = i * 10;
  const scaleFactor = 2;

  it('returns null when mouse is outside image (negative X)', () => {
    const result = calculateCursorInfo(
      -1,
      5,
      100,
      100,
      1,
      0,
      0,
      width,
      height,
      scaleFactor,
      pixels,
      null
    );
    expect(result).toBeNull();
  });

  it('returns null when mouse is outside image (X >= renderedWidth)', () => {
    const result = calculateCursorInfo(
      100,
      5,
      100,
      100,
      1,
      0,
      0,
      width,
      height,
      scaleFactor,
      pixels,
      null
    );
    expect(result).toBeNull();
  });

  it('returns null when mouse is outside image (negative Y)', () => {
    const result = calculateCursorInfo(
      5,
      -1,
      100,
      100,
      1,
      0,
      0,
      width,
      height,
      scaleFactor,
      pixels,
      null
    );
    expect(result).toBeNull();
  });

  it('returns null when mouse is outside image (Y >= renderedHeight)', () => {
    const result = calculateCursorInfo(
      5,
      100,
      100,
      100,
      1,
      0,
      0,
      width,
      height,
      scaleFactor,
      pixels,
      null
    );
    expect(result).toBeNull();
  });

  it('returns CursorInfo when mouse is inside image', () => {
    // Mouse at center of a 100x100 rendered image
    const result = calculateCursorInfo(
      50,
      50,
      100,
      100,
      1,
      0,
      0,
      width,
      height,
      scaleFactor,
      pixels,
      null
    );
    if (!result) throw new Error('expected result');
    expect(result.fitsX).toBeDefined();
    expect(result.fitsY).toBeDefined();
    expect(result.value).toBeDefined();
  });

  it('includes WCS coordinates when WCS is provided', () => {
    const result = calculateCursorInfo(
      50,
      50,
      100,
      100,
      1,
      0,
      0,
      width,
      height,
      scaleFactor,
      pixels,
      testWCS
    );
    if (!result) throw new Error('expected result');
    expect(result.ra).toBeDefined();
    expect(result.dec).toBeDefined();
  });

  it('omits WCS coordinates when WCS is null', () => {
    const result = calculateCursorInfo(
      50,
      50,
      100,
      100,
      1,
      0,
      0,
      width,
      height,
      scaleFactor,
      pixels,
      null
    );
    if (!result) throw new Error('expected result');
    expect(result.ra).toBeUndefined();
    expect(result.dec).toBeUndefined();
  });

  it('returns integer previewX and previewY', () => {
    const result = calculateCursorInfo(
      25,
      25,
      100,
      100,
      1,
      0,
      0,
      width,
      height,
      scaleFactor,
      pixels,
      null
    );
    if (!result) throw new Error('expected result');
    expect(Number.isInteger(result.previewX)).toBe(true);
    expect(Number.isInteger(result.previewY)).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import {
  generateLUT,
  isIdentityCurve,
  applyLUT,
  getDefaultControlPoints,
  getPresetControlPoints,
  CURVE_PRESETS,
} from './curvesUtils';
import type { CurveControlPoint } from '../types/CurvesTypes';

describe('generateLUT', () => {
  it('generates identity LUT from identity control points', () => {
    const points: CurveControlPoint[] = [
      { input: 0, output: 0 },
      { input: 1, output: 1 },
    ];
    const lut = generateLUT(points);
    expect(lut).toBeInstanceOf(Uint8Array);
    expect(lut.length).toBe(256);
    expect(lut[0]).toBe(0);
    expect(lut[255]).toBe(255);
    // Should be monotonically increasing
    for (let i = 1; i < 256; i++) {
      expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1]);
    }
  });

  it('generates invert LUT', () => {
    const points: CurveControlPoint[] = [
      { input: 0, output: 1 },
      { input: 1, output: 0 },
    ];
    const lut = generateLUT(points);
    expect(lut[0]).toBe(255);
    expect(lut[255]).toBe(0);
    // Should be monotonically decreasing
    for (let i = 1; i < 256; i++) {
      expect(lut[i]).toBeLessThanOrEqual(lut[i - 1]);
    }
  });

  it('generates S-curve LUT with 5 points', () => {
    const points: CurveControlPoint[] = [
      { input: 0, output: 0 },
      { input: 0.25, output: 0.15 },
      { input: 0.5, output: 0.5 },
      { input: 0.75, output: 0.85 },
      { input: 1, output: 1 },
    ];
    const lut = generateLUT(points);
    expect(lut[0]).toBe(0);
    expect(lut[255]).toBe(255);
    // Midpoint should be near 128
    expect(lut[128]).toBeGreaterThan(110);
    expect(lut[128]).toBeLessThan(145);
  });

  it('handles unsorted control points', () => {
    const points: CurveControlPoint[] = [
      { input: 1, output: 1 },
      { input: 0, output: 0 },
    ];
    const lut = generateLUT(points);
    expect(lut[0]).toBe(0);
    expect(lut[255]).toBe(255);
  });

  it('clamps output values to [0, 255]', () => {
    const points: CurveControlPoint[] = [
      { input: 0, output: 0 },
      { input: 0.5, output: 1 },
      { input: 1, output: 1 },
    ];
    const lut = generateLUT(points);
    for (let i = 0; i < 256; i++) {
      expect(lut[i]).toBeGreaterThanOrEqual(0);
      expect(lut[i]).toBeLessThanOrEqual(255);
    }
  });

  it('generates constant black LUT', () => {
    const points: CurveControlPoint[] = [
      { input: 0, output: 0 },
      { input: 1, output: 0 },
    ];
    const lut = generateLUT(points);
    expect(lut[0]).toBe(0);
    expect(lut[255]).toBe(0);
    for (let i = 0; i < 256; i++) {
      expect(lut[i]).toBe(0);
    }
  });

  it('generates constant white LUT', () => {
    const points: CurveControlPoint[] = [
      { input: 0, output: 1 },
      { input: 1, output: 1 },
    ];
    const lut = generateLUT(points);
    expect(lut[0]).toBe(255);
    expect(lut[255]).toBe(255);
    for (let i = 0; i < 256; i++) {
      expect(lut[i]).toBe(255);
    }
  });
});

describe('isIdentityCurve', () => {
  it('returns true for exact identity points', () => {
    const points: CurveControlPoint[] = [
      { input: 0, output: 0 },
      { input: 1, output: 1 },
    ];
    expect(isIdentityCurve(points)).toBe(true);
  });

  it('returns true for near-identity points within epsilon', () => {
    const points: CurveControlPoint[] = [
      { input: 0.0005, output: 0.0005 },
      { input: 0.9995, output: 0.9995 },
    ];
    expect(isIdentityCurve(points)).toBe(true);
  });

  it('returns false for invert curve', () => {
    const points: CurveControlPoint[] = [
      { input: 0, output: 1 },
      { input: 1, output: 0 },
    ];
    expect(isIdentityCurve(points)).toBe(false);
  });

  it('returns false for 3+ points', () => {
    const points: CurveControlPoint[] = [
      { input: 0, output: 0 },
      { input: 0.5, output: 0.5 },
      { input: 1, output: 1 },
    ];
    expect(isIdentityCurve(points)).toBe(false);
  });

  it('returns false for single point', () => {
    const points: CurveControlPoint[] = [{ input: 0, output: 0 }];
    expect(isIdentityCurve(points)).toBe(false);
  });

  it('returns false for empty array', () => {
    expect(isIdentityCurve([])).toBe(false);
  });

  it('handles unsorted identity points', () => {
    const points: CurveControlPoint[] = [
      { input: 1, output: 1 },
      { input: 0, output: 0 },
    ];
    expect(isIdentityCurve(points)).toBe(true);
  });

  it('returns false when start output is not 0', () => {
    const points: CurveControlPoint[] = [
      { input: 0, output: 0.1 },
      { input: 1, output: 1 },
    ];
    expect(isIdentityCurve(points)).toBe(false);
  });
});

describe('applyLUT', () => {
  const identityLut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) identityLut[i] = i;

  const invertLut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) invertLut[i] = 255 - i;

  it('identity LUT leaves data unchanged', () => {
    const imageData = {
      data: new Uint8ClampedArray([255, 128, 0, 255, 0, 64, 192, 255]),
    } as unknown as ImageData;

    const original = new Uint8ClampedArray(imageData.data);
    applyLUT(imageData, identityLut);

    expect(imageData.data[0]).toBe(original[0]); // R
    expect(imageData.data[1]).toBe(original[1]); // G
    expect(imageData.data[2]).toBe(original[2]); // B
    expect(imageData.data[3]).toBe(original[3]); // A (unchanged)
    expect(imageData.data[4]).toBe(original[4]);
    expect(imageData.data[5]).toBe(original[5]);
    expect(imageData.data[6]).toBe(original[6]);
    expect(imageData.data[7]).toBe(original[7]);
  });

  it('invert LUT flips RGB values but preserves alpha', () => {
    const imageData = {
      data: new Uint8ClampedArray([255, 128, 0, 200, 0, 64, 192, 100]),
    } as unknown as ImageData;

    applyLUT(imageData, invertLut);

    // First pixel: R=255->0, G=128->127, B=0->255, A=200 unchanged
    expect(imageData.data[0]).toBe(0);
    expect(imageData.data[1]).toBe(127);
    expect(imageData.data[2]).toBe(255);
    expect(imageData.data[3]).toBe(200);

    // Second pixel: R=0->255, G=64->191, B=192->63, A=100 unchanged
    expect(imageData.data[4]).toBe(255);
    expect(imageData.data[5]).toBe(191);
    expect(imageData.data[6]).toBe(63);
    expect(imageData.data[7]).toBe(100);
  });

  it('applies custom LUT correctly', () => {
    const halfLut = new Uint8Array(256);
    for (let i = 0; i < 256; i++) halfLut[i] = Math.floor(i / 2);

    const imageData = {
      data: new Uint8ClampedArray([200, 100, 50, 255]),
    } as unknown as ImageData;

    applyLUT(imageData, halfLut);

    expect(imageData.data[0]).toBe(100); // 200/2
    expect(imageData.data[1]).toBe(50); // 100/2
    expect(imageData.data[2]).toBe(25); // 50/2
    expect(imageData.data[3]).toBe(255); // alpha unchanged
  });
});

describe('getDefaultControlPoints', () => {
  it('returns identity control points', () => {
    const points = getDefaultControlPoints();
    expect(points).toEqual([
      { input: 0, output: 0 },
      { input: 1, output: 1 },
    ]);
  });

  it('returns a new array each time (not a reference)', () => {
    const a = getDefaultControlPoints();
    const b = getDefaultControlPoints();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe('getPresetControlPoints', () => {
  it('returns identity points for "linear"', () => {
    const points = getPresetControlPoints('linear');
    expect(points).toEqual([
      { input: 0, output: 0 },
      { input: 1, output: 1 },
    ]);
  });

  it('returns 5 points for "auto_contrast"', () => {
    const points = getPresetControlPoints('auto_contrast');
    expect(points).toHaveLength(5);
    expect(points[0]).toEqual({ input: 0, output: 0 });
    expect(points[4]).toEqual({ input: 1, output: 1 });
  });

  it('returns 5 points for "high_contrast"', () => {
    const points = getPresetControlPoints('high_contrast');
    expect(points).toHaveLength(5);
  });

  it('returns invert points for "invert"', () => {
    const points = getPresetControlPoints('invert');
    expect(points).toEqual([
      { input: 0, output: 1 },
      { input: 1, output: 0 },
    ]);
  });

  it('returns copies, not references to preset data', () => {
    const a = getPresetControlPoints('auto_contrast');
    const b = getPresetControlPoints('auto_contrast');
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
    // Mutating a should not affect b
    a[0].input = 0.99;
    expect(b[0].input).toBe(0);
  });
});

describe('CURVE_PRESETS', () => {
  it('has exactly 4 presets', () => {
    expect(Object.keys(CURVE_PRESETS)).toHaveLength(4);
  });

  it('contains linear, auto_contrast, high_contrast, invert', () => {
    expect(CURVE_PRESETS).toHaveProperty('linear');
    expect(CURVE_PRESETS).toHaveProperty('auto_contrast');
    expect(CURVE_PRESETS).toHaveProperty('high_contrast');
    expect(CURVE_PRESETS).toHaveProperty('invert');
  });

  it('each preset has name, label, description, and points', () => {
    for (const [key, preset] of Object.entries(CURVE_PRESETS)) {
      expect(preset.name).toBe(key);
      expect(typeof preset.label).toBe('string');
      expect(typeof preset.description).toBe('string');
      expect(Array.isArray(preset.points)).toBe(true);
      expect(preset.points.length).toBeGreaterThanOrEqual(2);
    }
  });
});

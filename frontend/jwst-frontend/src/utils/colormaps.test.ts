import { describe, it, expect } from 'vitest';
import { getColorMap } from './colormaps';
import type { ColorMapName } from './colormaps';

describe('getColorMap', () => {
  const ALL_MAP_NAMES: ColorMapName[] = [
    'grayscale',
    'hot',
    'cool',
    'rainbow',
    'viridis',
    'magma',
    'inferno',
    'plasma',
  ];

  describe('returns 256-entry array for all valid map names', () => {
    for (const name of ALL_MAP_NAMES) {
      it(`"${name}" returns 256 entries`, () => {
        const map = getColorMap(name);
        expect(map).toHaveLength(256);
      });
    }
  });

  describe('each entry is [r, g, b] with values 0-255', () => {
    for (const name of ALL_MAP_NAMES) {
      it(`"${name}" entries are valid RGB tuples`, () => {
        const map = getColorMap(name);
        for (let i = 0; i < map.length; i++) {
          const [r, g, b] = map[i];
          expect(r).toBeGreaterThanOrEqual(0);
          expect(r).toBeLessThanOrEqual(255);
          expect(g).toBeGreaterThanOrEqual(0);
          expect(g).toBeLessThanOrEqual(255);
          expect(b).toBeGreaterThanOrEqual(0);
          expect(b).toBeLessThanOrEqual(255);
          // All values should be integers (Math.floor in interpolate)
          expect(Number.isInteger(r)).toBe(true);
          expect(Number.isInteger(g)).toBe(true);
          expect(Number.isInteger(b)).toBe(true);
        }
      });
    }
  });

  describe('grayscale map properties', () => {
    it('starts at [0, 0, 0] (black)', () => {
      const map = getColorMap('grayscale');
      expect(map[0]).toEqual([0, 0, 0]);
    });

    it('ends at [255, 255, 255] (white)', () => {
      const map = getColorMap('grayscale');
      expect(map[255]).toEqual([255, 255, 255]);
    });

    it('is monotonically increasing (each channel)', () => {
      const map = getColorMap('grayscale');
      for (let i = 1; i < 256; i++) {
        expect(map[i][0]).toBeGreaterThanOrEqual(map[i - 1][0]);
        expect(map[i][1]).toBeGreaterThanOrEqual(map[i - 1][1]);
        expect(map[i][2]).toBeGreaterThanOrEqual(map[i - 1][2]);
      }
    });

    it('midpoint is approximately [127, 127, 127]', () => {
      const map = getColorMap('grayscale');
      // index 127 = 127/255 * 255 = 127 (exact because linear interpolation)
      expect(map[127][0]).toBeCloseTo(127, 0);
      expect(map[127][1]).toBeCloseTo(127, 0);
      expect(map[127][2]).toBeCloseTo(127, 0);
    });
  });

  describe('hot map properties', () => {
    it('starts at [0, 0, 0] (black)', () => {
      const map = getColorMap('hot');
      expect(map[0]).toEqual([0, 0, 0]);
    });

    it('ends at [255, 255, 255] (white)', () => {
      const map = getColorMap('hot');
      expect(map[255]).toEqual([255, 255, 255]);
    });
  });

  describe('unknown map name falls back to grayscale', () => {
    it('returns grayscale for "nonexistent"', () => {
      const unknown = getColorMap('nonexistent');
      const grayscale = getColorMap('grayscale');
      expect(unknown).toEqual(grayscale);
    });

    it('returns grayscale for empty string', () => {
      const unknown = getColorMap('');
      const grayscale = getColorMap('grayscale');
      expect(unknown).toEqual(grayscale);
    });
  });
});

import { describe, it, expect } from 'vitest';
import {
  parseWavelength,
  getWavelengthFromData,
  formatWavelength,
  getFilterLabel,
  chromaticOrderHues,
  wavelengthToHue,
  hueToHex,
  hexToRgb,
  rgbToHue,
  rgbToHex,
  channelColorToHex,
  autoAssignNChannels,
} from './wavelengthUtils';
import type { JwstDataModel } from '../types/JwstDataTypes';

describe('parseWavelength', () => {
  describe('direct lookup', () => {
    it('returns 4.421 for F444W', () => {
      expect(parseWavelength('F444W')).toBe(4.421);
    });

    it('returns 0.901 for F090W', () => {
      expect(parseWavelength('F090W')).toBe(0.901);
    });

    it('returns 5.6 for F560W (MIRI)', () => {
      expect(parseWavelength('F560W')).toBe(5.6);
    });

    it('returns 0 for CLEAR', () => {
      expect(parseWavelength('CLEAR')).toBe(0);
    });
  });

  describe('pattern matching from longer strings', () => {
    it('extracts F444W from "NIRCAM/F444W"', () => {
      expect(parseWavelength('NIRCAM/F444W')).toBe(4.421);
    });

    it('extracts filter from "F444W-CLEAR"', () => {
      expect(parseWavelength('F444W-CLEAR')).toBe(4.421);
    });
  });

  describe('null/unknown inputs', () => {
    it('returns null for null', () => {
      expect(parseWavelength(null)).toBeNull();
    });

    it('returns null for undefined', () => {
      expect(parseWavelength(undefined)).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parseWavelength('')).toBeNull();
    });

    it('returns null for unknown filter', () => {
      expect(parseWavelength('UNKNOWN_FILTER')).toBeNull();
    });
  });

  describe('case insensitivity', () => {
    it('handles lowercase f444w', () => {
      expect(parseWavelength('f444w')).toBe(4.421);
    });

    it('handles mixed case', () => {
      expect(parseWavelength('f444W')).toBe(4.421);
    });
  });
});

describe('getWavelengthFromData', () => {
  const mockData = (overrides: Partial<JwstDataModel> = {}): JwstDataModel =>
    ({
      id: 'test-id',
      fileName: 'test.fits',
      dataType: 'fits',
      uploadDate: '2024-01-01',
      metadata: {},
      fileSize: 1000,
      processingStatus: 'completed',
      tags: [],
      isArchived: false,
      processingResults: [],
      ...overrides,
    }) as JwstDataModel;

  it('extracts wavelength from imageInfo.filter', () => {
    const data = mockData({ imageInfo: { width: 100, height: 100, filter: 'F444W' } });
    expect(getWavelengthFromData(data)).toBe(4.421);
  });

  it('extracts numeric wavelength from imageInfo.wavelength', () => {
    const data = mockData({ imageInfo: { width: 100, height: 100, wavelength: '4.5' } });
    expect(getWavelengthFromData(data)).toBe(4.5);
  });

  it('extracts from sensorInfo.wavelength', () => {
    const data = mockData({ sensorInfo: { wavelength: '7.7' } });
    expect(getWavelengthFromData(data)).toBe(7.7);
  });

  it('falls back to filename extraction', () => {
    const data = mockData({ fileName: 'jw02731-o001_t001_nircam_clear-f444w_i2d.fits' });
    expect(getWavelengthFromData(data)).toBe(4.421);
  });

  it('returns null when no data available', () => {
    const data = mockData({ fileName: 'random_file.fits' });
    expect(getWavelengthFromData(data)).toBeNull();
  });

  it('prioritizes imageInfo.filter over other sources', () => {
    const data = mockData({
      imageInfo: { width: 100, height: 100, filter: 'F200W', wavelength: '10.0' },
      sensorInfo: { wavelength: '15.0' },
    });
    expect(getWavelengthFromData(data)).toBe(1.989); // F200W wavelength
  });
});

describe('formatWavelength', () => {
  it('returns "Unknown" for null', () => {
    expect(formatWavelength(null)).toBe('Unknown');
  });

  it('formats 4.44 as "4.44 \u03bcm"', () => {
    expect(formatWavelength(4.44)).toBe('4.44 \u03bcm');
  });

  it('formats 0.9 as "0.90 \u03bcm"', () => {
    expect(formatWavelength(0.9)).toBe('0.90 \u03bcm');
  });

  it('formats 25.5 as "25.50 \u03bcm"', () => {
    expect(formatWavelength(25.5)).toBe('25.50 \u03bcm');
  });

  it('formats 0 as "0.00 \u03bcm"', () => {
    expect(formatWavelength(0)).toBe('0.00 \u03bcm');
  });
});

describe('getFilterLabel', () => {
  const mockData = (filter?: string, wavelength?: string): JwstDataModel =>
    ({
      id: 'test',
      fileName: 'test.fits',
      dataType: 'fits',
      uploadDate: '2024-01-01',
      metadata: {},
      fileSize: 1000,
      processingStatus: 'completed',
      tags: [],
      isArchived: false,
      processingResults: [],
      imageInfo: filter || wavelength ? { width: 100, height: 100, filter, wavelength } : undefined,
    }) as JwstDataModel;

  it('returns "F444W (4.42 \u03bcm)" for filter with known wavelength', () => {
    expect(getFilterLabel(mockData('F444W'))).toBe('F444W (4.42 \u03bcm)');
  });

  it('returns just filter name for unknown filter', () => {
    expect(getFilterLabel(mockData('UNKNOWN'))).toBe('UNKNOWN');
  });

  it('returns formatted wavelength when no filter but wavelength exists', () => {
    expect(getFilterLabel(mockData(undefined, '4.5'))).toBe('4.50 \u03bcm');
  });

  it('returns "Unknown filter" when nothing available', () => {
    expect(getFilterLabel(mockData())).toBe('Unknown filter');
  });
});

describe('chromaticOrderHues', () => {
  it('returns [0] for single filter', () => {
    expect(chromaticOrderHues(1)).toEqual([0]);
  });

  it('returns [240, 0] for two filters', () => {
    expect(chromaticOrderHues(2)).toEqual([240, 0]);
  });

  it('returns [240, 120, 0] for three filters', () => {
    const hues = chromaticOrderHues(3);
    expect(hues[0]).toBeCloseTo(240);
    expect(hues[1]).toBeCloseTo(120);
    expect(hues[2]).toBeCloseTo(0);
  });

  it('returns four evenly-spaced hues', () => {
    const hues = chromaticOrderHues(4);
    expect(hues[0]).toBeCloseTo(240);
    expect(hues[1]).toBeCloseTo(160);
    expect(hues[2]).toBeCloseTo(80);
    expect(hues[3]).toBeCloseTo(0);
  });

  it('produces monotonically decreasing hues', () => {
    for (const n of [2, 3, 4, 5, 6, 7, 8]) {
      const hues = chromaticOrderHues(n);
      for (let i = 0; i < hues.length - 1; i++) {
        expect(hues[i]).toBeGreaterThan(hues[i + 1]);
      }
    }
  });

  it('all hues are in [0, 240]', () => {
    for (const n of [1, 2, 3, 5, 8, 10]) {
      const hues = chromaticOrderHues(n);
      for (const h of hues) {
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThanOrEqual(240);
      }
    }
  });

  it('throws for n < 1', () => {
    expect(() => chromaticOrderHues(0)).toThrow();
    expect(() => chromaticOrderHues(-1)).toThrow();
  });
});

describe('wavelengthToHue', () => {
  it('returns 270 for shortest wavelength (0.6 um)', () => {
    expect(wavelengthToHue(0.6)).toBeCloseTo(270, 0);
  });

  it('returns 0 for longest wavelength (28.0 um)', () => {
    expect(wavelengthToHue(28.0)).toBeCloseTo(0, 0);
  });

  it('returns intermediate hue for mid-range wavelength', () => {
    const hue = wavelengthToHue(4.0);
    expect(hue).toBeGreaterThan(0);
    expect(hue).toBeLessThan(270);
  });

  it('clamps wavelengths below minimum to 270', () => {
    expect(wavelengthToHue(0.1)).toBeCloseTo(270, 0);
  });

  it('clamps wavelengths above maximum to 0', () => {
    expect(wavelengthToHue(100.0)).toBeCloseTo(0, 0);
  });
});

describe('hueToHex', () => {
  it('returns red for hue 0', () => {
    expect(hueToHex(0)).toBe('#ff0000');
  });

  it('returns green for hue 120', () => {
    expect(hueToHex(120)).toBe('#00ff00');
  });

  it('returns blue for hue 240', () => {
    expect(hueToHex(240)).toBe('#0000ff');
  });

  it('returns yellow for hue 60', () => {
    expect(hueToHex(60)).toBe('#ffff00');
  });

  it('returns cyan for hue 180', () => {
    expect(hueToHex(180)).toBe('#00ffff');
  });

  it('returns magenta for hue 300', () => {
    expect(hueToHex(300)).toBe('#ff00ff');
  });

  it('handles hue 360 (same as 0)', () => {
    expect(hueToHex(360)).toBe('#ff0000');
  });

  it('handles negative hue', () => {
    // -60 should wrap to 300
    expect(hueToHex(-60)).toBe('#ff00ff');
  });
});

describe('hexToRgb', () => {
  it('converts #ff0000 to [1, 0, 0]', () => {
    const [r, g, b] = hexToRgb('#ff0000');
    expect(r).toBeCloseTo(1, 2);
    expect(g).toBeCloseTo(0, 2);
    expect(b).toBeCloseTo(0, 2);
  });

  it('converts #00ff00 to [0, 1, 0]', () => {
    const [r, g, b] = hexToRgb('#00ff00');
    expect(r).toBeCloseTo(0, 2);
    expect(g).toBeCloseTo(1, 2);
    expect(b).toBeCloseTo(0, 2);
  });

  it('converts #0000ff to [0, 0, 1]', () => {
    const [r, g, b] = hexToRgb('#0000ff');
    expect(r).toBeCloseTo(0, 2);
    expect(g).toBeCloseTo(0, 2);
    expect(b).toBeCloseTo(1, 2);
  });

  it('handles 3-char hex "fff"', () => {
    const [r, g, b] = hexToRgb('fff');
    expect(r).toBeCloseTo(1, 2);
    expect(g).toBeCloseTo(1, 2);
    expect(b).toBeCloseTo(1, 2);
  });

  it('handles 3-char hex with hash "#000"', () => {
    const [r, g, b] = hexToRgb('#000');
    expect(r).toBeCloseTo(0, 2);
    expect(g).toBeCloseTo(0, 2);
    expect(b).toBeCloseTo(0, 2);
  });

  it('handles without hash "ff8000"', () => {
    const [r, g, b] = hexToRgb('ff8000');
    expect(r).toBeCloseTo(1, 2);
    expect(g).toBeCloseTo(0.502, 1);
    expect(b).toBeCloseTo(0, 2);
  });

  it('converts 808080 to ~[0.502, 0.502, 0.502]', () => {
    const [r, g, b] = hexToRgb('808080');
    expect(r).toBeCloseTo(0.502, 2);
    expect(g).toBeCloseTo(0.502, 2);
    expect(b).toBeCloseTo(0.502, 2);
  });
});

describe('rgbToHue', () => {
  it('returns 0 for pure red', () => {
    expect(rgbToHue(1, 0, 0)).toBe(0);
  });

  it('returns 120 for pure green', () => {
    expect(rgbToHue(0, 1, 0)).toBe(120);
  });

  it('returns 240 for pure blue', () => {
    expect(rgbToHue(0, 0, 1)).toBe(240);
  });

  it('returns 0 for gray (no saturation)', () => {
    expect(rgbToHue(0.5, 0.5, 0.5)).toBe(0);
  });

  it('returns 0 for black', () => {
    expect(rgbToHue(0, 0, 0)).toBe(0);
  });

  it('returns 0 for white', () => {
    expect(rgbToHue(1, 1, 1)).toBe(0);
  });

  it('returns 60 for yellow', () => {
    expect(rgbToHue(1, 1, 0)).toBe(60);
  });

  it('returns 180 for cyan', () => {
    expect(rgbToHue(0, 1, 1)).toBe(180);
  });
});

describe('rgbToHex', () => {
  it('converts [1, 0, 0] to #ff0000', () => {
    expect(rgbToHex(1, 0, 0)).toBe('#ff0000');
  });

  it('converts [0, 1, 0] to #00ff00', () => {
    expect(rgbToHex(0, 1, 0)).toBe('#00ff00');
  });

  it('converts [0, 0, 1] to #0000ff', () => {
    expect(rgbToHex(0, 0, 1)).toBe('#0000ff');
  });

  it('converts [1, 1, 1] to #ffffff', () => {
    expect(rgbToHex(1, 1, 1)).toBe('#ffffff');
  });

  it('converts [0, 0, 0] to #000000', () => {
    expect(rgbToHex(0, 0, 0)).toBe('#000000');
  });

  it('clamps values > 1', () => {
    expect(rgbToHex(1.5, 0, 0)).toBe('#ff0000');
  });

  it('clamps values < 0', () => {
    expect(rgbToHex(-0.5, 0, 0)).toBe('#000000');
  });
});

describe('channelColorToHex', () => {
  it('returns #cccccc for luminance channel', () => {
    expect(channelColorToHex({ luminance: true })).toBe('#cccccc');
  });

  it('returns hex from rgb if present', () => {
    expect(channelColorToHex({ rgb: [1, 0, 0] })).toBe('#ff0000');
  });

  it('returns hex from hue if present', () => {
    expect(channelColorToHex({ hue: 120 })).toBe('#00ff00');
  });

  it('defaults to hue 0 (red) when no color spec', () => {
    expect(channelColorToHex({})).toBe('#ff0000');
  });

  it('prioritizes luminance over rgb', () => {
    expect(channelColorToHex({ luminance: true, rgb: [0, 1, 0] })).toBe('#cccccc');
  });

  it('prioritizes rgb over hue', () => {
    expect(channelColorToHex({ rgb: [0, 0, 1], hue: 0 })).toBe('#0000ff');
  });
});

describe('autoAssignNChannels', () => {
  const mockImage = (id: string, filter: string) =>
    ({
      id,
      imageInfo: { filter, width: 100, height: 100 },
      fileName: `test_${filter.toLowerCase()}_i2d.fits`,
      dataType: 'fits',
      uploadDate: '2024-01-01',
      metadata: {},
      fileSize: 1000,
      processingStatus: 'completed',
      tags: [],
      isArchived: false,
      processingResults: [],
    }) as unknown as JwstDataModel;

  it('creates one channel per unique filter', () => {
    const images = [mockImage('1', 'F200W'), mockImage('2', 'F444W'), mockImage('3', 'F200W')];
    const channels = autoAssignNChannels(images);
    expect(channels).toHaveLength(2);
  });

  it('sorts channels by wavelength (ascending)', () => {
    const images = [mockImage('1', 'F444W'), mockImage('2', 'F090W'), mockImage('3', 'F200W')];
    const channels = autoAssignNChannels(images);
    expect(channels[0].label).toBe('F090W');
    expect(channels[1].label).toBe('F200W');
    expect(channels[2].label).toBe('F444W');
  });

  it('groups multiple images with same filter into one channel', () => {
    const images = [mockImage('1', 'F444W'), mockImage('2', 'F444W')];
    const channels = autoAssignNChannels(images);
    expect(channels).toHaveLength(1);
    expect(channels[0].dataIds).toEqual(['1', '2']);
  });

  it('assigns wavelengthUm from known filters', () => {
    const images = [mockImage('1', 'F444W')];
    const channels = autoAssignNChannels(images);
    expect(channels[0].wavelengthUm).toBe(4.421);
  });

  it('puts unknown filters at the end (sorted by Infinity)', () => {
    const images = [mockImage('1', 'UNKNOWN'), mockImage('2', 'F200W')];
    const channels = autoAssignNChannels(images);
    expect(channels[0].label).toBe('F200W');
    expect(channels[1].label).toBe('UNKNOWN');
  });

  it('returns empty array for empty input', () => {
    expect(autoAssignNChannels([])).toEqual([]);
  });

  it('assigns hue via chromatic ordering (single filter gets red)', () => {
    const images = [mockImage('1', 'F444W')];
    const channels = autoAssignNChannels(images);
    // Single filter → chromatic ordering returns [0] (red)
    expect(channels[0].color.hue).toBe(0);
  });

  it('assigns chromatic ordering hues for multiple filters', () => {
    const images = [mockImage('1', 'F090W'), mockImage('2', 'F200W'), mockImage('3', 'F444W')];
    const channels = autoAssignNChannels(images);
    // 3 filters sorted by wavelength → hues 240, 120, 0
    expect(channels[0].color.hue).toBeCloseTo(240); // F090W (shortest)
    expect(channels[1].color.hue).toBeCloseTo(120); // F200W (middle)
    expect(channels[2].color.hue).toBeCloseTo(0); // F444W (longest)
  });

  it('assigns default channel params', () => {
    const images = [mockImage('1', 'F444W')];
    const channels = autoAssignNChannels(images);
    expect(channels[0].params.stretch).toBe('log');
    expect(channels[0].params.weight).toBe(1.0);
    expect(channels[0].params.gamma).toBe(1.0);
  });
});

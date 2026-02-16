import { describe, it, expect } from 'vitest';
import { JwstDataModel } from '../types/JwstDataTypes';
import {
  FILTER_PRESETS,
  getPresetsByInstrument,
  createChannelsFromPreset,
  matchImagesToPreset,
  countPresetMatches,
} from './filterPresets';

/** Helper to create a minimal JwstDataModel with a filter name */
function makeImage(id: string, filter: string): JwstDataModel {
  return {
    id,
    userId: 'u1',
    groupId: 'g1',
    fileName: `${id}.fits`,
    fileSize: 1000,
    status: 'completed',
    imageInfo: { width: 100, height: 100, filter },
  } as unknown as JwstDataModel;
}

describe('FILTER_PRESETS', () => {
  it('contains 7 presets', () => {
    expect(FILTER_PRESETS).toHaveLength(7);
  });

  it('all presets have unique IDs', () => {
    const ids = FILTER_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all presets have at least 3 filters', () => {
    for (const preset of FILTER_PRESETS) {
      expect(preset.filters.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('all filters have positive wavelengths', () => {
    for (const preset of FILTER_PRESETS) {
      for (const f of preset.filters) {
        expect(f.wavelengthUm).toBeGreaterThan(0);
      }
    }
  });
});

describe('getPresetsByInstrument', () => {
  it('groups into NIRCam, MIRI, and Mixed', () => {
    const groups = getPresetsByInstrument();
    expect(groups.has('NIRCam')).toBe(true);
    expect(groups.has('MIRI')).toBe(true);
    expect(groups.has('Mixed')).toBe(true);
  });

  it('NIRCam has 3 presets', () => {
    const groups = getPresetsByInstrument();
    expect(groups.get('NIRCam')).toHaveLength(3);
  });

  it('MIRI has 3 presets', () => {
    const groups = getPresetsByInstrument();
    expect(groups.get('MIRI')).toHaveLength(3);
  });

  it('Mixed has 1 preset', () => {
    const groups = getPresetsByInstrument();
    expect(groups.get('Mixed')).toHaveLength(1);
  });
});

describe('createChannelsFromPreset', () => {
  const deepField = FILTER_PRESETS.find((p) => p.id === 'nircam-deep-field');
  if (!deepField) throw new Error('Preset nircam-deep-field not found');

  it('creates one channel per filter', () => {
    const channels = createChannelsFromPreset(deepField);
    expect(channels).toHaveLength(6);
  });

  it('channels have filter names as labels', () => {
    const channels = createChannelsFromPreset(deepField);
    expect(channels.map((c) => c.label)).toEqual([
      'F090W',
      'F150W',
      'F200W',
      'F277W',
      'F356W',
      'F444W',
    ]);
  });

  it('channels have wavelengthUm set', () => {
    const channels = createChannelsFromPreset(deepField);
    expect(channels[0].wavelengthUm).toBe(0.901);
    expect(channels[5].wavelengthUm).toBe(4.421);
  });

  it('channels have hue-based colors (shorter wavelength = higher hue)', () => {
    const channels = createChannelsFromPreset(deepField);
    // F090W (0.9um) should have higher hue than F444W (4.4um)
    const hueF090 = channels[0].color.hue;
    const hueF444 = channels[5].color.hue;
    if (hueF090 == null || hueF444 == null) throw new Error('Expected hue to be defined');
    expect(hueF090).toBeGreaterThan(hueF444);
  });

  it('channels start with empty dataIds', () => {
    const channels = createChannelsFromPreset(deepField);
    for (const ch of channels) {
      expect(ch.dataIds).toEqual([]);
    }
  });

  it('channels have unique IDs', () => {
    const channels = createChannelsFromPreset(deepField);
    const ids = channels.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('matchImagesToPreset', () => {
  const threeFilter = FILTER_PRESETS.find((p) => p.id === 'nircam-3filter');
  if (!threeFilter) throw new Error('Preset nircam-3filter not found');

  it('matches images by exact filter name (case-insensitive)', () => {
    const channels = createChannelsFromPreset(threeFilter);
    const images = [
      makeImage('img1', 'F090W'),
      makeImage('img2', 'f200w'), // lowercase
      makeImage('img3', 'F444W'),
    ];

    const matched = matchImagesToPreset(channels, images);
    expect(matched[0].dataIds).toEqual(['img1']); // F090W
    expect(matched[1].dataIds).toEqual(['img2']); // F200W
    expect(matched[2].dataIds).toEqual(['img3']); // F444W
  });

  it('handles compound filter names like CLEAR-F444W', () => {
    const channels = createChannelsFromPreset(threeFilter);
    const images = [makeImage('img1', 'CLEAR-F444W')];

    const matched = matchImagesToPreset(channels, images);
    expect(matched[2].dataIds).toEqual(['img1']); // F444W channel
  });

  it('handles compound filter names like F200W-CLEAR', () => {
    const channels = createChannelsFromPreset(threeFilter);
    const images = [makeImage('img1', 'F200W-CLEAR')];

    const matched = matchImagesToPreset(channels, images);
    expect(matched[1].dataIds).toEqual(['img1']); // F200W channel
  });

  it('assigns multiple images with same filter to the same channel', () => {
    const channels = createChannelsFromPreset(threeFilter);
    const images = [
      makeImage('img1', 'F090W'),
      makeImage('img2', 'F090W'),
      makeImage('img3', 'F090W'),
    ];

    const matched = matchImagesToPreset(channels, images);
    expect(matched[0].dataIds).toEqual(['img1', 'img2', 'img3']);
    expect(matched[1].dataIds).toEqual([]); // F200W unmatched
    expect(matched[2].dataIds).toEqual([]); // F444W unmatched
  });

  it('leaves unmatched channels with empty dataIds', () => {
    const channels = createChannelsFromPreset(threeFilter);
    const images = [makeImage('img1', 'F090W')];

    const matched = matchImagesToPreset(channels, images);
    expect(matched[0].dataIds).toEqual(['img1']);
    expect(matched[1].dataIds).toEqual([]);
    expect(matched[2].dataIds).toEqual([]);
  });

  it('ignores images with no filter info', () => {
    const channels = createChannelsFromPreset(threeFilter);
    const images = [
      {
        id: 'no-filter',
        userId: 'u1',
        groupId: 'g1',
        fileName: 'x.fits',
        fileSize: 100,
        status: 'completed',
      } as unknown as JwstDataModel,
    ];

    const matched = matchImagesToPreset(channels, images);
    for (const ch of matched) {
      expect(ch.dataIds).toEqual([]);
    }
  });

  it('ignores images that match no preset filter', () => {
    const channels = createChannelsFromPreset(threeFilter);
    const images = [makeImage('img1', 'F770W')]; // MIRI filter, not in nircam-3filter

    const matched = matchImagesToPreset(channels, images);
    for (const ch of matched) {
      expect(ch.dataIds).toEqual([]);
    }
  });
});

describe('countPresetMatches', () => {
  const threeFilter = FILTER_PRESETS.find((p) => p.id === 'nircam-3filter');
  if (!threeFilter) throw new Error('Preset nircam-3filter not found');

  it('counts matched distinct filters', () => {
    const images = [makeImage('img1', 'F090W'), makeImage('img2', 'F444W')];

    const result = countPresetMatches(threeFilter, images);
    expect(result).toEqual({ matched: 2, total: 3 });
  });

  it('returns 0 matched for no matching images', () => {
    const images = [makeImage('img1', 'F770W')];
    const result = countPresetMatches(threeFilter, images);
    expect(result).toEqual({ matched: 0, total: 3 });
  });

  it('returns full match when all filters present', () => {
    const images = [
      makeImage('img1', 'F090W'),
      makeImage('img2', 'F200W'),
      makeImage('img3', 'F444W'),
    ];

    const result = countPresetMatches(threeFilter, images);
    expect(result).toEqual({ matched: 3, total: 3 });
  });

  it('counts compound filter names', () => {
    const images = [makeImage('img1', 'CLEAR-F090W')];
    const result = countPresetMatches(threeFilter, images);
    expect(result).toEqual({ matched: 1, total: 3 });
  });

  it('does not double-count multiple images with same filter', () => {
    const images = [
      makeImage('img1', 'F090W'),
      makeImage('img2', 'F090W'),
      makeImage('img3', 'F090W'),
    ];

    const result = countPresetMatches(threeFilter, images);
    expect(result).toEqual({ matched: 1, total: 3 });
  });

  it('works for a large preset', () => {
    const stephan = FILTER_PRESETS.find((p) => p.id === 'mixed-stephans-quintet');
    if (!stephan) throw new Error('Preset mixed-stephans-quintet not found');
    const images = [
      makeImage('img1', 'F090W'),
      makeImage('img2', 'F150W'),
      makeImage('img3', 'F200W'),
      makeImage('img4', 'F277W'),
      makeImage('img5', 'F356W'),
      makeImage('img6', 'F444W'),
      makeImage('img7', 'F770W'),
    ];

    const result = countPresetMatches(stephan, images);
    expect(result).toEqual({ matched: 7, total: 7 });
  });
});

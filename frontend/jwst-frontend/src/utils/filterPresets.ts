/**
 * Curated JWST filter presets for common observation filter sets.
 * Each preset defines channels that match iconic JWST composite images
 * (Pillars of Creation, Deep Field, Southern Ring, etc.).
 */

import { JwstDataModel } from '../types/JwstDataTypes';
import {
  NChannelState,
  createDefaultNChannel,
  DEFAULT_CHANNEL_PARAMS,
} from '../types/CompositeTypes';
import { wavelengthToHue } from './wavelengthUtils';

export type PresetInstrument = 'NIRCam' | 'MIRI' | 'Mixed';

export interface PresetFilter {
  name: string; // e.g. "F444W"
  wavelengthUm: number;
}

export interface FilterPreset {
  id: string;
  name: string;
  instrument: PresetInstrument;
  filters: PresetFilter[];
}

export const FILTER_PRESETS: FilterPreset[] = [
  // NIRCam presets
  {
    id: 'nircam-deep-field',
    name: 'NIRCam Deep Field',
    instrument: 'NIRCam',
    filters: [
      { name: 'F090W', wavelengthUm: 0.901 },
      { name: 'F150W', wavelengthUm: 1.501 },
      { name: 'F200W', wavelengthUm: 1.989 },
      { name: 'F277W', wavelengthUm: 2.762 },
      { name: 'F356W', wavelengthUm: 3.568 },
      { name: 'F444W', wavelengthUm: 4.421 },
    ],
  },
  {
    id: 'nircam-pillars',
    name: 'NIRCam Pillars of Creation',
    instrument: 'NIRCam',
    filters: [
      { name: 'F090W', wavelengthUm: 0.901 },
      { name: 'F187N', wavelengthUm: 1.874 },
      { name: 'F200W', wavelengthUm: 1.989 },
      { name: 'F335M', wavelengthUm: 3.362 },
      { name: 'F444W', wavelengthUm: 4.421 },
      { name: 'F470N', wavelengthUm: 4.707 },
    ],
  },
  {
    id: 'nircam-3filter',
    name: 'NIRCam 3-Filter',
    instrument: 'NIRCam',
    filters: [
      { name: 'F090W', wavelengthUm: 0.901 },
      { name: 'F200W', wavelengthUm: 1.989 },
      { name: 'F444W', wavelengthUm: 4.421 },
    ],
  },
  // MIRI presets
  {
    id: 'miri-southern-ring',
    name: 'MIRI Southern Ring',
    instrument: 'MIRI',
    filters: [
      { name: 'F770W', wavelengthUm: 7.7 },
      { name: 'F1130W', wavelengthUm: 11.3 },
      { name: 'F1280W', wavelengthUm: 12.8 },
      { name: 'F1800W', wavelengthUm: 18.0 },
    ],
  },
  {
    id: 'miri-pillars',
    name: 'MIRI Pillars of Creation',
    instrument: 'MIRI',
    filters: [
      { name: 'F770W', wavelengthUm: 7.7 },
      { name: 'F1130W', wavelengthUm: 11.3 },
      { name: 'F1800W', wavelengthUm: 18.0 },
      { name: 'F2100W', wavelengthUm: 21.0 },
    ],
  },
  {
    id: 'miri-broadband',
    name: 'MIRI 5-Filter Broadband',
    instrument: 'MIRI',
    filters: [
      { name: 'F560W', wavelengthUm: 5.6 },
      { name: 'F770W', wavelengthUm: 7.7 },
      { name: 'F1000W', wavelengthUm: 10.0 },
      { name: 'F1130W', wavelengthUm: 11.3 },
      { name: 'F1280W', wavelengthUm: 12.8 },
    ],
  },
  // Mixed
  {
    id: 'mixed-stephans-quintet',
    name: "Stephan's Quintet",
    instrument: 'Mixed',
    filters: [
      { name: 'F090W', wavelengthUm: 0.901 },
      { name: 'F150W', wavelengthUm: 1.501 },
      { name: 'F200W', wavelengthUm: 1.989 },
      { name: 'F277W', wavelengthUm: 2.762 },
      { name: 'F356W', wavelengthUm: 3.568 },
      { name: 'F444W', wavelengthUm: 4.421 },
      { name: 'F770W', wavelengthUm: 7.7 },
    ],
  },
];

/**
 * Group presets by instrument for dropdown display.
 */
export function getPresetsByInstrument(): Map<PresetInstrument, FilterPreset[]> {
  const groups = new Map<PresetInstrument, FilterPreset[]>();
  for (const preset of FILTER_PRESETS) {
    const list = groups.get(preset.instrument) || [];
    list.push(preset);
    groups.set(preset.instrument, list);
  }
  return groups;
}

/**
 * Create NChannelState[] from a preset definition.
 * Each filter becomes one channel with hue derived from wavelength.
 */
export function createChannelsFromPreset(preset: FilterPreset): NChannelState[] {
  return preset.filters.map((f) => {
    const hue = wavelengthToHue(f.wavelengthUm);
    const channel = createDefaultNChannel(hue);
    channel.label = f.name;
    channel.wavelengthUm = f.wavelengthUm;
    channel.params = { ...DEFAULT_CHANNEL_PARAMS };
    return channel;
  });
}

/**
 * Extract a simple filter name from a potentially compound filter string.
 * Handles formats like "CLEAR-F444W", "F444W-CLEAR", "NIRCAM/F444W".
 */
function extractFilterName(raw: string): string {
  const upper = raw.toUpperCase().trim();
  // Split on common separators
  const parts = upper.split(/[-/;]+/);
  // Return the first part that looks like a JWST filter (F###X)
  for (const part of parts) {
    if (/^F\d{2,4}[WMNLP]/.test(part.trim())) {
      // Extract just the filter code (e.g. F444W from F444W2)
      const match = part.trim().match(/^F\d{2,4}[WMNLP]\d?/);
      if (match) return match[0];
    }
  }
  return upper;
}

/**
 * Match user images to preset channels by filter name.
 * Returns a new channels array with dataIds populated for matched images.
 *
 * Matching rules:
 * 1. Case-insensitive filter name comparison
 * 2. Compound name extraction (e.g. "CLEAR-F444W" matches "F444W")
 * 3. Multiple images with same filter go to the same channel
 * 4. Unmatched channels keep empty dataIds
 */
export function matchImagesToPreset(
  channels: NChannelState[],
  images: JwstDataModel[]
): NChannelState[] {
  return channels.map((ch) => {
    const presetFilter = ch.label?.toUpperCase() || '';
    const matchedIds: string[] = [];

    for (const img of images) {
      const imgFilter = img.imageInfo?.filter;
      if (!imgFilter) continue;

      const extracted = extractFilterName(imgFilter);
      if (extracted === presetFilter) {
        matchedIds.push(img.id);
      }
    }

    return { ...ch, dataIds: matchedIds };
  });
}

/**
 * Count how many user images match a preset's filters.
 * Returns count of distinct filters that have at least one matching image.
 */
export function countPresetMatches(
  preset: FilterPreset,
  images: JwstDataModel[]
): { matched: number; total: number } {
  const total = preset.filters.length;
  let matched = 0;

  for (const filter of preset.filters) {
    const filterName = filter.name.toUpperCase();
    const hasMatch = images.some((img) => {
      const imgFilter = img.imageInfo?.filter;
      if (!imgFilter) return false;
      return extractFilterName(imgFilter) === filterName;
    });
    if (hasMatch) matched++;
  }

  return { matched, total };
}

/**
 * Utilities for parsing JWST filter wavelengths and auto-sorting for RGB composites
 */

import { JwstDataModel } from '../types/JwstDataTypes';
import {
  NChannelState,
  createDefaultNChannel,
  DEFAULT_CHANNEL_PARAMS,
} from '../types/CompositeTypes';

/**
 * Known JWST filter wavelengths in micrometers
 * Source: JWST documentation
 */
const FILTER_WAVELENGTHS: Record<string, number> = {
  // NIRCam Short Wavelength filters
  F070W: 0.704,
  F090W: 0.901,
  F115W: 1.154,
  F140M: 1.404,
  F150W: 1.501,
  F162M: 1.626,
  F164N: 1.644,
  F150W2: 1.659,
  F182M: 1.845,
  F187N: 1.874,
  F200W: 1.989,
  F210M: 2.093,
  F212N: 2.12,

  // NIRCam Long Wavelength filters
  F250M: 2.503,
  F277W: 2.762,
  F300M: 2.989,
  F322W2: 3.232,
  F323N: 3.237,
  F335M: 3.362,
  F356W: 3.568,
  F360M: 3.624,
  F405N: 4.052,
  F410M: 4.082,
  F430M: 4.28,
  F444W: 4.421,
  F460M: 4.624,
  F466N: 4.654,
  F470N: 4.707,
  F480M: 4.817,

  // MIRI filters
  F560W: 5.6,
  F770W: 7.7,
  F1000W: 10.0,
  F1130W: 11.3,
  F1280W: 12.8,
  F1500W: 15.0,
  F1800W: 18.0,
  F2100W: 21.0,
  F2550W: 25.5,

  // NIRSpec filters
  F070LP: 0.7,
  F100LP: 1.0,
  F170LP: 1.7,
  F290LP: 2.9,
  CLEAR: 0,

  // NIRISS filters
  F090W_NIRISS: 0.901,
  F115W_NIRISS: 1.154,
  F140M_NIRISS: 1.404,
  F150W_NIRISS: 1.501,
  F158M: 1.582,
  F200W_NIRISS: 1.989,
  F277W_NIRISS: 2.762,
  F356W_NIRISS: 3.568,
  F380M: 3.828,
  F430M_NIRISS: 4.28,
  F444W_NIRISS: 4.421,
  F480M_NIRISS: 4.817,
};

/**
 * Parse wavelength from a filter name string
 * Handles formats like "F444W", "NIRCAM/F444W", "F444W-CLEAR", etc.
 *
 * @param filterName - The filter name to parse
 * @returns Wavelength in micrometers, or null if unknown
 */
export function parseWavelength(filterName: string | null | undefined): number | null {
  if (!filterName) return null;

  // Normalize the filter name
  const normalized = filterName.toUpperCase().trim();

  // Try direct lookup first
  if (FILTER_WAVELENGTHS[normalized] !== undefined) {
    return FILTER_WAVELENGTHS[normalized];
  }

  // Try to extract filter pattern from longer strings
  // Match patterns like F###W, F###M, F###N, F###LP
  const filterPattern = /F(\d{2,4})[WMNLP]/;
  const match = normalized.match(filterPattern);

  if (match) {
    const filterCode = match[0];
    if (FILTER_WAVELENGTHS[filterCode] !== undefined) {
      return FILTER_WAVELENGTHS[filterCode];
    }

    // If not in lookup table, try to parse the number as wavelength
    // F444W means ~4.44 micrometers, F200W means ~2.0 micrometers
    const numStr = match[1];
    const num = parseInt(numStr, 10);
    if (!isNaN(num)) {
      // 3-digit filters: divide by 100 (F444 -> 4.44)
      // 4-digit filters: divide by 100 (F1280 -> 12.8)
      return num / 100;
    }
  }

  return null;
}

/**
 * Get wavelength from a JwstDataModel
 * Checks multiple metadata fields for filter information
 *
 * @param data - The data model to extract wavelength from
 * @returns Wavelength in micrometers, or null if unknown
 */
export function getWavelengthFromData(data: JwstDataModel): number | null {
  // Check imageInfo.filter first
  if (data.imageInfo?.filter) {
    const wavelength = parseWavelength(data.imageInfo.filter);
    if (wavelength !== null) return wavelength;
  }

  // Check imageInfo.wavelength directly (parse if string)
  if (data.imageInfo?.wavelength) {
    const parsed = parseFloat(data.imageInfo.wavelength);
    if (!isNaN(parsed)) return parsed;
    // Try to parse as filter name
    const wavelength = parseWavelength(data.imageInfo.wavelength);
    if (wavelength !== null) return wavelength;
  }

  // Check sensorInfo for wavelength
  if (data.sensorInfo?.wavelength) {
    const parsed = parseFloat(data.sensorInfo.wavelength);
    if (!isNaN(parsed)) return parsed;
  }

  // Try to extract from filename as last resort
  // e.g., "jw02731-o001_t001_nircam_clear-f444w_i2d.fits"
  const filename = data.fileName?.toUpperCase() || '';
  const filenameMatch = filename.match(/F(\d{2,4})[WMNLP]/);
  if (filenameMatch) {
    return parseWavelength(filenameMatch[0]);
  }

  return null;
}

/**
 * Format wavelength for display
 *
 * @param wavelength - Wavelength in micrometers
 * @returns Formatted string like "4.44 μm"
 */
export function formatWavelength(wavelength: number | null): string {
  if (wavelength === null) return 'Unknown';
  return `${wavelength.toFixed(2)} μm`;
}

/**
 * Get a descriptive label for a filter
 *
 * @param data - The data model
 * @returns String like "F444W (4.44 μm)" or just the filter name
 */
export function getFilterLabel(data: JwstDataModel): string {
  const filter = data.imageInfo?.filter;
  const wavelength = getWavelengthFromData(data);

  if (filter && wavelength !== null) {
    return `${filter} (${formatWavelength(wavelength)})`;
  } else if (filter) {
    return filter;
  } else if (wavelength !== null) {
    return formatWavelength(wavelength);
  }

  return 'Unknown filter';
}

/**
 * Convert a JWST filter wavelength (in micrometers) to a hue angle (0-270).
 * Port of backend color_mapping.py:wavelength_to_hue().
 * Shorter wavelengths (blue, ~0.6 um) -> hue 270
 * Longer wavelengths (red, ~28 um) -> hue 0
 *
 * @param wavelengthUm - Wavelength in micrometers
 * @returns Hue angle 0-270
 */
export function wavelengthToHue(wavelengthUm: number): number {
  const minWl = 0.6;
  const maxWl = 28.0;
  const clamped = Math.max(minWl, Math.min(maxWl, wavelengthUm));

  // Log-scale mapping from wavelength to 0-1
  const logMin = Math.log(minWl);
  const logMax = Math.log(maxWl);
  const t = (Math.log(clamped) - logMin) / (logMax - logMin);

  // Map t=0 (shortest) to hue 270 (blue/violet), t=1 (longest) to hue 0 (red)
  return 270 * (1 - t);
}

/**
 * Convert HSV hue to hex color string (full saturation and value).
 *
 * @param hue - Hue angle 0-360
 * @returns Hex color string like "#ff0000"
 */
export function hueToHex(hue: number): string {
  const h = ((hue % 360) + 360) % 360;
  const s = 1;
  const v = 1;

  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let r = 0,
    g = 0,
    b = 0;

  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  const toHex = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, '0');

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Convert hex color string to RGB floats [0-1].
 *
 * @param hex - Hex color string like "#ff0000" or "ff0000"
 * @returns [r, g, b] each 0-1
 */
export function hexToRgb(hex: string): [number, number, number] {
  let clean = hex.replace('#', '');
  // Expand 3-char hex to 6-char (e.g. "fff" -> "ffffff")
  if (clean.length === 3) {
    clean = clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2];
  }
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  return [r, g, b];
}

/**
 * Approximate hue (0-360) from RGB floats [0-1].
 * Used to keep the hue gap-finder working after color picker sets RGB.
 *
 * @param r - Red 0-1
 * @param g - Green 0-1
 * @param b - Blue 0-1
 * @returns Hue angle 0-360
 */
export function rgbToHue(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;

  let hue: number;
  if (max === r) {
    hue = ((g - b) / delta) % 6;
  } else if (max === g) {
    hue = (b - r) / delta + 2;
  } else {
    hue = (r - g) / delta + 4;
  }
  hue = Math.round(hue * 60);
  return hue < 0 ? hue + 360 : hue;
}

/**
 * Convert RGB floats [0-1] to hex color string.
 *
 * @param r - Red 0-1
 * @param g - Green 0-1
 * @param b - Blue 0-1
 * @returns Hex color string like "#ff0000"
 */
export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) =>
    Math.round(Math.max(0, Math.min(1, n)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Get the display hex color for an NChannelState's color spec.
 *
 * @param color - ChannelColorSpec with hue or rgb
 * @returns Hex color string
 */
export function channelColorToHex(color: { hue?: number; rgb?: [number, number, number] }): string {
  if (color.rgb) {
    return rgbToHex(color.rgb[0], color.rgb[1], color.rgb[2]);
  }
  return hueToHex(color.hue ?? 0);
}

/**
 * Auto-assign N channels from images, grouping by filter.
 * Each unique filter becomes one channel with an auto-assigned hue based on wavelength.
 *
 * @param images - Array of JwstDataModel objects
 * @returns Array of NChannelState, one per unique filter
 */
export function autoAssignNChannels(images: JwstDataModel[]): NChannelState[] {
  // Group images by filter name
  const filterGroups = new Map<string, { dataIds: string[]; wavelength: number | null }>();

  for (const img of images) {
    const filter = img.imageInfo?.filter || 'Unknown';
    const wavelength = getWavelengthFromData(img);
    const key = filter.toUpperCase();

    const existing = filterGroups.get(key);
    if (existing) {
      existing.dataIds.push(img.id);
    } else {
      filterGroups.set(key, { dataIds: [img.id], wavelength });
    }
  }

  // Sort groups by wavelength (ascending) for consistent ordering
  const sorted = [...filterGroups.entries()].sort((a, b) => {
    const wlA = a[1].wavelength ?? Infinity;
    const wlB = b[1].wavelength ?? Infinity;
    return wlA - wlB;
  });

  // Create channels — unknown wavelengths get evenly spaced hues
  const unknownCount = sorted.filter(([, g]) => g.wavelength === null).length;
  let unknownIdx = 0;

  return sorted.map(([filterName, group]) => {
    let hue: number;
    if (group.wavelength !== null) {
      hue = wavelengthToHue(group.wavelength);
    } else {
      // Space unknown filters evenly around the hue circle
      hue = unknownCount > 1 ? (360 / unknownCount) * unknownIdx : 0;
      unknownIdx++;
    }

    const channel = createDefaultNChannel(hue);
    channel.dataIds = group.dataIds;
    channel.label = filterName;
    channel.wavelengthUm = group.wavelength ?? undefined;
    channel.params = { ...DEFAULT_CHANNEL_PARAMS };

    return channel;
  });
}

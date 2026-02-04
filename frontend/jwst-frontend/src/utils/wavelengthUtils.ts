/**
 * Utilities for parsing JWST filter wavelengths and auto-sorting for RGB composites
 */

import { JwstDataModel } from '../types/JwstDataTypes';
import { ChannelAssignment } from '../types/CompositeTypes';

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
 * Sort images by wavelength for RGB composite
 * Returns assignment with:
 * - Blue = shortest wavelength
 * - Green = middle wavelength
 * - Red = longest wavelength
 *
 * @param images - Array of exactly 3 JwstDataModel objects
 * @returns ChannelAssignment with dataIds assigned to channels
 */
export function autoSortByWavelength(images: JwstDataModel[]): ChannelAssignment {
  if (images.length !== 3) {
    throw new Error('autoSortByWavelength requires exactly 3 images');
  }

  // Get wavelengths for each image
  const imagesWithWavelength = images.map((img) => ({
    dataId: img.id,
    wavelength: getWavelengthFromData(img),
  }));

  // Check if we have wavelengths for all images
  const allHaveWavelengths = imagesWithWavelength.every((i) => i.wavelength !== null);

  if (!allHaveWavelengths) {
    // If we can't determine wavelengths, use original order
    return {
      red: images[0].id,
      green: images[1].id,
      blue: images[2].id,
    };
  }

  // Sort by wavelength (ascending)
  const sorted = [...imagesWithWavelength].sort(
    (a, b) => (a.wavelength ?? 0) - (b.wavelength ?? 0)
  );

  return {
    blue: sorted[0].dataId, // Shortest wavelength
    green: sorted[1].dataId, // Middle wavelength
    red: sorted[2].dataId, // Longest wavelength
  };
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

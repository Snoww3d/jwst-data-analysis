/**
 * Utility functions for 3D data cube navigation
 */

import { CubeAxis3Info } from '../types/JwstDataTypes';

/**
 * Convert a slice index to its corresponding physical value (e.g., wavelength)
 * using the WCS parameters from axis 3.
 *
 * @param sliceIndex - The 0-based slice index
 * @param axis3 - The WCS parameters for axis 3
 * @returns The physical value at this slice
 */
export function sliceToPhysicalValue(sliceIndex: number, axis3: CubeAxis3Info): number {
  // FITS WCS formula: value = CRVAL3 + CDELT3 * (pixel - CRPIX3)
  // Note: FITS uses 1-based indexing, so we add 1 to convert from 0-based
  const fitsPixel = sliceIndex + 1;
  return axis3.crval3 + axis3.cdelt3 * (fitsPixel - axis3.crpix3);
}

/**
 * Format a wavelength value with appropriate precision and unit.
 *
 * @param value - The wavelength value
 * @param unit - The unit string (e.g., "um", "nm", "A")
 * @returns Formatted string (e.g., "2.45 μm")
 */
export function formatWavelength(value: number, unit: string): string {
  // Determine precision based on the magnitude of the value
  let precision: number;
  const absValue = Math.abs(value);

  if (absValue >= 100) {
    precision = 1;
  } else if (absValue >= 10) {
    precision = 2;
  } else if (absValue >= 1) {
    precision = 3;
  } else if (absValue >= 0.1) {
    precision = 4;
  } else {
    precision = 5;
  }

  const formattedValue = value.toFixed(precision);

  // Convert common unit abbreviations to proper symbols
  const unitDisplay = getUnitDisplay(unit);

  return `${formattedValue} ${unitDisplay}`;
}

/**
 * Convert unit abbreviations to proper display symbols.
 *
 * @param unit - The unit string from FITS header
 * @returns Display-friendly unit string
 */
function getUnitDisplay(unit: string): string {
  const unitMap: Record<string, string> = {
    um: 'μm',
    micron: 'μm',
    microns: 'μm',
    nm: 'nm',
    angstrom: 'Å',
    angstroms: 'Å',
    a: 'Å',
    hz: 'Hz',
    hertz: 'Hz',
    khz: 'kHz',
    mhz: 'MHz',
    ghz: 'GHz',
    m: 'm',
    s: 's',
    sec: 's',
  };

  const lowerUnit = unit.toLowerCase();
  return unitMap[lowerUnit] || unit;
}

/**
 * Get a human-readable label for the axis based on CTYPE3.
 *
 * @param ctype3 - The CTYPE3 value from FITS header
 * @returns Human-readable axis label
 */
export function getAxisLabel(ctype3: string): string {
  if (!ctype3) return 'Frame';

  const ctypeUpper = ctype3.toUpperCase();

  if (ctypeUpper.includes('WAVE') || ctypeUpper.includes('LAMB')) {
    return 'Wavelength';
  }
  if (ctypeUpper.includes('FREQ')) {
    return 'Frequency';
  }
  if (ctypeUpper.includes('VELO')) {
    return 'Velocity';
  }
  if (ctypeUpper.includes('TIME') || ctypeUpper.includes('MJD')) {
    return 'Time';
  }

  return ctype3 || 'Frame';
}

/**
 * Format the slice display string for the navigator.
 *
 * @param sliceIndex - Current 0-based slice index
 * @param nSlices - Total number of slices
 * @param axis3 - Optional WCS parameters for physical value display
 * @param sliceUnit - Unit string for the physical value
 * @param sliceLabel - Label for the axis type
 * @returns Formatted display string (e.g., "Slice 42/100 | 2.45 μm")
 */
export function formatSliceDisplay(
  sliceIndex: number,
  nSlices: number,
  axis3: CubeAxis3Info | null,
  sliceUnit: string,
  sliceLabel: string
): string {
  const sliceNum = sliceIndex + 1; // Display as 1-based
  let display = `${sliceLabel} ${sliceNum}/${nSlices}`;

  if (axis3 && sliceUnit) {
    const physicalValue = sliceToPhysicalValue(sliceIndex, axis3);
    const formattedValue = formatWavelength(physicalValue, sliceUnit);
    display += ` | ${formattedValue}`;
  }

  return display;
}

/**
 * Calculate the default playback speed in frames per second.
 * For very large cubes, default to slower playback.
 *
 * @param nSlices - Total number of slices
 * @returns Recommended FPS
 */
export function getDefaultPlaybackSpeed(nSlices: number): number {
  if (nSlices > 500) return 2;
  if (nSlices > 100) return 5;
  return 10;
}

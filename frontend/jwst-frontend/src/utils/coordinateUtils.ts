/**
 * Coordinate utilities for FITS viewer hover display
 *
 * Provides functions for:
 * - Decoding base64-encoded pixel data
 * - Looking up pixel values from array
 * - Converting pixel coordinates to WCS (RA/Dec)
 * - Formatting coordinates and values for display
 */

import { WCSParams, CursorInfo } from '../types/JwstDataTypes';

/**
 * Decode base64-encoded Float32Array pixel data
 * @param base64 - Base64-encoded binary float32 data
 * @returns Float32Array of pixel values
 */
export function decodePixelData(base64: string): Float32Array {
  // Decode base64 to binary using browser's atob
  const binaryString = window.atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Create Float32Array from binary data
  return new Float32Array(bytes.buffer);
}

/**
 * Get pixel value from the downsampled array
 * @param pixels - Float32Array of pixel values (row-major order)
 * @param width - Width of the pixel array
 * @param height - Height of the pixel array
 * @param x - X coordinate (0-indexed from left)
 * @param y - Y coordinate (0-indexed from bottom, FITS convention)
 * @returns Pixel value or NaN if out of bounds
 */
export function getPixelValue(
  pixels: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number
): number {
  // Bounds check
  if (x < 0 || x >= width || y < 0 || y >= height) {
    return NaN;
  }

  // Convert FITS convention (origin bottom-left) to array index (row-major, origin top-left)
  // FITS Y=0 is bottom row, which is array row (height-1)
  const arrayY = height - 1 - Math.floor(y);
  const arrayX = Math.floor(x);

  // Clamp to valid range
  const clampedY = Math.max(0, Math.min(height - 1, arrayY));
  const clampedX = Math.max(0, Math.min(width - 1, arrayX));

  const index = clampedY * width + clampedX;
  return pixels[index];
}

/**
 * Convert pixel coordinates to WCS sky coordinates (RA/Dec)
 * Uses a simplified TAN (gnomonic) projection
 *
 * @param x - Pixel X coordinate (1-indexed, FITS convention)
 * @param y - Pixel Y coordinate (1-indexed, FITS convention)
 * @param wcs - WCS parameters from FITS header
 * @returns Object with ra and dec in degrees, or null if invalid
 */
export function pixelToWCS(
  x: number,
  y: number,
  wcs: WCSParams
): { ra: number; dec: number } | null {
  // Check for valid WCS
  if (!wcs || (wcs.cd1_1 === 0 && wcs.cd2_2 === 0 && wcs.cdelt1 === 0)) {
    return null;
  }

  // Convert to 0-indexed relative to reference pixel
  const dx = x - wcs.crpix1;
  const dy = y - wcs.crpix2;

  // Apply CD matrix (or CDELT if CD not available)
  let xi: number, eta: number;
  if (wcs.cd1_1 !== 0 || wcs.cd1_2 !== 0 || wcs.cd2_1 !== 0 || wcs.cd2_2 !== 0) {
    // Use CD matrix
    xi = wcs.cd1_1 * dx + wcs.cd1_2 * dy;
    eta = wcs.cd2_1 * dx + wcs.cd2_2 * dy;
  } else {
    // Fallback to CDELT
    xi = wcs.cdelt1 * dx;
    eta = wcs.cdelt2 * dy;
  }

  // For TAN (gnomonic) projection, convert intermediate world coordinates to RA/Dec
  // This is a simplified version - full implementation would handle all projection types
  const crvalRa = wcs.crval1 * (Math.PI / 180);
  const crvalDec = wcs.crval2 * (Math.PI / 180);

  // Convert degrees to radians
  const xiRad = xi * (Math.PI / 180);
  const etaRad = eta * (Math.PI / 180);

  // TAN projection inverse
  const cosDec0 = Math.cos(crvalDec);
  const sinDec0 = Math.sin(crvalDec);

  const rho = Math.sqrt(xiRad * xiRad + etaRad * etaRad);

  let dec: number;
  let ra: number;

  if (rho === 0) {
    ra = wcs.crval1;
    dec = wcs.crval2;
  } else {
    const c = Math.atan(rho);
    const cosC = Math.cos(c);
    const sinC = Math.sin(c);

    dec = Math.asin(cosC * sinDec0 + (etaRad * sinC * cosDec0) / rho);
    ra = crvalRa + Math.atan2(xiRad * sinC, rho * cosDec0 * cosC - etaRad * sinDec0 * sinC);

    // Convert back to degrees
    ra = ra * (180 / Math.PI);
    dec = dec * (180 / Math.PI);
  }

  // Normalize RA to [0, 360)
  while (ra < 0) ra += 360;
  while (ra >= 360) ra -= 360;

  return { ra, dec };
}

/**
 * Format RA in sexagesimal (hours, minutes, seconds)
 * @param ra - Right Ascension in degrees
 * @returns Formatted string like "12h 34m 56.78s"
 */
export function formatRA(ra: number): string {
  // Convert degrees to hours (24h = 360 deg)
  const hours = ra / 15;
  const h = Math.floor(hours);
  const m = Math.floor((hours - h) * 60);
  const s = ((hours - h) * 60 - m) * 60;

  return `${h.toString().padStart(2, '0')}h ${m.toString().padStart(2, '0')}m ${s.toFixed(2).padStart(5, '0')}s`;
}

/**
 * Format Dec in sexagesimal (degrees, arcminutes, arcseconds)
 * @param dec - Declination in degrees
 * @returns Formatted string like "+12d 34' 56.78""
 */
export function formatDec(dec: number): string {
  const sign = dec >= 0 ? '+' : '-';
  const absDec = Math.abs(dec);
  const d = Math.floor(absDec);
  const m = Math.floor((absDec - d) * 60);
  const s = ((absDec - d) * 60 - m) * 60;

  return `${sign}${d.toString().padStart(2, '0')}d ${m.toString().padStart(2, '0')}' ${s.toFixed(1).padStart(4, '0')}"`;
}

/**
 * Format pixel value in scientific notation with units
 * @param value - Pixel value
 * @param units - Unit string from FITS header (e.g., "MJy/sr")
 * @returns Formatted string like "1.234e+03 MJy/sr"
 */
export function formatPixelValue(value: number, units?: string): string {
  if (isNaN(value) || !isFinite(value)) {
    return 'N/A';
  }

  // Use scientific notation for very large or very small values
  const absValue = Math.abs(value);
  let formatted: string;

  if (absValue === 0) {
    formatted = '0.000';
  } else if (absValue >= 1e4 || absValue < 1e-2) {
    // Scientific notation
    formatted = value.toExponential(3);
  } else {
    // Fixed decimal
    formatted = value.toFixed(3);
  }

  return units ? `${formatted} ${units}` : formatted;
}

/**
 * Calculate cursor info from mouse position
 * @param mouseX - Mouse X position relative to image element
 * @param mouseY - Mouse Y position relative to image element
 * @param imageWidth - Displayed image width
 * @param imageHeight - Displayed image height
 * @param scale - Current zoom scale
 * @param offsetX - Current pan offset X
 * @param offsetY - Current pan offset Y
 * @param previewWidth - Width of the preview pixel array
 * @param previewHeight - Height of the preview pixel array
 * @param scaleFactor - Ratio of original to preview dimensions
 * @param pixels - Float32Array of pixel values
 * @param wcs - WCS parameters (optional)
 * @returns CursorInfo or null if cursor is outside image
 */
export function calculateCursorInfo(
  mouseX: number,
  mouseY: number,
  _imageWidth: number, // Passed for potential future use, currently using preview dimensions
  _imageHeight: number, // Passed for potential future use, currently using preview dimensions
  scale: number,
  offsetX: number,
  offsetY: number,
  previewWidth: number,
  previewHeight: number,
  scaleFactor: number,
  pixels: Float32Array,
  wcs: WCSParams | null
): CursorInfo | null {
  // The image is centered and transformed by scale and offset with transform-origin at center
  // Mouse coordinates come from getBoundingClientRect which gives screen coordinates
  // We need to reverse the transform to get image pixel coordinates

  // Note: imageWidth/imageHeight are passed but not directly used since we use
  // previewWidth/previewHeight for the coordinate math. The image element may
  // display at a different size due to CSS but the transform origin is based
  // on the preview dimensions.

  // Reverse the translation (offset)
  const translatedX = mouseX - offsetX;
  const translatedY = mouseY - offsetY;

  // Then reverse the scale around the center of the image natural size
  // The transform-origin is at center of the element
  const centerX = previewWidth / 2;
  const centerY = previewHeight / 2;

  const imageX = (translatedX - centerX) / scale + centerX;
  const imageY = (translatedY - centerY) / scale + centerY;

  // Bounds check for preview image
  if (imageX < 0 || imageX >= previewWidth || imageY < 0 || imageY >= previewHeight) {
    return null;
  }

  // Convert from image Y (origin top-left) to FITS Y (origin bottom-left)
  // In the image, Y=0 is top; in FITS, Y=0 is bottom
  const previewX = imageX;
  const previewY = previewHeight - 1 - imageY;

  // Calculate original FITS coordinates (1-indexed)
  const fitsX = Math.round(previewX * scaleFactor) + 1;
  const fitsY = Math.round(previewY * scaleFactor) + 1;

  // Look up pixel value
  const value = getPixelValue(pixels, previewWidth, previewHeight, previewX, previewY);

  // Calculate WCS coordinates if available
  let ra: number | undefined;
  let dec: number | undefined;

  if (wcs) {
    const skyCoords = pixelToWCS(fitsX, fitsY, wcs);
    if (skyCoords) {
      ra = skyCoords.ra;
      dec = skyCoords.dec;
    }
  }

  return {
    previewX: Math.round(previewX),
    previewY: Math.round(previewY),
    fitsX,
    fitsY,
    value,
    ra,
    dec,
  };
}

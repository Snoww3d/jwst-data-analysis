/**
 * WCS grid overlay computation utilities.
 *
 * Computes RA/Dec coordinate grid lines in FITS pixel space for overlay display.
 * Uses the inverse TAN (gnomonic) projection to convert world coordinates to pixels.
 */

import { WCSParams } from '../types/JwstDataTypes';
import { pixelToWCS, formatRA, formatDec } from './coordinateUtils';

// --- Types ---

export interface WcsGridPoint {
  x: number;
  y: number;
}

export interface WcsGridLine {
  /** RA or Dec value in degrees */
  value: number;
  /** Polyline points in FITS pixel coordinates (1-indexed) */
  points: WcsGridPoint[];
}

export interface WcsGridLabel {
  /** RA or Dec value in degrees */
  value: number;
  /** FITS pixel X for label anchor */
  x: number;
  /** FITS pixel Y for label anchor */
  y: number;
  /** Which image edge the label sits near */
  edge: 'top' | 'bottom' | 'left' | 'right';
  /** Pre-formatted HMS or DMS string */
  formattedValue: string;
}

export interface WcsGridData {
  raLines: WcsGridLine[];
  decLines: WcsGridLine[];
  raLabels: WcsGridLabel[];
  decLabels: WcsGridLabel[];
  spacingDeg: number;
}

// --- Inverse TAN projection ---

/**
 * Convert WCS sky coordinates (RA/Dec) to FITS pixel coordinates.
 * Inverse of pixelToWCS() in coordinateUtils.ts.
 *
 * @param ra - Right Ascension in degrees
 * @param dec - Declination in degrees
 * @param wcs - WCS parameters from FITS header
 * @returns FITS pixel coordinates (1-indexed) or null if behind tangent plane
 */
export function wcsToPixel(ra: number, dec: number, wcs: WCSParams): WcsGridPoint | null {
  if (!wcs || (wcs.cd1_1 === 0 && wcs.cd2_2 === 0 && wcs.cdelt1 === 0)) {
    return null;
  }

  // Only support TAN projection
  if (wcs.ctype1 && !wcs.ctype1.includes('TAN')) return null;
  if (wcs.ctype2 && !wcs.ctype2.includes('TAN')) return null;

  const DEG2RAD = Math.PI / 180;
  const RAD2DEG = 180 / Math.PI;

  const raRad = ra * DEG2RAD;
  const decRad = dec * DEG2RAD;
  const ra0Rad = wcs.crval1 * DEG2RAD;
  const dec0Rad = wcs.crval2 * DEG2RAD;

  const cosDec = Math.cos(decRad);
  const sinDec = Math.sin(decRad);
  const cosDec0 = Math.cos(dec0Rad);
  const sinDec0 = Math.sin(dec0Rad);
  const cosRaDiff = Math.cos(raRad - ra0Rad);
  const sinRaDiff = Math.sin(raRad - ra0Rad);

  // Denominator — if <= 0, point is behind the tangent plane
  const denom = sinDec * sinDec0 + cosDec * cosDec0 * cosRaDiff;
  if (denom <= 1e-10) return null;

  // TAN projection: sky → intermediate world coordinates (degrees)
  const xi = ((cosDec * sinRaDiff) / denom) * RAD2DEG;
  const eta = ((sinDec * cosDec0 - cosDec * sinDec0 * cosRaDiff) / denom) * RAD2DEG;

  // Invert CD matrix (or CDELT) to get pixel offsets
  let dx: number, dy: number;

  if (wcs.cd1_1 !== 0 || wcs.cd1_2 !== 0 || wcs.cd2_1 !== 0 || wcs.cd2_2 !== 0) {
    const det = wcs.cd1_1 * wcs.cd2_2 - wcs.cd1_2 * wcs.cd2_1;
    if (Math.abs(det) < 1e-20) return null; // Singular matrix
    dx = (wcs.cd2_2 * xi - wcs.cd1_2 * eta) / det;
    dy = (-wcs.cd2_1 * xi + wcs.cd1_1 * eta) / det;
  } else {
    if (Math.abs(wcs.cdelt1) < 1e-20 || Math.abs(wcs.cdelt2) < 1e-20) return null;
    dx = xi / wcs.cdelt1;
    dy = eta / wcs.cdelt2;
  }

  // FITS pixel coordinates (1-indexed)
  return {
    x: dx + wcs.crpix1,
    y: dy + wcs.crpix2,
  };
}

// --- Grid spacing ---

/** "Nice" grid intervals in degrees, from fine to coarse */
const NICE_INTERVALS = [
  0.001, // 3.6"
  0.002, // 7.2"
  0.005, // 18"
  1 / 120, // 30" = 0.5'
  1 / 60, // 1'
  2 / 60, // 2'
  5 / 60, // 5'
  10 / 60, // 10'
  20 / 60, // 20'
  0.5, // 30'
  1, // 1 deg
  2,
  5,
  10,
  15,
  30,
  45,
];

/**
 * Choose a "nice" grid spacing for a given field-of-view.
 * Targets approximately 4-8 grid lines across the FOV.
 */
export function computeGridSpacing(fovDegrees: number): number {
  const targetLines = 6;

  let bestSpacing = NICE_INTERVALS[NICE_INTERVALS.length - 1];
  let bestDiff = Infinity;

  for (const interval of NICE_INTERVALS) {
    const nLines = fovDegrees / interval;
    if (nLines < 2) continue;
    if (nLines > 15) continue;

    const diff = Math.abs(nLines - targetLines);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestSpacing = interval;
    }
  }

  return bestSpacing;
}

// --- Sky bounding box ---

interface SkyBounds {
  minRA: number;
  maxRA: number;
  minDec: number;
  maxDec: number;
  wrapsRA: boolean;
}

/**
 * Determine the sky coordinate bounding box for an image.
 * Samples boundary points and converts to RA/Dec.
 */
function computeSkyBounds(
  wcs: WCSParams,
  imageWidth: number,
  imageHeight: number,
  scaleFactor: number
): SkyBounds | null {
  // Sample points along image boundary (FITS 1-indexed coordinates)
  const w = imageWidth * scaleFactor;
  const h = imageHeight * scaleFactor;
  const samplePoints: Array<[number, number]> = [];

  // Corners
  samplePoints.push([1, 1], [w, 1], [1, h], [w, h]);
  // Edge midpoints
  samplePoints.push([w / 2, 1], [w / 2, h], [1, h / 2], [w, h / 2]);
  // Additional edge samples for better coverage
  const nEdgeSamples = 10;
  for (let i = 1; i < nEdgeSamples; i++) {
    const frac = i / nEdgeSamples;
    samplePoints.push([frac * w, 1]); // bottom edge
    samplePoints.push([frac * w, h]); // top edge
    samplePoints.push([1, frac * h]); // left edge
    samplePoints.push([w, frac * h]); // right edge
  }

  const raValues: number[] = [];
  const decValues: number[] = [];

  for (const [px, py] of samplePoints) {
    const sky = pixelToWCS(px, py, wcs);
    if (sky) {
      raValues.push(sky.ra);
      decValues.push(sky.dec);
    }
  }

  if (raValues.length < 4) return null;

  const minDec = Math.min(...decValues);
  const maxDec = Math.max(...decValues);

  // Detect RA wrapping around 0/360
  const sortedRA = [...raValues].sort((a, b) => a - b);
  let maxGap = 0;
  let gapStart = 0;
  for (let i = 1; i < sortedRA.length; i++) {
    const gap = sortedRA[i] - sortedRA[i - 1];
    if (gap > maxGap) {
      maxGap = gap;
      gapStart = i;
    }
  }
  // Also check wraparound gap
  const wrapGap = 360 - sortedRA[sortedRA.length - 1] + sortedRA[0];
  const wrapsRA = wrapGap < maxGap;

  let minRA: number, maxRA: number;
  if (wrapsRA) {
    // Image straddles 0/360 — the largest gap in sorted RA is the "empty" region
    minRA = sortedRA[gapStart]; // RA just after the gap
    maxRA = sortedRA[gapStart - 1] + 360; // RA just before the gap, shifted up
  } else {
    minRA = sortedRA[0];
    maxRA = sortedRA[sortedRA.length - 1];
  }

  return { minRA, maxRA, minDec, maxDec, wrapsRA };
}

// --- Grid line tracing ---

const LINE_SAMPLES = 60;

/**
 * Trace a constant-Dec line across the image in pixel coordinates.
 */
function traceDecLine(
  dec: number,
  minRA: number,
  maxRA: number,
  wcs: WCSParams,
  imageWidth: number,
  imageHeight: number,
  scaleFactor: number
): WcsGridPoint[] {
  const points: WcsGridPoint[] = [];
  const w = imageWidth * scaleFactor;
  const h = imageHeight * scaleFactor;
  const margin = Math.max(w, h) * 0.05;

  for (let i = 0; i <= LINE_SAMPLES; i++) {
    let ra = minRA + (i / LINE_SAMPLES) * (maxRA - minRA);
    // Normalize RA to [0, 360)
    while (ra < 0) ra += 360;
    while (ra >= 360) ra -= 360;

    const pixel = wcsToPixel(ra, dec, wcs);
    if (!pixel) continue;

    // Include points slightly outside image for smooth edge clipping
    if (
      pixel.x >= 1 - margin &&
      pixel.x <= w + margin &&
      pixel.y >= 1 - margin &&
      pixel.y <= h + margin
    ) {
      points.push(pixel);
    }
  }

  return points;
}

/**
 * Trace a constant-RA line across the image in pixel coordinates.
 */
function traceRaLine(
  ra: number,
  minDec: number,
  maxDec: number,
  wcs: WCSParams,
  imageWidth: number,
  imageHeight: number,
  scaleFactor: number
): WcsGridPoint[] {
  const points: WcsGridPoint[] = [];
  const w = imageWidth * scaleFactor;
  const h = imageHeight * scaleFactor;
  const margin = Math.max(w, h) * 0.05;

  // Normalize RA
  let normalizedRA = ra;
  while (normalizedRA < 0) normalizedRA += 360;
  while (normalizedRA >= 360) normalizedRA -= 360;

  for (let i = 0; i <= LINE_SAMPLES; i++) {
    const dec = minDec + (i / LINE_SAMPLES) * (maxDec - minDec);

    const pixel = wcsToPixel(normalizedRA, dec, wcs);
    if (!pixel) continue;

    if (
      pixel.x >= 1 - margin &&
      pixel.x <= w + margin &&
      pixel.y >= 1 - margin &&
      pixel.y <= h + margin
    ) {
      points.push(pixel);
    }
  }

  return points;
}

// --- Label extraction ---

/**
 * Find the point in a polyline closest to a given image edge.
 * Returns the point and its distance to the edge.
 */
function findEdgePoint(
  points: WcsGridPoint[],
  edge: 'top' | 'bottom' | 'left' | 'right',
  imageWidth: number,
  imageHeight: number,
  scaleFactor: number
): WcsGridPoint | null {
  if (points.length === 0) return null;

  const w = imageWidth * scaleFactor;
  const h = imageHeight * scaleFactor;

  let best: WcsGridPoint | null = null;
  let bestDist = Infinity;

  for (const p of points) {
    let dist: number;
    switch (edge) {
      case 'left':
        dist = Math.abs(p.x - 1);
        break;
      case 'right':
        dist = Math.abs(p.x - w);
        break;
      case 'bottom':
        dist = Math.abs(p.y - 1);
        break;
      case 'top':
        dist = Math.abs(p.y - h);
        break;
    }

    if (dist < bestDist) {
      bestDist = dist;
      best = p;
    }
  }

  return best;
}

/**
 * Filter labels to avoid overlap. Removes labels that are too close together.
 */
function deduplicateLabels(labels: WcsGridLabel[], minDistPx: number): WcsGridLabel[] {
  const result: WcsGridLabel[] = [];

  for (const label of labels) {
    const tooClose = result.some((existing) => {
      if (existing.edge !== label.edge) return false;
      const dx = existing.x - label.x;
      const dy = existing.y - label.y;
      return Math.sqrt(dx * dx + dy * dy) < minDistPx;
    });

    if (!tooClose) {
      result.push(label);
    }
  }

  return result;
}

// --- Main computation ---

/**
 * Compute WCS grid lines and labels for display over a FITS image.
 *
 * @param wcs - WCS parameters from FITS header
 * @param imageWidth - Preview image width (pixels)
 * @param imageHeight - Preview image height (pixels)
 * @param scaleFactor - Ratio of original to preview dimensions
 * @returns Grid data with RA/Dec lines and labels, or null if WCS is invalid
 */
export function computeWcsGridLines(
  wcs: WCSParams,
  imageWidth: number,
  imageHeight: number,
  scaleFactor: number
): WcsGridData | null {
  if (!wcs || imageWidth <= 0 || imageHeight <= 0) return null;

  // 1. Compute sky bounding box
  const bounds = computeSkyBounds(wcs, imageWidth, imageHeight, scaleFactor);
  if (!bounds) return null;

  const { minRA, maxRA, minDec, maxDec } = bounds;

  // 2. Compute FOV and grid spacing
  const meanDec = (minDec + maxDec) / 2;
  const cosMeanDec = Math.cos(meanDec * (Math.PI / 180));
  const fovRA = (maxRA - minRA) * (cosMeanDec > 0.01 ? cosMeanDec : 0.01);
  const fovDec = maxDec - minDec;
  const fov = Math.max(fovRA, fovDec);

  if (fov <= 0 || fov > 180) return null;

  const spacing = computeGridSpacing(fov);

  // 3. Generate constant-Dec lines
  const decLines: WcsGridLine[] = [];
  const decLabels: WcsGridLabel[] = [];

  const decStart = Math.floor(minDec / spacing) * spacing;
  const decEnd = Math.ceil(maxDec / spacing) * spacing;

  for (let dec = decStart; dec <= decEnd; dec += spacing) {
    if (dec < -90 || dec > 90) continue;

    const points = traceDecLine(dec, minRA, maxRA, wcs, imageWidth, imageHeight, scaleFactor);
    if (points.length < 2) continue;

    decLines.push({ value: dec, points });

    // Label on left edge
    const leftPt = findEdgePoint(points, 'left', imageWidth, imageHeight, scaleFactor);
    if (leftPt) {
      decLabels.push({
        value: dec,
        x: leftPt.x,
        y: leftPt.y,
        edge: 'left',
        formattedValue: formatDec(dec),
      });
    }
  }

  // 4. Generate constant-RA lines
  const raLines: WcsGridLine[] = [];
  const raLabels: WcsGridLabel[] = [];

  const raStart = Math.floor(minRA / spacing) * spacing;
  const raEnd = Math.ceil(maxRA / spacing) * spacing;

  for (let ra = raStart; ra <= raEnd; ra += spacing) {
    // Normalize RA for display
    let displayRA = ra;
    while (displayRA < 0) displayRA += 360;
    while (displayRA >= 360) displayRA -= 360;

    const points = traceRaLine(
      displayRA,
      minDec - spacing * 0.5,
      maxDec + spacing * 0.5,
      wcs,
      imageWidth,
      imageHeight,
      scaleFactor
    );
    if (points.length < 2) continue;

    raLines.push({ value: displayRA, points });

    // Label on bottom edge
    const bottomPt = findEdgePoint(points, 'bottom', imageWidth, imageHeight, scaleFactor);
    if (bottomPt) {
      raLabels.push({
        value: displayRA,
        x: bottomPt.x,
        y: bottomPt.y,
        edge: 'bottom',
        formattedValue: formatRA(displayRA),
      });
    }
  }

  // 5. Deduplicate labels to avoid overlap
  // Use spacing-relative distance — roughly half a grid cell in pixels
  const samplePixel1 = wcsToPixel((minRA + maxRA) / 2, (minDec + maxDec) / 2, wcs);
  const samplePixel2 = wcsToPixel((minRA + maxRA) / 2 + spacing, (minDec + maxDec) / 2, wcs);
  let minLabelDist = 40; // Default minimum distance in FITS pixels
  if (samplePixel1 && samplePixel2) {
    const cellSizePx = Math.sqrt(
      (samplePixel2.x - samplePixel1.x) ** 2 + (samplePixel2.y - samplePixel1.y) ** 2
    );
    minLabelDist = Math.max(40, cellSizePx * 0.4);
  }

  return {
    raLines,
    decLines,
    raLabels: deduplicateLabels(raLabels, minLabelDist),
    decLabels: deduplicateLabels(decLabels, minLabelDist),
    spacingDeg: spacing,
  };
}

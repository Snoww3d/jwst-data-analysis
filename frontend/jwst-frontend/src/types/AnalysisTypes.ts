/**
 * Types for image analysis - region selection and statistics.
 */

export type RegionType = 'rectangle' | 'ellipse';

export interface RectangleRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EllipseRegion {
  centerX: number;
  centerY: number;
  radiusX: number;
  radiusY: number;
}

export interface RegionStatisticsRequest {
  dataId: string;
  regionType: RegionType;
  rectangle?: RectangleRegion;
  ellipse?: EllipseRegion;
  hduIndex?: number;
}

export interface RegionStatisticsResponse {
  mean: number;
  median: number;
  std: number;
  min: number;
  max: number;
  sum: number;
  pixelCount: number;
}

// === Source Detection Types ===

export type SmoothMethod = '' | 'gaussian' | 'median' | 'box' | 'astropy_gaussian' | 'astropy_box';

export interface SmoothingParams {
  method: SmoothMethod;
  sigma: number;
  size: number;
}

export interface SourceDetectionRequest {
  dataId: string;
  thresholdSigma?: number;
  fwhm?: number;
  method?: string;
  npixels?: number;
  deblend?: boolean;
}

export interface SourceInfo {
  id: number;
  xcentroid: number;
  ycentroid: number;
  flux: number | null;
  sharpness: number | null;
  roundness: number | null;
  fwhm: number | null;
  peak: number | null;
}

export interface SourceDetectionResponse {
  sources: SourceInfo[];
  nSources: number;
  method: string;
  thresholdSigma: number;
  thresholdValue: number;
  estimatedFwhm: number | null;
}

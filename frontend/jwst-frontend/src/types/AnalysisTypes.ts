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

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

// === Table Viewer Types ===

export interface TableColumnInfo {
  name: string;
  dtype: string;
  unit: string | null;
  format: string | null;
  isArray: boolean;
  arrayShape: number[] | null;
}

export interface TableHduInfo {
  index: number;
  name: string | null;
  hduType: string;
  nRows: number;
  nColumns: number;
  columns: TableColumnInfo[];
}

export interface TableInfoResponse {
  fileName: string;
  tableHdus: TableHduInfo[];
}

export interface TableDataResponse {
  hduIndex: number;
  hduName: string | null;
  totalRows: number;
  totalColumns: number;
  page: number;
  pageSize: number;
  columns: TableColumnInfo[];
  rows: Record<string, unknown>[];
  sortColumn: string | null;
  sortDirection: string | null;
}

// === Spectral Viewer Types ===

export interface SpectralColumnMeta {
  name: string;
  unit: string | null;
  nPoints: number;
}

export interface SpectralDataResponse {
  hduIndex: number;
  hduName: string | null;
  nPoints: number;
  columns: SpectralColumnMeta[];
  data: Record<string, (number | null)[]>;
}

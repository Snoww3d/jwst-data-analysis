/**
 * TypeScript types for WCS Mosaic Creator wizard
 */

/**
 * Supported stretch methods for single-channel mosaic rendering.
 */
export type MosaicStretchMethod =
  | 'zscale'
  | 'asinh'
  | 'log'
  | 'sqrt'
  | 'power'
  | 'histeq'
  | 'linear';

/**
 * Supported combine methods for overlapping mosaic pixels.
 */
export type MosaicCombineMethod = 'mean' | 'sum' | 'first' | 'last' | 'min' | 'max';

/**
 * Supported output colormaps for single-channel mosaic rendering.
 */
export type MosaicColormap =
  | 'inferno'
  | 'magma'
  | 'viridis'
  | 'plasma'
  | 'hot'
  | 'cool'
  | 'rainbow'
  | 'grayscale';

/**
 * Configuration for a single input file in the mosaic
 */
export interface MosaicFileConfig {
  dataId: string;
  stretch: MosaicStretchMethod;
  blackPoint: number; // 0.0-1.0
  whitePoint: number; // 0.0-1.0
  gamma: number; // 0.1-5.0
  asinhA: number; // 0.001-1.0
}

/**
 * Request payload for mosaic generation API
 */
export interface MosaicRequest {
  files: MosaicFileConfig[];
  outputFormat: 'png' | 'jpeg' | 'fits';
  quality: number;
  width?: number;
  height?: number;
  combineMethod: MosaicCombineMethod;
  cmap: MosaicColormap;
}

export interface SavedMosaicResponse {
  dataId: string;
  fileName: string;
  fileSize: number;
  fileFormat: string;
  processingLevel: string;
  derivedFrom: string[];
}

/**
 * WCS footprint for a single file
 */
export interface FootprintEntry {
  file_path: string;
  corners_ra: number[];
  corners_dec: number[];
  center_ra: number;
  center_dec: number;
}

/**
 * Response from footprint endpoint
 */
export interface FootprintResponse {
  footprints: FootprintEntry[];
  bounding_box: {
    min_ra: number;
    max_ra: number;
    min_dec: number;
    max_dec: number;
  };
  n_files: number;
}

/**
 * Wizard step type (1=Select, 2=Configure+Footprint, 3=Generate+Export)
 */
export type MosaicWizardStep = 1 | 2 | 3;

/**
 * Default file stretch parameters
 */
export const DEFAULT_MOSAIC_FILE_PARAMS = {
  stretch: 'asinh',
  blackPoint: 0.0,
  whitePoint: 1.0,
  gamma: 1.0,
  asinhA: 0.1,
} satisfies Omit<MosaicFileConfig, 'dataId'>;

/**
 * Available stretch methods.
 */
export const MOSAIC_STRETCH_OPTIONS: ReadonlyArray<{
  value: MosaicStretchMethod;
  label: string;
  description: string;
}> = [
  { value: 'asinh', label: 'Asinh', description: 'High dynamic range, preserves faint detail' },
  { value: 'zscale', label: 'ZScale', description: 'Automatic robust scaling' },
  { value: 'log', label: 'Logarithmic', description: 'Highlights faint extended structure' },
  { value: 'sqrt', label: 'Square Root', description: 'Moderate contrast boost' },
  { value: 'power', label: 'Power Law', description: 'Gamma-driven intensity shaping' },
  { value: 'histeq', label: 'Histogram Eq.', description: 'Maximum local contrast' },
  { value: 'linear', label: 'Linear', description: 'No nonlinear stretch' },
];

/**
 * Available combine methods
 */
export const COMBINE_METHODS = [
  { value: 'mean', label: 'Mean', description: 'Average overlapping pixels' },
  { value: 'sum', label: 'Sum', description: 'Add overlapping pixels' },
  { value: 'first', label: 'First', description: "Use first file's pixel value" },
  { value: 'last', label: 'Last', description: "Use last file's pixel value" },
  { value: 'min', label: 'Min', description: 'Minimum of overlapping pixels' },
  { value: 'max', label: 'Max', description: 'Maximum of overlapping pixels' },
] as const satisfies ReadonlyArray<{
  value: MosaicCombineMethod;
  label: string;
  description: string;
}>;

/**
 * Available colormaps
 */
export const MOSAIC_COLORMAPS = [
  'inferno',
  'magma',
  'viridis',
  'plasma',
  'hot',
  'cool',
  'rainbow',
  'grayscale',
] as const satisfies ReadonlyArray<MosaicColormap>;

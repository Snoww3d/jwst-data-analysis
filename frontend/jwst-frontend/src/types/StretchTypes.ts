/**
 * Shared stretch types used by both composite and mosaic wizards.
 */

export type StretchMethod = 'zscale' | 'asinh' | 'log' | 'sqrt' | 'power' | 'histeq' | 'linear';

/**
 * Base stretch parameters shared between composite channels and mosaic files.
 */
export interface BaseStretchParams {
  stretch: StretchMethod;
  blackPoint: number;
  whitePoint: number;
  gamma: number;
  asinhA: number;
}

export const DEFAULT_STRETCH_PARAMS: BaseStretchParams = {
  stretch: 'asinh',
  blackPoint: 0.0,
  whitePoint: 1.0,
  gamma: 1.0,
  asinhA: 0.05,
};

export const STRETCH_OPTIONS: ReadonlyArray<{
  value: StretchMethod;
  label: string;
  description: string;
}> = [
  { value: 'zscale', label: 'ZScale', description: 'Automatic robust scaling' },
  { value: 'asinh', label: 'Asinh', description: 'High dynamic range, preserves faint detail' },
  { value: 'log', label: 'Logarithmic', description: 'Extended emission, nebulae' },
  { value: 'sqrt', label: 'Square Root', description: 'Moderate compression' },
  { value: 'power', label: 'Power Law', description: 'Customizable with gamma' },
  { value: 'histeq', label: 'Histogram Eq.', description: 'Maximum contrast' },
  { value: 'linear', label: 'Linear', description: 'No compression' },
];

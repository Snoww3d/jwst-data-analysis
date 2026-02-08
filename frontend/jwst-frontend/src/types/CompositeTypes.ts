/**
 * TypeScript types for RGB Composite Creator wizard
 */

export type ChannelName = 'red' | 'green' | 'blue';
export type ToneCurve = 'linear' | 's_curve' | 'inverse_s' | 'shadows' | 'highlights';
export type StretchMethod = 'zscale' | 'asinh' | 'log' | 'sqrt' | 'power' | 'histeq' | 'linear';

/**
 * Configuration for a single color channel (R, G, or B)
 */
export interface ChannelConfig {
  dataId: string;
  stretch: StretchMethod;
  blackPoint: number; // 0.0-1.0
  whitePoint: number; // 0.0-1.0
  gamma: number; // 0.1-5.0
  asinhA: number; // 0.001-1.0
  curve: ToneCurve;
}

/**
 * Request payload for composite generation API
 */
export interface CompositeRequest {
  red: ChannelConfig;
  green: ChannelConfig;
  blue: ChannelConfig;
  overall?: OverallAdjustments;
  outputFormat: 'png' | 'jpeg';
  quality: number;
  width: number;
  height: number;
}

/**
 * Channel assignment state for the wizard
 */
export type ChannelAssignment = Record<ChannelName, string | null>; // dataId

/**
 * Per-channel stretch parameters
 */
export interface ChannelStretchParams {
  stretch: StretchMethod;
  blackPoint: number;
  whitePoint: number;
  gamma: number;
  asinhA: number;
  curve: ToneCurve;
}

export type ChannelParams = Record<ChannelName, ChannelStretchParams>;

/**
 * Global post-stack levels and stretch adjustments.
 */
export interface OverallAdjustments {
  stretch: StretchMethod;
  blackPoint: number;
  whitePoint: number;
  gamma: number;
  asinhA: number;
}

/**
 * Export options for the final composite
 */
export interface ExportOptions {
  format: 'png' | 'jpeg';
  quality: number; // 1-100 for JPEG
  width: number;
  height: number;
}

/**
 * Wizard step type
 */
export type WizardStep = 1 | 2 | 3;

/**
 * Default channel parameters
 */
export const DEFAULT_CHANNEL_PARAMS = {
  stretch: 'zscale',
  blackPoint: 0.0,
  whitePoint: 1.0,
  gamma: 1.0,
  asinhA: 0.1,
  curve: 'linear',
} satisfies ChannelStretchParams;

export const DEFAULT_CHANNEL_ASSIGNMENT: ChannelAssignment = {
  red: null,
  green: null,
  blue: null,
};

export const DEFAULT_CHANNEL_PARAMS_BY_CHANNEL: ChannelParams = {
  red: { ...DEFAULT_CHANNEL_PARAMS },
  green: { ...DEFAULT_CHANNEL_PARAMS },
  blue: { ...DEFAULT_CHANNEL_PARAMS },
};

export const DEFAULT_OVERALL_ADJUSTMENTS: OverallAdjustments = {
  stretch: 'zscale',
  blackPoint: 0.0,
  whitePoint: 1.0,
  gamma: 1.0,
  asinhA: 0.1,
};

/**
 * Default export options
 */
export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  format: 'png',
  quality: 95,
  width: 2000,
  height: 2000,
};

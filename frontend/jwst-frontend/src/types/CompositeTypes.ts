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
  dataIds: string[];
  stretch: StretchMethod;
  blackPoint: number; // 0.0-1.0
  whitePoint: number; // 0.0-1.0
  gamma: number; // 0.1-5.0
  asinhA: number; // 0.001-1.0
  curve: ToneCurve;
  weight: number; // 0.0-2.0, channel intensity multiplier
}

/**
 * Request payload for composite generation API
 */
export interface CompositeRequest {
  red: ChannelConfig;
  green: ChannelConfig;
  blue: ChannelConfig;
  overall?: OverallAdjustments;
  backgroundNeutralization?: boolean;
  outputFormat: 'png' | 'jpeg';
  quality: number;
  width: number;
  height: number;
}

/**
 * Channel assignment state for the wizard
 */
export type ChannelAssignment = Record<ChannelName, string[]>; // dataIds

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
  weight: number; // 0.0-2.0
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
 * Color specification for N-channel composite — either hue or explicit RGB weights
 */
export interface ChannelColorSpec {
  hue?: number; // 0-360
  rgb?: [number, number, number]; // each 0-1
}

/**
 * State for a single N-channel in the wizard
 */
export interface NChannelState {
  id: string;
  dataIds: string[];
  color: ChannelColorSpec;
  label?: string;
  wavelengthUm?: number;
  params: ChannelStretchParams;
}

/**
 * N-channel config payload sent to the API (per channel)
 */
export interface NChannelConfigPayload {
  dataIds: string[];
  color: ChannelColorSpec;
  label?: string;
  wavelengthUm?: number;
  stretch: string;
  blackPoint: number;
  whitePoint: number;
  gamma: number;
  asinhA: number;
  curve: string;
  weight: number;
}

/**
 * N-channel composite request sent to the API
 */
export interface NChannelCompositeRequest {
  channels: NChannelConfigPayload[];
  overall?: OverallAdjustments;
  backgroundNeutralization?: boolean;
  outputFormat: 'png' | 'jpeg';
  quality: number;
  width: number;
  height: number;
}

/**
 * Wizard step type
 */
export type WizardStep = 1 | 2;

/**
 * Default channel parameters
 */
export const DEFAULT_CHANNEL_PARAMS = {
  stretch: 'log',
  blackPoint: 0.0,
  whitePoint: 1.0,
  gamma: 1.0,
  asinhA: 0.1,
  curve: 'linear',
  weight: 1.0,
} satisfies ChannelStretchParams;

export const DEFAULT_CHANNEL_ASSIGNMENT: ChannelAssignment = {
  red: [],
  green: [],
  blue: [],
};

export const DEFAULT_CHANNEL_PARAMS_BY_CHANNEL: ChannelParams = {
  red: { ...DEFAULT_CHANNEL_PARAMS },
  green: { ...DEFAULT_CHANNEL_PARAMS },
  blue: { ...DEFAULT_CHANNEL_PARAMS },
};

export const DEFAULT_OVERALL_ADJUSTMENTS: OverallAdjustments = {
  stretch: 'linear',
  blackPoint: 0.0,
  whitePoint: 1.0,
  gamma: 1.0,
  asinhA: 0.1,
};

let channelIdCounter = 0;

/**
 * Create a default N-channel with the given hue
 */
export function createDefaultNChannel(hue: number): NChannelState {
  channelIdCounter += 1;
  return {
    id: `ch-${Date.now()}-${channelIdCounter}`,
    dataIds: [],
    color: { hue },
    params: { ...DEFAULT_CHANNEL_PARAMS },
  };
}

/**
 * Create the default 3 RGB channels (hue 0/120/240)
 */
export function createDefaultRGBChannels(): NChannelState[] {
  return [
    { ...createDefaultNChannel(0), label: 'Red' },
    { ...createDefaultNChannel(120), label: 'Green' },
    { ...createDefaultNChannel(240), label: 'Blue' },
  ];
}

/**
 * Default export options
 */
export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  format: 'png',
  quality: 95,
  width: 2000,
  height: 2000,
};

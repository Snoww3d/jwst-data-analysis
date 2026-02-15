/**
 * TypeScript types for composite creator wizard
 */

export type ToneCurve = 'linear' | 's_curve' | 'inverse_s' | 'shadows' | 'highlights';
export type StretchMethod = 'zscale' | 'asinh' | 'log' | 'sqrt' | 'power' | 'histeq' | 'linear';

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
  luminance?: boolean; // true = luminance (detail) channel for LRGB
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

export const DEFAULT_OVERALL_ADJUSTMENTS: OverallAdjustments = {
  stretch: 'linear',
  blackPoint: 0.0,
  whitePoint: 1.0,
  gamma: 1.0,
  asinhA: 0.1,
};

let channelIdCounter = 0;

/** Auto-generated color names used as default channel labels */
export const AUTO_COLOR_NAMES = new Set([
  'Red',
  'Orange',
  'Yellow',
  'Green',
  'Cyan',
  'Blue',
  'Purple',
  'Magenta',
  'Rose',
  'Luminance',
]);

/**
 * Map a hue (0-360) to the nearest common color name
 */
export function hueToColorName(hue: number): string {
  const normalized = ((hue % 360) + 360) % 360;
  const names: Array<[number, string]> = [
    [0, 'Red'],
    [30, 'Orange'],
    [60, 'Yellow'],
    [120, 'Green'],
    [180, 'Cyan'],
    [240, 'Blue'],
    [270, 'Purple'],
    [300, 'Magenta'],
    [330, 'Rose'],
  ];
  let closest = names[0][1];
  let minDist = 360;
  for (const [h, name] of names) {
    const dist = Math.min(Math.abs(normalized - h), 360 - Math.abs(normalized - h));
    if (dist < minDist) {
      minDist = dist;
      closest = name;
    }
  }
  return closest;
}

/**
 * Create a default N-channel with the given hue
 */
export function createDefaultNChannel(hue: number): NChannelState {
  channelIdCounter += 1;
  return {
    id: `ch-${Date.now()}-${channelIdCounter}`,
    dataIds: [],
    color: { hue },
    label: hueToColorName(hue),
    params: { ...DEFAULT_CHANNEL_PARAMS },
  };
}

/**
 * Create a luminance channel (no color, detail only)
 */
export function createLuminanceChannel(): NChannelState {
  channelIdCounter += 1;
  return {
    id: `ch-${Date.now()}-${channelIdCounter}`,
    dataIds: [],
    color: { luminance: true },
    label: 'Luminance',
    params: { ...DEFAULT_CHANNEL_PARAMS },
  };
}

/**
 * Create the default 3 RGB channels (hue 0/120/240)
 */
export function createDefaultRGBChannels(): NChannelState[] {
  return [createDefaultNChannel(0), createDefaultNChannel(120), createDefaultNChannel(240)];
}

/**
 * Create LRGB preset: Luminance + Red + Green + Blue
 */
export function createLRGBChannels(): NChannelState[] {
  return [
    createLuminanceChannel(),
    createDefaultNChannel(0),
    createDefaultNChannel(120),
    createDefaultNChannel(240),
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

/**
 * TypeScript types for composite creator wizard
 */

import type { BaseStretchParams } from './StretchTypes';

export type { StretchMethod } from './StretchTypes';
export { DEFAULT_STRETCH_PARAMS, STRETCH_OPTIONS } from './StretchTypes';
export type { BaseStretchParams } from './StretchTypes';

export type ToneCurve = 'linear' | 's_curve' | 'inverse_s' | 'shadows' | 'highlights';

/**
 * Per-channel stretch parameters — extends base with composite-specific fields.
 */
export interface ChannelStretchParams extends BaseStretchParams {
  curve: ToneCurve;
  weight: number; // 0.0-2.0
}

/**
 * Global post-stack levels and stretch adjustments.
 */
export type OverallAdjustments = BaseStretchParams;

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
 * Router state payload for the /composite page
 */
export interface CompositePageState {
  allImageIds?: string[];
  initialChannels?: NChannelState[];
  initialSelection?: string[];
}

/**
 * Router state payload for the /mosaic page
 */
export interface MosaicPageState {
  allImageIds?: string[];
  initialSelection?: string[];
}

/**
 * A composite preset configures all stretch/level params at once.
 * Per-channel params + overall adjustments + background neutralization.
 */
export interface CompositePreset {
  id: string;
  label: string;
  description: string;
  channelParams: ChannelStretchParams;
  overall: OverallAdjustments;
  backgroundNeutralization: boolean;
}

/**
 * Built-in composite presets.
 *
 * "NASA-style" mirrors STScI press release workflows:
 *   - asinh stretch with aggressive softening reveals faint + bright structure
 *   - s-curve tone adds midtone punch
 *   - slight black-point clip removes residual sky noise
 *
 * Others offer useful starting points for different science/presentation goals.
 */
export const COMPOSITE_PRESETS: CompositePreset[] = [
  {
    id: 'nasa',
    label: 'NASA Press',
    description: 'Asinh stretch with punchy contrast — matches STScI press release style',
    channelParams: {
      stretch: 'asinh',
      blackPoint: 0.02,
      whitePoint: 0.995,
      gamma: 1.2,
      asinhA: 0.02,
      curve: 's_curve',
      weight: 1.0,
    },
    overall: {
      stretch: 'linear',
      blackPoint: 0.01,
      whitePoint: 1.0,
      gamma: 1.1,
      asinhA: 0.1,
    },
    backgroundNeutralization: true,
  },
  {
    id: 'high-contrast',
    label: 'High Contrast',
    description: 'Maximum visual impact — deep blacks, bright highlights',
    channelParams: {
      stretch: 'asinh',
      blackPoint: 0.05,
      whitePoint: 0.98,
      gamma: 1.4,
      asinhA: 0.05,
      curve: 's_curve',
      weight: 1.0,
    },
    overall: {
      stretch: 'linear',
      blackPoint: 0.02,
      whitePoint: 0.99,
      gamma: 1.2,
      asinhA: 0.1,
    },
    backgroundNeutralization: true,
  },
  {
    id: 'faint-emission',
    label: 'Faint Emission',
    description: 'Reveals faint nebulosity and extended structure',
    channelParams: {
      stretch: 'asinh',
      blackPoint: 0.0,
      whitePoint: 1.0,
      gamma: 1.8,
      asinhA: 0.005,
      curve: 'shadows',
      weight: 1.0,
    },
    overall: {
      stretch: 'linear',
      blackPoint: 0.0,
      whitePoint: 1.0,
      gamma: 1.3,
      asinhA: 0.1,
    },
    backgroundNeutralization: true,
  },
  {
    id: 'natural',
    label: 'Natural',
    description: 'Gentle stretch for a more photographic look',
    channelParams: {
      stretch: 'sqrt',
      blackPoint: 0.01,
      whitePoint: 1.0,
      gamma: 1.0,
      asinhA: 0.1,
      curve: 'linear',
      weight: 1.0,
    },
    overall: {
      stretch: 'linear',
      blackPoint: 0.0,
      whitePoint: 1.0,
      gamma: 1.0,
      asinhA: 0.1,
    },
    backgroundNeutralization: true,
  },
  {
    id: 'scientific',
    label: 'Scientific',
    description: 'ZScale with linear tone — calibrated, no aesthetic processing',
    channelParams: {
      stretch: 'zscale',
      blackPoint: 0.0,
      whitePoint: 1.0,
      gamma: 1.0,
      asinhA: 0.1,
      curve: 'linear',
      weight: 1.0,
    },
    overall: {
      stretch: 'linear',
      blackPoint: 0.0,
      whitePoint: 1.0,
      gamma: 1.0,
      asinhA: 0.1,
    },
    backgroundNeutralization: false,
  },
];

/**
 * Default channel parameters for the advanced editor — asinh with moderate softening.
 * Users can fine-tune all parameters in the editor UI.
 */
export const DEFAULT_CHANNEL_PARAMS = {
  stretch: 'asinh',
  blackPoint: 0.0,
  whitePoint: 1.0,
  gamma: 1.0,
  asinhA: 0.05,
  curve: 'linear',
  weight: 1.0,
} satisfies ChannelStretchParams;

/**
 * Channel parameters for guided create — zscale with built-in outlier rejection.
 * Produces a good first result without manual tuning, especially for mosaicked
 * multi-file composites where outliers would crush asinh to near-black.
 */
export const GUIDED_CHANNEL_PARAMS = {
  ...DEFAULT_CHANNEL_PARAMS,
  stretch: 'zscale',
  asinhA: 0.1,
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
    [280, 'Purple'],
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
 * Create an N-channel with explicit RGB weights (e.g. for bicolor compositing)
 */
export function createNChannelWithRgb(rgb: [number, number, number]): NChannelState {
  channelIdCounter += 1;
  return {
    id: `ch-${Date.now()}-${channelIdCounter}`,
    dataIds: [],
    color: { rgb },
    params: { ...DEFAULT_CHANNEL_PARAMS },
  };
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

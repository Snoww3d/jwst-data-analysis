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
 * Unsharp masking applied to the final RGB composite.
 *
 * Sharpening is luminance-based (not per-channel) to preserve color balance.
 * When {@link SharpeningConfig.amount} is 0 the feature is a no-op.
 */
export interface SharpeningConfig {
  /** Gaussian blur sigma in pixels (0.5-10.0) */
  radius: number;
  /** Sharpening strength (0=disabled, 1=typical, up to 3) */
  amount: number;
  /** Minimum luminance delta to sharpen (0-1) — protects noise floor */
  threshold: number;
}

export const DEFAULT_SHARPENING: SharpeningConfig = {
  radius: 1.5,
  amount: 0.0,
  threshold: 0.0,
};

/**
 * Global saturation, vibrancy, and hue rotation applied after sharpening.
 *
 * Operates in HSL space. All defaults produce a no-op.
 */
export interface SaturationConfig {
  /** Multiplicative saturation scale (0=grayscale, 1=unchanged, 2=max boost) */
  saturation: number;
  /** Selective boost for muted colors (0=off, 1=max) */
  vibrancy: number;
  /** Global hue shift in degrees (-30 to +30) */
  hueRotation: number;
}

export const DEFAULT_SATURATION: SaturationConfig = {
  saturation: 1.0,
  vibrancy: 0.0,
  hueRotation: 0.0,
};

/** Returns true when the config matches defaults (no-op for the pipeline). */
export function isDefaultSaturation(config: SaturationConfig): boolean {
  return config.saturation === 1.0 && config.vibrancy === 0.0 && config.hueRotation === 0.0;
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

/** Rotation and crop framing applied during export */
export interface FramingOptions {
  rotationDegrees?: number;
  cropCenterX?: number;
  cropCenterY?: number;
  cropZoom?: number;
}

/** Options for N-channel preview generation */
export interface NChannelPreviewOptions {
  previewSize?: number;
  overall?: OverallAdjustments;
  abortSignal?: AbortSignal;
  backgroundNeutralization?: boolean;
  featherStrength?: number;
  sharpening?: SharpeningConfig;
  saturation?: SaturationConfig;
}

/** Options for N-channel export (sync and async) */
export interface NChannelExportOptions extends ExportOptions {
  overall?: OverallAdjustments;
  backgroundNeutralization?: boolean;
  featherStrength?: number;
  framing?: FramingOptions;
  sharpening?: SharpeningConfig;
  saturation?: SaturationConfig;
  abortSignal?: AbortSignal;
}

/**
 * Color specification for N-channel composite — either hue or explicit RGB weights
 */
export interface ChannelColorSpec {
  hue?: number; // 0-360
  rgb?: [number, number, number]; // each 0-1
  luminance?: boolean; // true = luminance (detail) channel for LRGB
}

// --- Channel Analysis Types (from POST /composite/analyze-channels) ---

/**
 * Detection metadata from auto-stretch analysis.
 */
export interface AutoStretchMeta {
  dynamicRange: number;
  noise: number;
  snr: number;
  hdrDetected: boolean;
  curveReason: string;
  instrumentAdjusted: boolean;
  validPixels: number;
  zeroCoverageFrac: number;
}

/**
 * Histogram data for a single channel's valid pixels.
 */
export interface ChannelHistogram {
  counts: number[];
  binCenters: number[];
  binEdges: number[];
  nBins: number;
}

/**
 * Basic statistics for a channel's valid pixels.
 */
export interface ChannelAnalysisStats {
  min: number;
  max: number;
  mean: number;
  std: number;
}

/**
 * Full analysis result for a single channel — params, histogram, and metadata.
 */
export interface ChannelAnalysis {
  channelName: string;
  label: string | null;
  params: ChannelStretchParams;
  histogram: ChannelHistogram;
  meta: AutoStretchMeta;
  stats: ChannelAnalysisStats;
}

/**
 * Raw response from POST /composite/analyze-channels (snake_case from backend).
 * Use mapAnalysisResult() in the component to convert to ChannelAnalysis.
 */
export interface AnalyzeChannelsResponse {
  channels: Record<string, unknown>[];
}

// --- Saved Stretch Presets (localStorage) ---

/**
 * A user-saved stretch preset stored in localStorage.
 */
export interface SavedStretchPreset {
  id: string;
  name: string;
  createdAt: string;
  channelParams: ChannelStretchParams;
  overall: OverallAdjustments;
  sharpening?: SharpeningConfig;
  saturation?: SaturationConfig;
  backgroundNeutralization: boolean;
}

/** localStorage key for saved presets — versioned to handle schema changes. */
export const SAVED_PRESETS_STORAGE_KEY = 'jwst_stretch_presets_v1';

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
  analysis?: ChannelAnalysis;
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
  autoStretch?: boolean;
}

/**
 * N-channel composite request sent to the API
 */
export interface NChannelCompositeRequest {
  channels: NChannelConfigPayload[];
  overall?: OverallAdjustments;
  sharpening?: SharpeningConfig;
  saturation?: SaturationConfig;
  backgroundNeutralization?: boolean;
  featherStrength?: number;
  rotationDegrees?: number;
  cropCenterX?: number;
  cropCenterY?: number;
  cropZoom?: number;
  outputFormat: 'png' | 'jpeg';
  quality: number;
  width: number;
  height: number;
}

/**
 * Wallpaper resolution preset
 */
export interface WallpaperPreset {
  id: string;
  label: string;
  category: 'Desktop' | 'Phone' | 'Tablet' | 'Social' | 'Custom';
  width: number;
  height: number;
}

/**
 * Built-in wallpaper resolution presets
 */
export const WALLPAPER_PRESETS: WallpaperPreset[] = [
  { id: '4k', label: '4K', category: 'Desktop', width: 3840, height: 2160 },
  { id: 'qhd', label: 'QHD', category: 'Desktop', width: 2560, height: 1440 },
  { id: 'fhd', label: 'FHD', category: 'Desktop', width: 1920, height: 1080 },
  { id: 'ultrawide', label: 'Ultrawide', category: 'Desktop', width: 3440, height: 1440 },
  { id: 'mobile', label: 'Mobile', category: 'Phone', width: 1080, height: 1920 },
  { id: 'ipad', label: 'iPad', category: 'Tablet', width: 2048, height: 2732 },
  { id: 'square', label: 'Square', category: 'Social', width: 2000, height: 2000 },
];

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
  instrumentOverrides?: Record<string, ChannelStretchParams>;
  overall: OverallAdjustments;
  backgroundNeutralization: boolean;
  sharpening?: SharpeningConfig;
  saturation?: SaturationConfig;
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
    id: 'auto',
    label: 'Auto',
    description: "Adapts stretch to each channel's noise, dynamic range, and signal — best default",
    // channelParams are UI-display-only defaults — server-side auto_stretch overrides them
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
      blackPoint: 0.0,
      whitePoint: 1.0,
      gamma: 1.0,
      asinhA: 0.1,
    },
    backgroundNeutralization: true,
    // Gentle unsharp mask by default — counteracts the resolution-blur
    // step the pipeline applies to coarser-resolution channels in
    // mixed-instrument (NIRCam + MIRI) composites. Less aggressive than
    // the NASA Press preset (0.6) so the "Auto" character stays balanced.
    sharpening: {
      radius: 1.5,
      amount: 0.4,
      threshold: 0.01,
    },
    saturation: {
      saturation: 1.1,
      vibrancy: 0.15,
      hueRotation: 0.0,
    },
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
    instrumentOverrides: {
      MIRI: {
        stretch: 'sqrt',
        blackPoint: 0.03,
        whitePoint: 1.0,
        gamma: 1.0,
        asinhA: 0.1,
        curve: 'linear',
        weight: 1.0,
      },
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
    instrumentOverrides: {
      MIRI: {
        stretch: 'asinh',
        blackPoint: 0.08,
        whitePoint: 0.995,
        gamma: 1.0,
        asinhA: 0.08,
        curve: 'shadows',
        weight: 1.0,
      },
    },
    overall: {
      stretch: 'linear',
      blackPoint: 0.01,
      whitePoint: 1.0,
      gamma: 1.1,
      asinhA: 0.1,
    },
    backgroundNeutralization: true,
    sharpening: {
      radius: 1.5,
      amount: 0.6,
      threshold: 0.01,
    },
    saturation: {
      saturation: 1.3,
      vibrancy: 0.25,
      hueRotation: 0.0,
    },
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
    instrumentOverrides: {
      MIRI: {
        stretch: 'asinh',
        blackPoint: 0.1,
        whitePoint: 0.98,
        gamma: 1.1,
        asinhA: 0.1,
        curve: 'shadows',
        weight: 1.0,
      },
    },
    overall: {
      stretch: 'linear',
      blackPoint: 0.02,
      whitePoint: 0.99,
      gamma: 1.2,
      asinhA: 0.1,
    },
    backgroundNeutralization: true,
    saturation: {
      saturation: 1.4,
      vibrancy: 0.2,
      hueRotation: 0.0,
    },
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
    instrumentOverrides: {
      MIRI: {
        stretch: 'asinh',
        blackPoint: 0.0,
        whitePoint: 1.0,
        gamma: 1.4,
        asinhA: 0.02,
        curve: 'shadows',
        weight: 1.0,
      },
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

/**
 * Memory-budget warning surfaced from the processing engine via X-Composite-*
 * response headers. Present when the engine had to downscale the output to fit
 * MAX_COMPOSITE_MEMORY_BYTES, or when budget pressure would force a downscale
 * for a freshly-computed result.
 *
 * Status values match the engine verdict:
 *   - 'ok'   — no pressure; banner not shown
 *   - 'warn' — mild downscale applied (or cached result fits current budget)
 *   - 'fail' — would have refused; only seen on cached results when operator
 *              tightened the budget after caching
 */
export interface CompositeWarning {
  budgetStatus: 'ok' | 'warn' | 'fail';
  wasDownscaled: boolean;
  originalShape?: [number, number]; // [height, width]
  outputShape?: [number, number];
  sideFactor?: number;
}

/**
 * Verdict returned by POST /api/composite/estimate. The endpoint reads file
 * WCS headers and runs the engine's memory math without doing reproject +
 * combine, so callers can pre-flight feasibility before submitting work.
 */
export interface CompositeEstimateResponse {
  status: 'ok' | 'warn' | 'fail';
  originalShape: [number, number];
  outputShape: [number, number];
  sideFactor: number;
  detail: string;
  memoryLimitMb: number;
  failThreshold: number;
}

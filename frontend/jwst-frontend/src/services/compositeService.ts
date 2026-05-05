/**
 * Service for composite generation API calls
 *
 * All requests route through apiClient for automatic token refresh,
 * 401 retry, and pre-request freshness checks.
 */

import { apiClient } from './apiClient';
import {
  CompositeEstimateResponse,
  CompositeWarning,
  NChannelCompositeRequest,
  NChannelConfigPayload,
  NChannelPreviewOptions,
  NChannelExportOptions,
  AnalyzeChannelsResponse,
} from '../types/CompositeTypes';

/**
 * Result of a composite generation call: image bytes plus an optional
 * memory-budget warning parsed from `X-Composite-*` response headers.
 */
export interface CompositeBlobResult {
  blob: Blob;
  warning: CompositeWarning | null;
}

/**
 * Parse `[H, W]` from a comma-separated `X-Composite-*-Shape` header. Returns
 * undefined if the header is missing or not parseable as exactly two ints.
 */
function parseShapeHeader(value: string | null): [number, number] | undefined {
  if (!value) return undefined;
  const parts = value.split(',').map((s) => Number.parseInt(s.trim(), 10));
  if (parts.length !== 2 || parts.some((n) => Number.isNaN(n))) return undefined;
  return [parts[0], parts[1]];
}

/**
 * Engine error prefix applied by .NET ProcessingErrorMessages for memory-budget
 * 413 failures so the frontend can offer the "Continue anyway" override even
 * on the async path (where the HTTP 413 status is lost crossing SignalR).
 *
 * Matches the existing `NO_PRODUCTS:` / `S3_UNAVAILABLE:` convention used by
 * the download flow.
 */
const MEMORY_BUDGET_PREFIX = 'MEMORY_BUDGET:';

/**
 * The engine's 413 detail string emits both `MAX_COMPOSITE_MEMORY_BYTES` and
 * `Composite output would shrink to N%` (see processing-engine routes.py:716).
 * Either substring on its own could plausibly appear in unrelated errors
 * (operator docs, tooltip text), so detection requires both to avoid false
 * positives that would offer "Continue anyway" on errors the override can't
 * actually resolve.
 */
const MEMORY_BUDGET_KEYWORDS = ['MAX_COMPOSITE_MEMORY_BYTES', 'Composite output would shrink'];

/**
 * Parse the projected output shape from an engine 413 detail string. The
 * engine emits `(WIDTHxHEIGHT from ORIGWxORIGH)` — we capture the projected
 * (smaller) shape because that's what the user is opting in to.
 */
const PROJECTED_SHAPE_RE = /\((\d+)x(\d+) from \d+x\d+\)/;

/**
 * Result of inspecting an error string to decide whether the "Continue anyway"
 * override should be offered. Used by both the sync (ApiError 413) and async
 * (SignalR error string) error paths so detection logic stays in one place.
 */
export interface MemoryBudgetErrorParse {
  /** True when the message is a memory-budget refusal. */
  isMemoryBudget: boolean;
  /** Message with the MEMORY_BUDGET: prefix stripped if present. */
  displayMessage: string;
  /** Projected output shape [width, height] parsed from the detail, or null. */
  projectedShape: [number, number] | null;
}

export function parseMemoryBudgetError(message: string | null | undefined): MemoryBudgetErrorParse {
  if (!message) {
    return { isMemoryBudget: false, displayMessage: '', projectedShape: null };
  }
  const hasPrefix = message.startsWith(MEMORY_BUDGET_PREFIX);
  const stripped = hasPrefix ? message.slice(MEMORY_BUDGET_PREFIX.length) : message;
  const isMemoryBudget = hasPrefix || MEMORY_BUDGET_KEYWORDS.every((kw) => stripped.includes(kw));
  const match = stripped.match(PROJECTED_SHAPE_RE);
  const projectedShape: [number, number] | null = match
    ? [Number.parseInt(match[1], 10), Number.parseInt(match[2], 10)]
    : null;
  return { isMemoryBudget, displayMessage: stripped, projectedShape };
}

/**
 * Build a typed `CompositeWarning` from the engine's response headers, or
 * return null if the engine didn't emit a budget status (older engine, or
 * the request didn't go through the composite memory path at all).
 */
export function parseCompositeWarning(headers: Headers): CompositeWarning | null {
  const status = headers.get('X-Composite-Budget-Status');
  if (status !== 'ok' && status !== 'warn' && status !== 'forced' && status !== 'fail') {
    return null;
  }

  const wasDownscaled = headers.get('X-Composite-Was-Downscaled') === 'true';
  const sideFactorRaw = headers.get('X-Composite-Side-Factor');
  const sideFactor = sideFactorRaw ? Number.parseFloat(sideFactorRaw) : undefined;

  // Engine contract: side_factor is in (0, 1]. Reject NaN, Infinity, and
  // out-of-range values to avoid rendering nonsense like "Infinity%".
  const validSideFactor =
    sideFactor !== undefined && Number.isFinite(sideFactor) && sideFactor > 0 && sideFactor <= 1
      ? sideFactor
      : undefined;

  return {
    budgetStatus: status,
    wasDownscaled,
    originalShape: parseShapeHeader(headers.get('X-Composite-Original-Shape')),
    outputShape: parseShapeHeader(headers.get('X-Composite-Output-Shape')),
    sideFactor: validSideFactor,
  };
}

/**
 * Generate an N-channel composite image.
 *
 * @returns Image blob plus optional memory-budget warning parsed from
 * `X-Composite-*` response headers (warning is null when the engine did not
 * emit budget metadata).
 */
export async function generateNChannelComposite(
  request: NChannelCompositeRequest,
  abortSignal?: AbortSignal
): Promise<CompositeBlobResult> {
  const { blob, headers } = await apiClient.postBlobWithHeaders(
    '/api/composite/generate-nchannel',
    request,
    { signal: abortSignal }
  );
  return { blob, warning: parseCompositeWarning(headers) };
}

/**
 * Build the engine request DTO for an N-channel preview composite.
 * Shared by the sync (`generateNChannelPreview`) and async
 * (`generateNChannelPreviewAsync`) paths so the request body shape stays
 * identical across the two endpoints.
 */
function buildPreviewRequest(
  channels: NChannelConfigPayload[],
  options: NChannelPreviewOptions
): NChannelCompositeRequest {
  const {
    previewSize = 800,
    overall,
    backgroundNeutralization,
    featherStrength,
    sharpening,
    saturation,
    allowForceDownscale,
  } = options;

  return {
    channels,
    overall,
    sharpening,
    saturation,
    backgroundNeutralization,
    featherStrength,
    outputFormat: 'jpeg',
    quality: 85,
    width: previewSize,
    height: previewSize,
    allowForceDownscale,
  };
}

/**
 * Generate an N-channel preview composite (sync). Used by anonymous wizard
 * users — `JobProgressHub` requires authentication, so anonymous previews
 * cannot subscribe to the async progress channel and stay on this path.
 *
 * @returns Image blob plus optional warning (same as `generateNChannelComposite`).
 */
export async function generateNChannelPreview(
  channels: NChannelConfigPayload[],
  options: NChannelPreviewOptions = {}
): Promise<CompositeBlobResult> {
  const request = buildPreviewRequest(channels, options);
  return generateNChannelComposite(request, options.abortSignal);
}

/**
 * Generate an N-channel preview composite asynchronously via the job queue.
 * Used by authenticated wizard users so the UI can render real progress
 * (stage label, elapsed time) via SignalR instead of blocking on a single
 * long HTTP request.
 *
 * @returns `{ jobId }` — subscribe via `useJobProgress` and fetch the result
 * blob from `/api/jobs/{jobId}/result` on completion. Cancel by POSTing to
 * `/api/jobs/{jobId}/cancel`.
 */
export async function generateNChannelPreviewAsync(
  channels: NChannelConfigPayload[],
  options: NChannelPreviewOptions = {}
): Promise<{ jobId: string }> {
  const request = buildPreviewRequest(channels, options);
  return apiClient.post<{ jobId: string }>('/api/composite/generate-nchannel-async', request, {
    signal: options.abortSignal,
  });
}

/**
 * Pre-flight a composite request against the engine's memory budget.
 * Returns a verdict (ok | warn | fail) without doing reproject + combine work.
 * Used by recipe walkthroughs that should skip infeasible recipes rather than
 * triggering OOM kills, and by UI flows that want to warn before submitting.
 */
export async function estimateComposite(
  request: NChannelCompositeRequest,
  abortSignal?: AbortSignal
): Promise<CompositeEstimateResponse> {
  return apiClient.post<CompositeEstimateResponse>('/api/composite/estimate', request, {
    signal: abortSignal,
  });
}

/**
 * Export an N-channel composite with user-specified options
 *
 * @param channels - Channel config payloads
 * @param options - Export options (format, dimensions, adjustments, etc.)
 * @returns Promise resolving to image Blob
 */
export async function exportNChannelComposite(
  channels: NChannelConfigPayload[],
  options: NChannelExportOptions
): Promise<CompositeBlobResult> {
  const {
    format,
    quality,
    width,
    height,
    overall,
    abortSignal,
    backgroundNeutralization,
    featherStrength,
    framing,
    sharpening,
    saturation,
    allowForceDownscale,
  } = options;

  const request: NChannelCompositeRequest = {
    channels,
    overall,
    sharpening,
    saturation,
    backgroundNeutralization,
    featherStrength,
    rotationDegrees: framing?.rotationDegrees,
    cropCenterX: framing?.cropCenterX,
    cropCenterY: framing?.cropCenterY,
    cropZoom: framing?.cropZoom,
    outputFormat: format,
    quality,
    width,
    height,
    allowForceDownscale,
  };

  return generateNChannelComposite(request, abortSignal);
}

/**
 * Export an N-channel composite asynchronously via the job queue.
 * Returns a job ID for tracking progress via SignalR.
 *
 * @param channels - Channel config payloads
 * @param options - Export options (format, dimensions, adjustments, etc.)
 * @returns Promise resolving to { jobId }
 */
export async function exportNChannelCompositeAsync(
  channels: NChannelConfigPayload[],
  options: Omit<NChannelExportOptions, 'abortSignal'>
): Promise<{ jobId: string }> {
  const {
    format,
    quality,
    width,
    height,
    overall,
    backgroundNeutralization,
    featherStrength,
    framing,
    sharpening,
    saturation,
    allowForceDownscale,
  } = options;

  const request: NChannelCompositeRequest = {
    channels,
    overall,
    sharpening,
    saturation,
    backgroundNeutralization,
    featherStrength,
    rotationDegrees: framing?.rotationDegrees,
    cropCenterX: framing?.cropCenterX,
    cropCenterY: framing?.cropCenterY,
    cropZoom: framing?.cropZoom,
    outputFormat: format,
    quality,
    width,
    height,
    allowForceDownscale,
  };

  return apiClient.post<{ jobId: string }>('/api/composite/export-nchannel', request);
}

/**
 * Analyze channels — compute auto-stretch params, histograms, and detection metadata.
 *
 * Calls a lightweight endpoint that loads channels at low resolution,
 * computes per-channel histogram + optimal stretch params, and returns JSON.
 * Used by the "Auto" button UI to populate stretch controls.
 *
 * @param channels - Channel config payloads
 * @param backgroundNeutralization - Whether to subtract sky background before analysis
 * @param abortSignal - Optional AbortSignal for cancellation
 * @returns Per-channel stretch params, histogram, and detection metadata
 */
export async function analyzeChannels(
  channels: NChannelConfigPayload[],
  backgroundNeutralization: boolean = true,
  abortSignal?: AbortSignal
): Promise<AnalyzeChannelsResponse> {
  return apiClient.post<AnalyzeChannelsResponse>(
    '/api/composite/analyze-channels',
    { channels, backgroundNeutralization },
    { signal: abortSignal }
  );
}

/**
 * Download a composite image as a file
 *
 * @param blob - The image blob to download
 * @param filename - Name for the downloaded file
 */
export function downloadComposite(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);

  link.click();

  // Clean up after a delay to ensure download starts
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 100);
}

/**
 * Generate a default filename for the composite
 *
 * @param format - Output format
 * @returns Filename with timestamp
 */
export function generateFilename(format: 'png' | 'jpeg'): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const ext = format === 'jpeg' ? 'jpg' : 'png';
  return `jwst-composite-${timestamp}.${ext}`;
}

/**
 * Service for composite generation API calls
 *
 * All requests route through apiClient for automatic token refresh,
 * 401 retry, and pre-request freshness checks.
 */

import { apiClient } from './apiClient';
import {
  OverallAdjustments,
  NChannelCompositeRequest,
  NChannelConfigPayload,
} from '../types/CompositeTypes';

/**
 * Generate an N-channel composite image
 *
 * @param request - N-channel composite request
 * @param abortSignal - Optional AbortSignal for cancellation
 * @returns Promise resolving to image Blob
 */
export async function generateNChannelComposite(
  request: NChannelCompositeRequest,
  abortSignal?: AbortSignal
): Promise<Blob> {
  return apiClient.postBlob('/api/composite/generate-nchannel', request, { signal: abortSignal });
}

/**
 * Generate an N-channel preview composite
 *
 * @param channels - Channel config payloads
 * @param previewSize - Size for preview (default 800)
 * @param overall - Optional overall adjustments
 * @param abortSignal - Optional AbortSignal for cancellation
 * @param backgroundNeutralization - Whether to subtract sky background
 * @returns Promise resolving to image Blob
 */
export async function generateNChannelPreview(
  channels: NChannelConfigPayload[],
  previewSize: number = 800,
  overall?: OverallAdjustments,
  abortSignal?: AbortSignal,
  backgroundNeutralization?: boolean,
  featherStrength?: number
): Promise<Blob> {
  const request: NChannelCompositeRequest = {
    channels,
    overall,
    backgroundNeutralization,
    featherStrength,
    outputFormat: 'jpeg',
    quality: 85,
    width: previewSize,
    height: previewSize,
  };

  return generateNChannelComposite(request, abortSignal);
}

/**
 * Export an N-channel composite with user-specified options
 *
 * @param channels - Channel config payloads
 * @param format - Output format (png or jpeg)
 * @param quality - Quality for JPEG (1-100)
 * @param width - Output width
 * @param height - Output height
 * @param overall - Optional overall adjustments
 * @param abortSignal - Optional AbortSignal for cancellation
 * @param backgroundNeutralization - Whether to subtract sky background
 * @returns Promise resolving to image Blob
 */
export async function exportNChannelComposite(
  channels: NChannelConfigPayload[],
  format: 'png' | 'jpeg',
  quality: number,
  width: number,
  height: number,
  overall?: OverallAdjustments,
  abortSignal?: AbortSignal,
  backgroundNeutralization?: boolean,
  featherStrength?: number
): Promise<Blob> {
  const request: NChannelCompositeRequest = {
    channels,
    overall,
    backgroundNeutralization,
    featherStrength,
    outputFormat: format,
    quality,
    width,
    height,
  };

  return generateNChannelComposite(request, abortSignal);
}

/**
 * Export an N-channel composite asynchronously via the job queue.
 * Returns a job ID for tracking progress via SignalR.
 *
 * @param channels - Channel config payloads
 * @param format - Output format (png or jpeg)
 * @param quality - Quality for JPEG (1-100)
 * @param width - Output width
 * @param height - Output height
 * @param overall - Optional overall adjustments
 * @param backgroundNeutralization - Whether to subtract sky background
 * @returns Promise resolving to { jobId }
 */
export async function exportNChannelCompositeAsync(
  channels: NChannelConfigPayload[],
  format: 'png' | 'jpeg',
  quality: number,
  width: number,
  height: number,
  overall?: OverallAdjustments,
  backgroundNeutralization?: boolean,
  featherStrength?: number
): Promise<{ jobId: string }> {
  const request: NChannelCompositeRequest = {
    channels,
    overall,
    backgroundNeutralization,
    featherStrength,
    outputFormat: format,
    quality,
    width,
    height,
  };

  return apiClient.post<{ jobId: string }>('/api/composite/export-nchannel', request);
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

/**
 * Service for composite generation API calls
 */

import { API_BASE_URL } from '../config/api';
import { ApiError } from './ApiError';
import {
  OverallAdjustments,
  NChannelCompositeRequest,
  NChannelConfigPayload,
} from '../types/CompositeTypes';

// Token getter - will be set by the auth context
let getAccessToken: (() => string | null) | null = null;

/**
 * Set the function used to retrieve the current access token.
 * Called by AuthContext to enable automatic auth header injection.
 */
export function setCompositeTokenGetter(getter: () => string | null): void {
  getAccessToken = getter;
}

/**
 * Get authorization headers if a token is available
 */
function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = getAccessToken?.();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

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
  const response = await fetch(`${API_BASE_URL}/api/composite/generate-nchannel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify(request),
    signal: abortSignal,
  });

  if (!response.ok) {
    throw await ApiError.fromResponse(response);
  }

  return response.blob();
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
  backgroundNeutralization?: boolean
): Promise<Blob> {
  const request: NChannelCompositeRequest = {
    channels,
    overall,
    backgroundNeutralization,
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
  backgroundNeutralization?: boolean
): Promise<Blob> {
  const request: NChannelCompositeRequest = {
    channels,
    overall,
    backgroundNeutralization,
    outputFormat: format,
    quality,
    width,
    height,
  };

  return generateNChannelComposite(request, abortSignal);
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

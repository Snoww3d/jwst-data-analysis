/**
 * Service for RGB composite generation API calls
 */

import { API_BASE_URL } from '../config/api';
import { ApiError } from './ApiError';
import { CompositeRequest, ChannelConfig } from '../types/CompositeTypes';

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
 * Generate an RGB composite image from 3 FITS files
 *
 * @param request - Composite configuration with channel settings
 * @param abortSignal - Optional AbortSignal for cancellation
 * @returns Promise resolving to image Blob
 */
export async function generateComposite(
  request: CompositeRequest,
  abortSignal?: AbortSignal
): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}/composite/generate`, {
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
 * Generate a preview composite (smaller size for faster response)
 *
 * @param red - Red channel configuration
 * @param green - Green channel configuration
 * @param blue - Blue channel configuration
 * @param previewSize - Size for preview (default 800)
 * @param abortSignal - Optional AbortSignal for cancellation
 * @returns Promise resolving to image Blob
 */
export async function generatePreview(
  red: ChannelConfig,
  green: ChannelConfig,
  blue: ChannelConfig,
  previewSize: number = 800,
  abortSignal?: AbortSignal
): Promise<Blob> {
  const request: CompositeRequest = {
    red,
    green,
    blue,
    outputFormat: 'jpeg', // Use JPEG for faster preview
    quality: 85,
    width: previewSize,
    height: previewSize,
  };

  return generateComposite(request, abortSignal);
}

/**
 * Export the final composite with user-specified options
 *
 * @param red - Red channel configuration
 * @param green - Green channel configuration
 * @param blue - Blue channel configuration
 * @param format - Output format (png or jpeg)
 * @param quality - Quality for JPEG (1-100)
 * @param width - Output width
 * @param height - Output height
 * @param abortSignal - Optional AbortSignal for cancellation
 * @returns Promise resolving to image Blob
 */
export async function exportComposite(
  red: ChannelConfig,
  green: ChannelConfig,
  blue: ChannelConfig,
  format: 'png' | 'jpeg',
  quality: number,
  width: number,
  height: number,
  abortSignal?: AbortSignal
): Promise<Blob> {
  const request: CompositeRequest = {
    red,
    green,
    blue,
    outputFormat: format,
    quality,
    width,
    height,
  };

  return generateComposite(request, abortSignal);
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
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
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

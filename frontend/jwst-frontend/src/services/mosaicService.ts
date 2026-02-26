/**
 * Service for WCS mosaic generation API calls
 */

import { API_BASE_URL } from '../config/api';
import { ApiError } from './ApiError';
import {
  MosaicRequest,
  MosaicLimits,
  FootprintResponse,
  SavedMosaicResponse,
} from '../types/MosaicTypes';

// Token getter - will be set by the auth context
let getAccessToken: (() => string | null) | null = null;

// Storage keys matching AuthContext
const STORAGE_KEYS = {
  ACCESS_TOKEN: 'jwst_auth_token',
};

/**
 * Set the function used to retrieve the current access token.
 * Called by AuthContext to enable automatic auth header injection.
 */
export function setMosaicTokenGetter(getter: () => string | null): void {
  getAccessToken = getter;
}

/**
 * Get authorization headers if a token is available
 */
function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = getAccessToken?.() || localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Generate a WCS mosaic image from 2+ FITS files
 *
 * @param request - Mosaic configuration with file settings
 * @param abortSignal - Optional AbortSignal for cancellation
 * @returns Promise resolving to image Blob
 */
export async function generateMosaic(
  request: MosaicRequest,
  abortSignal?: AbortSignal
): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}/api/mosaic/generate`, {
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
 * Generate a FITS mosaic and persist it directly in the data library.
 */
export async function generateAndSaveMosaic(
  request: MosaicRequest,
  abortSignal?: AbortSignal
): Promise<SavedMosaicResponse> {
  const response = await fetch(`${API_BASE_URL}/api/mosaic/generate-and-save`, {
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

  return response.json();
}

/**
 * Get mosaic processing limits for the current user.
 * Limits may vary by user role.
 */
export async function getLimits(): Promise<MosaicLimits> {
  const response = await fetch(`${API_BASE_URL}/api/mosaic/limits`, {
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    throw await ApiError.fromResponse(response);
  }

  return response.json();
}

/**
 * Get WCS footprints for FITS files (preview coverage before generating)
 *
 * @param dataIds - Array of data IDs to compute footprints for
 * @param abortSignal - Optional AbortSignal for cancellation
 * @returns Promise resolving to footprint data with corner coordinates and bounding box
 */
export async function getFootprints(
  dataIds: string[],
  abortSignal?: AbortSignal
): Promise<FootprintResponse> {
  const response = await fetch(`${API_BASE_URL}/api/mosaic/footprint`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ dataIds }),
    signal: abortSignal,
  });

  if (!response.ok) {
    throw await ApiError.fromResponse(response);
  }

  return response.json();
}

/**
 * Export a mosaic image asynchronously via the background queue.
 * Returns a job ID for tracking progress via SignalR or polling.
 */
export async function exportMosaicAsync(request: MosaicRequest): Promise<{ jobId: string }> {
  const response = await fetch(`${API_BASE_URL}/api/mosaic/export`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw await ApiError.fromResponse(response);
  }

  return response.json();
}

/**
 * Save a FITS mosaic to the data library asynchronously via the background queue.
 * Returns a job ID for tracking progress. On completion the job result contains
 * the saved data record ID (accessible via job.resultDataId).
 */
export async function saveMosaicAsync(request: MosaicRequest): Promise<{ jobId: string }> {
  const response = await fetch(`${API_BASE_URL}/api/mosaic/save`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw await ApiError.fromResponse(response);
  }

  return response.json();
}

/**
 * Get the current access token (exposed for result download).
 */
export function getMosaicToken(): string | null {
  return getAccessToken?.() || localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
}

/**
 * Download a mosaic image as a file
 *
 * @param blob - The image blob to download
 * @param filename - Name for the downloaded file
 */
export function downloadMosaic(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();

  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 100);
}

/**
 * Generate a default filename for the mosaic
 *
 * @param format - Output format
 * @returns Filename with timestamp
 */
export function generateMosaicFilename(format: 'png' | 'jpeg' | 'fits'): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const ext = format === 'jpeg' ? 'jpg' : format;
  return `jwst-mosaic-${timestamp}.${ext}`;
}

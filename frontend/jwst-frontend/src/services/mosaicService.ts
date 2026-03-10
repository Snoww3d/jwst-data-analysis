/**
 * Service for WCS mosaic generation API calls
 *
 * All requests route through apiClient for automatic token refresh,
 * 401 retry, and pre-request freshness checks.
 */

import { apiClient } from './apiClient';
import {
  MosaicRequest,
  MosaicLimits,
  FootprintResponse,
  SavedMosaicResponse,
} from '../types/MosaicTypes';

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
  return apiClient.postBlob('/api/mosaic/generate', request, { signal: abortSignal });
}

/**
 * Generate a FITS mosaic and persist it directly in the data library.
 */
export async function generateAndSaveMosaic(
  request: MosaicRequest,
  abortSignal?: AbortSignal
): Promise<SavedMosaicResponse> {
  return apiClient.post<SavedMosaicResponse>('/api/mosaic/generate-and-save', request, {
    signal: abortSignal,
  });
}

/**
 * Get mosaic processing limits for the current user.
 * Limits may vary by user role.
 */
export async function getLimits(): Promise<MosaicLimits> {
  return apiClient.get<MosaicLimits>('/api/mosaic/limits');
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
  return apiClient.post<FootprintResponse>(
    '/api/mosaic/footprint',
    { dataIds },
    {
      signal: abortSignal,
    }
  );
}

/**
 * Export a mosaic image asynchronously via the background queue.
 * Returns a job ID for tracking progress via SignalR or polling.
 */
export async function exportMosaicAsync(request: MosaicRequest): Promise<{ jobId: string }> {
  return apiClient.post<{ jobId: string }>('/api/mosaic/export', request);
}

/**
 * Save a FITS mosaic to the data library asynchronously via the background queue.
 * Returns a job ID for tracking progress. On completion the job result contains
 * the saved data record ID (accessible via job.resultDataId).
 */
export async function saveMosaicAsync(request: MosaicRequest): Promise<{ jobId: string }> {
  return apiClient.post<{ jobId: string }>('/api/mosaic/save', request);
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

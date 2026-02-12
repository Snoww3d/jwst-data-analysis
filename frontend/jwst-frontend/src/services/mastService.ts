/**
 * Service for MAST (Mikulski Archive for Space Telescopes) operations
 *
 * Handles all API calls related to MAST including:
 * - Search operations (by target, coordinates, observation ID, program ID)
 * - Import operations
 * - Progress tracking
 * - Resume/cancel operations
 */

import { apiClient } from './apiClient';
import {
  MastSearchResponse,
  MastRecentReleasesRequest,
  ImportJobStartResponse,
  ImportJobStatus,
  ResumableJobsResponse,
} from '../types/MastTypes';
import { MetadataRefreshAllResponse } from '../types/JwstDataTypes';
import { getCached, getStale, setCache } from '../utils/cacheUtils';

const WHATS_NEW_TTL_MS = 15 * 60 * 1000; // 15 minutes

export interface RecentReleasesOptions {
  skipCache?: boolean;
  onStaleData?: (data: MastSearchResponse) => void;
}

export interface SearchByTargetParams {
  targetName: string;
  radius?: number;
  calibLevel?: number[];
}

export interface SearchByCoordinatesParams {
  ra: number;
  dec: number;
  radius?: number;
  calibLevel?: number[];
}

export interface SearchByObservationParams {
  obsId: string;
  calibLevel?: number[];
}

export interface SearchByProgramParams {
  programId: string;
  calibLevel?: number[];
}

export interface StartImportParams {
  obsId: string;
  productType?: string;
  tags?: string[];
  calibLevel?: number[];
}

/**
 * Search MAST by target name
 * @param params - Target name, optional search radius, and calibration level filter
 * @param signal - Optional AbortSignal for cancellation
 */
export async function searchByTarget(
  params: SearchByTargetParams,
  signal?: AbortSignal
): Promise<MastSearchResponse> {
  return apiClient.post<MastSearchResponse>(
    '/api/mast/search/target',
    { targetName: params.targetName, radius: params.radius, calibLevel: params.calibLevel },
    { signal }
  );
}

/**
 * Search MAST by coordinates (RA/Dec)
 * @param params - RA, Dec coordinates, optional search radius, and calibration level filter
 * @param signal - Optional AbortSignal for cancellation
 */
export async function searchByCoordinates(
  params: SearchByCoordinatesParams,
  signal?: AbortSignal
): Promise<MastSearchResponse> {
  return apiClient.post<MastSearchResponse>(
    '/api/mast/search/coordinates',
    { ra: params.ra, dec: params.dec, radius: params.radius, calibLevel: params.calibLevel },
    { signal }
  );
}

/**
 * Search MAST by observation ID
 * @param params - Observation ID and optional calibration level filter
 * @param signal - Optional AbortSignal for cancellation
 */
export async function searchByObservation(
  params: SearchByObservationParams,
  signal?: AbortSignal
): Promise<MastSearchResponse> {
  return apiClient.post<MastSearchResponse>(
    '/api/mast/search/observation',
    { obsId: params.obsId, calibLevel: params.calibLevel },
    { signal }
  );
}

/**
 * Search MAST by program ID
 * @param params - Program ID and optional calibration level filter
 * @param signal - Optional AbortSignal for cancellation
 */
export async function searchByProgram(
  params: SearchByProgramParams,
  signal?: AbortSignal
): Promise<MastSearchResponse> {
  return apiClient.post<MastSearchResponse>(
    '/api/mast/search/program',
    { programId: params.programId, calibLevel: params.calibLevel },
    { signal }
  );
}

/**
 * Get recently released JWST observations ("What's New")
 * @param params - Days back, optional instrument filter, pagination
 * @param signal - Optional AbortSignal for cancellation
 * @param options - Cache options (skipCache, onStaleData callback)
 */
export async function getRecentReleases(
  params: MastRecentReleasesRequest = {},
  signal?: AbortSignal,
  options?: RecentReleasesOptions
): Promise<MastSearchResponse> {
  const daysBack = params.daysBack ?? 30;
  const instrument = params.instrument || 'all';
  const offset = params.offset ?? 0;
  const cacheKey = `whats_new:${daysBack}:${instrument}:${offset}`;

  if (!options?.skipCache) {
    const fresh = getCached<MastSearchResponse>(cacheKey, WHATS_NEW_TTL_MS);
    if (fresh) return fresh;

    const stale = getStale<MastSearchResponse>(cacheKey);
    if (stale) {
      options?.onStaleData?.(stale);
    }
  }

  const data = await apiClient.post<MastSearchResponse>(
    '/api/mast/whats-new',
    {
      daysBack,
      instrument: params.instrument,
      limit: params.limit ?? 50,
      offset,
    },
    { signal }
  );

  setCache(cacheKey, data);
  return data;
}

/**
 * Start a MAST import job
 * @param params - Import parameters (obsId, productType, tags)
 */
export async function startImport(params: StartImportParams): Promise<ImportJobStartResponse> {
  return apiClient.post<ImportJobStartResponse>('/api/mast/import', {
    obsId: params.obsId,
    productType: params.productType || 'SCIENCE',
    tags: params.tags || ['mast-import'],
    calibLevel: params.calibLevel,
  });
}

/**
 * Get import job progress
 * @param jobId - The job ID to get progress for
 */
export async function getImportProgress(jobId: string): Promise<ImportJobStatus> {
  return apiClient.get<ImportJobStatus>(`/api/mast/import-progress/${jobId}`);
}

/**
 * Cancel an import job
 * @param jobId - The job ID to cancel
 */
export async function cancelImport(jobId: string): Promise<void> {
  return apiClient.post<void>(`/api/mast/import/cancel/${jobId}`);
}

/**
 * Resume a paused/failed import job
 * @param jobId - The job ID to resume
 */
export async function resumeImport(jobId: string): Promise<ImportJobStatus> {
  return apiClient.post<ImportJobStatus>(`/api/mast/import/resume/${jobId}`);
}

/**
 * Import from files that already exist on disk
 * @param obsId - The observation ID to import
 */
export async function importFromExisting(obsId: string): Promise<ImportJobStartResponse> {
  return apiClient.post<ImportJobStartResponse>(`/api/mast/import/from-existing/${obsId}`);
}

/**
 * Get resumable (incomplete/failed) import jobs
 */
export async function getResumableImports(): Promise<ResumableJobsResponse> {
  return apiClient.get<ResumableJobsResponse>('/api/mast/import/resumable');
}

/**
 * Dismiss a resumable download, optionally deleting downloaded files
 */
export async function dismissResumableImport(
  jobId: string,
  deleteFiles: boolean = false
): Promise<{ jobId: string; dismissed: boolean }> {
  return apiClient.delete<{ jobId: string; dismissed: boolean }>(
    `/api/mast/import/resumable/${jobId}?deleteFiles=${deleteFiles}`
  );
}

/**
 * Refresh metadata for all MAST imports
 * Re-fetches metadata from MAST for all imported observations
 */
export async function refreshMetadataAll(): Promise<MetadataRefreshAllResponse> {
  return apiClient.post<MetadataRefreshAllResponse>('/api/mast/refresh-metadata-all');
}

// Export as named object for convenience
export const mastService = {
  searchByTarget,
  searchByCoordinates,
  searchByObservation,
  searchByProgram,
  getRecentReleases,
  startImport,
  getImportProgress,
  cancelImport,
  resumeImport,
  getResumableImports,
  dismissResumableImport,
  importFromExisting,
  refreshMetadataAll,
};

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
  JobStartResponse,
  ImportJobStatus,
  ResumableJobsResponse,
} from '../types/MastTypes';
import { MetadataRefreshAllResponse } from '../types/JwstDataTypes';
import { getCached, getStale, setCache } from '../utils/cacheUtils';

const WHATS_NEW_TTL_MS = 15 * 60 * 1000; // 15 minutes
const SEARCH_CACHE_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours

export interface RecentReleasesOptions {
  skipCache?: boolean;
  onStaleData?: (data: MastSearchResponse) => void;
}

export interface SearchCacheOptions {
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

export type DownloadSource = 'auto' | 's3' | 'http';

export interface StartImportParams {
  obsId: string;
  productType?: string;
  tags?: string[];
  calibLevel?: number[];
  downloadSource?: DownloadSource;
}

// Prefix bumped v1 → v2 with MAST Search v2 Phase 0: the cone search is now
// cos(dec)-corrected and post-filtered, so results cached under the old key
// describe a different (wrong) sky region.
const SEARCH_CACHE_PREFIX = 'mast_search_v2:';

function calibKey(calibLevel?: number[]): string {
  return calibLevel?.join(',') ?? 'all';
}

/**
 * Run a search through the 48 h localStorage cache: fresh hit → return it;
 * stale hit → hand it to `onStaleData` and revalidate; miss → fetch. Every
 * param that changes the query must be in `cacheKey`.
 */
async function cachedSearch(
  cacheKey: string,
  fetcher: () => Promise<MastSearchResponse>,
  options?: SearchCacheOptions
): Promise<MastSearchResponse> {
  if (!options?.skipCache) {
    const fresh = getCached<MastSearchResponse>(cacheKey, SEARCH_CACHE_TTL_MS);
    if (fresh) return fresh;

    const stale = getStale<MastSearchResponse>(cacheKey);
    if (stale) {
      options?.onStaleData?.(stale);
    }
  }

  const data = await fetcher();
  setCache(cacheKey, data);
  return data;
}

/**
 * Search MAST by target name
 * @param params - Target name, optional search radius, and calibration level filter
 * @param signal - Optional AbortSignal for cancellation
 * @param options - Cache options (skipCache, onStaleData callback)
 */
export async function searchByTarget(
  params: SearchByTargetParams,
  signal?: AbortSignal,
  options?: SearchCacheOptions
): Promise<MastSearchResponse> {
  const cacheKey = `${SEARCH_CACHE_PREFIX}target:${params.targetName.toLowerCase()}:${params.radius ?? 'default'}:${calibKey(params.calibLevel)}`;
  return cachedSearch(
    cacheKey,
    () =>
      apiClient.post<MastSearchResponse>(
        '/api/mast/search/target',
        { targetName: params.targetName, radius: params.radius, calibLevel: params.calibLevel },
        { signal }
      ),
    options
  );
}

/**
 * Search MAST by coordinates (RA/Dec)
 * @param params - RA, Dec coordinates, optional search radius, and calibration level filter
 * @param signal - Optional AbortSignal for cancellation
 * @param options - Cache options (skipCache, onStaleData callback)
 */
export async function searchByCoordinates(
  params: SearchByCoordinatesParams,
  signal?: AbortSignal,
  options?: SearchCacheOptions
): Promise<MastSearchResponse> {
  const cacheKey = `${SEARCH_CACHE_PREFIX}coords:${params.ra}:${params.dec}:${params.radius ?? 'default'}:${calibKey(params.calibLevel)}`;
  return cachedSearch(
    cacheKey,
    () =>
      apiClient.post<MastSearchResponse>(
        '/api/mast/search/coordinates',
        { ra: params.ra, dec: params.dec, radius: params.radius, calibLevel: params.calibLevel },
        { signal }
      ),
    options
  );
}

/**
 * Search MAST by observation ID
 * @param params - Observation ID and optional calibration level filter
 * @param signal - Optional AbortSignal for cancellation
 * @param options - Cache options (skipCache, onStaleData callback)
 */
export async function searchByObservation(
  params: SearchByObservationParams,
  signal?: AbortSignal,
  options?: SearchCacheOptions
): Promise<MastSearchResponse> {
  const cacheKey = `${SEARCH_CACHE_PREFIX}obs:${params.obsId.toLowerCase()}:${calibKey(params.calibLevel)}`;
  return cachedSearch(
    cacheKey,
    () =>
      apiClient.post<MastSearchResponse>(
        '/api/mast/search/observation',
        { obsId: params.obsId, calibLevel: params.calibLevel },
        { signal }
      ),
    options
  );
}

/**
 * Search MAST by program ID
 * @param params - Program ID and optional calibration level filter
 * @param signal - Optional AbortSignal for cancellation
 * @param options - Cache options (skipCache, onStaleData callback)
 */
export async function searchByProgram(
  params: SearchByProgramParams,
  signal?: AbortSignal,
  options?: SearchCacheOptions
): Promise<MastSearchResponse> {
  const cacheKey = `${SEARCH_CACHE_PREFIX}program:${params.programId}:${calibKey(params.calibLevel)}`;
  return cachedSearch(
    cacheKey,
    () =>
      apiClient.post<MastSearchResponse>(
        '/api/mast/search/program',
        { programId: params.programId, calibLevel: params.calibLevel },
        { signal }
      ),
    options
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
export async function startImport(params: StartImportParams): Promise<JobStartResponse> {
  return apiClient.post<JobStartResponse>('/api/mast/import', {
    obsId: params.obsId,
    productType: params.productType || 'SCIENCE',
    tags: params.tags || ['mast-import'],
    calibLevel: params.calibLevel,
    downloadSource: params.downloadSource || 'auto',
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
export async function importFromExisting(obsId: string): Promise<JobStartResponse> {
  return apiClient.post<JobStartResponse>(`/api/mast/import/from-existing/${obsId}`);
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

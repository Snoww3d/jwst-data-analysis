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
  ImportJobStartResponse,
  ImportJobStatus,
} from '../types/MastTypes';
import { MetadataRefreshAllResponse } from '../types/JwstDataTypes';

export interface SearchByTargetParams {
  targetName: string;
  radius?: number;
}

export interface SearchByCoordinatesParams {
  ra: number;
  dec: number;
  radius?: number;
}

export interface SearchByObservationParams {
  obsId: string;
}

export interface SearchByProgramParams {
  programId: string;
}

export interface StartImportParams {
  obsId: string;
  productType?: string;
  tags?: string[];
}

/**
 * Search MAST by target name
 * @param params - Target name and optional search radius
 * @param signal - Optional AbortSignal for cancellation
 */
export async function searchByTarget(
  params: SearchByTargetParams,
  signal?: AbortSignal
): Promise<MastSearchResponse> {
  return apiClient.post<MastSearchResponse>(
    '/api/mast/search/target',
    { targetName: params.targetName, radius: params.radius },
    { signal }
  );
}

/**
 * Search MAST by coordinates (RA/Dec)
 * @param params - RA, Dec coordinates and optional search radius
 * @param signal - Optional AbortSignal for cancellation
 */
export async function searchByCoordinates(
  params: SearchByCoordinatesParams,
  signal?: AbortSignal
): Promise<MastSearchResponse> {
  return apiClient.post<MastSearchResponse>(
    '/api/mast/search/coordinates',
    { ra: params.ra, dec: params.dec, radius: params.radius },
    { signal }
  );
}

/**
 * Search MAST by observation ID
 * @param params - Observation ID
 * @param signal - Optional AbortSignal for cancellation
 */
export async function searchByObservation(
  params: SearchByObservationParams,
  signal?: AbortSignal
): Promise<MastSearchResponse> {
  return apiClient.post<MastSearchResponse>(
    '/api/mast/search/observation',
    { obsId: params.obsId },
    { signal }
  );
}

/**
 * Search MAST by program ID
 * @param params - Program ID
 * @param signal - Optional AbortSignal for cancellation
 */
export async function searchByProgram(
  params: SearchByProgramParams,
  signal?: AbortSignal
): Promise<MastSearchResponse> {
  return apiClient.post<MastSearchResponse>(
    '/api/mast/search/program',
    { programId: params.programId },
    { signal }
  );
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
  startImport,
  getImportProgress,
  cancelImport,
  resumeImport,
  importFromExisting,
  refreshMetadataAll,
};

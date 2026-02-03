/**
 * Service for JWST data operations
 *
 * Handles all API calls related to JWST data including:
 * - Fetching data list
 * - File uploads
 * - Processing operations
 * - Archive/unarchive
 * - Delete operations
 */

import { apiClient } from './apiClient';
import {
  JwstDataModel,
  DeleteObservationResponse,
  DeleteLevelResponse,
  ArchiveLevelResponse,
  BulkImportResponse,
  PixelDataResponse,
  CubeInfoResponse,
} from '../types/JwstDataTypes';

export interface ProcessingResponse {
  status: string;
  dataId: string;
  algorithm: string;
  message?: string;
}

export interface UploadResponse {
  id: string;
  fileName: string;
  message?: string;
}

/**
 * Fetch all JWST data records
 * @param includeArchived - Whether to include archived records (default: false)
 */
export async function getAll(includeArchived: boolean = false): Promise<JwstDataModel[]> {
  return apiClient.get<JwstDataModel[]>(`/api/jwstdata?includeArchived=${includeArchived}`);
}

/**
 * Upload a new JWST data file
 * @param file - The file to upload
 * @param dataType - Type of data (image, sensor, spectral, etc.)
 * @param description - Optional description
 * @param tags - Optional tags
 */
export async function upload(
  file: File,
  dataType: string,
  description?: string,
  tags?: string[]
): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append('File', file);
  formData.append('DataType', dataType);
  if (description) {
    formData.append('Description', description);
  }
  if (tags && tags.length > 0) {
    tags.forEach((tag) => formData.append('Tags', tag));
  }

  return apiClient.postFormData<UploadResponse>('/api/jwstdata/upload', formData);
}

/**
 * Trigger processing on a data record
 * @param dataId - ID of the data record to process
 * @param algorithm - Algorithm to use (basic_analysis, image_enhancement, noise_reduction)
 * @param parameters - Optional algorithm parameters
 */
export async function process(
  dataId: string,
  algorithm: string,
  parameters: Record<string, unknown> = {}
): Promise<ProcessingResponse> {
  return apiClient.post<ProcessingResponse>(`/api/jwstdata/${dataId}/process`, {
    algorithm,
    parameters,
  });
}

/**
 * Archive a data record
 * @param dataId - ID of the data record to archive
 */
export async function archive(dataId: string): Promise<void> {
  return apiClient.post<void>(`/api/jwstdata/${dataId}/archive`);
}

/**
 * Unarchive a data record
 * @param dataId - ID of the data record to unarchive
 */
export async function unarchive(dataId: string): Promise<void> {
  return apiClient.post<void>(`/api/jwstdata/${dataId}/unarchive`);
}

/**
 * Delete preview for an observation (shows what would be deleted)
 * @param observationBaseId - The observation ID to delete
 */
export async function getDeletePreview(
  observationBaseId: string
): Promise<DeleteObservationResponse> {
  return apiClient.delete<DeleteObservationResponse>(
    `/api/jwstdata/observation/${encodeURIComponent(observationBaseId)}`
  );
}

/**
 * Confirm deletion of an observation and all its files
 * @param observationBaseId - The observation ID to delete
 */
export async function deleteObservation(
  observationBaseId: string
): Promise<DeleteObservationResponse> {
  return apiClient.delete<DeleteObservationResponse>(
    `/api/jwstdata/observation/${encodeURIComponent(observationBaseId)}?confirm=true`
  );
}

/**
 * Scan and import MAST files from disk
 */
export async function scanAndImportMastFiles(): Promise<BulkImportResponse> {
  return apiClient.post<BulkImportResponse>('/api/datamanagement/import/scan', {});
}

/**
 * Preview deletion of files at a specific processing level
 * @param observationBaseId - The observation ID
 * @param processingLevel - The processing level (L1, L2a, L2b, L3)
 */
export async function getDeleteLevelPreview(
  observationBaseId: string,
  processingLevel: string
): Promise<DeleteLevelResponse> {
  return apiClient.delete<DeleteLevelResponse>(
    `/api/jwstdata/observation/${encodeURIComponent(observationBaseId)}/level/${encodeURIComponent(processingLevel)}`
  );
}

/**
 * Confirm deletion of files at a specific processing level
 * @param observationBaseId - The observation ID
 * @param processingLevel - The processing level (L1, L2a, L2b, L3)
 */
export async function deleteObservationLevel(
  observationBaseId: string,
  processingLevel: string
): Promise<DeleteLevelResponse> {
  return apiClient.delete<DeleteLevelResponse>(
    `/api/jwstdata/observation/${encodeURIComponent(observationBaseId)}/level/${encodeURIComponent(processingLevel)}?confirm=true`
  );
}

/**
 * Archive all files at a specific processing level
 * @param observationBaseId - The observation ID
 * @param processingLevel - The processing level (L1, L2a, L2b, L3)
 */
export async function archiveObservationLevel(
  observationBaseId: string,
  processingLevel: string
): Promise<ArchiveLevelResponse> {
  return apiClient.post<ArchiveLevelResponse>(
    `/api/jwstdata/observation/${encodeURIComponent(observationBaseId)}/level/${encodeURIComponent(processingLevel)}/archive`
  );
}

/**
 * Get pixel data array for hover coordinate display
 * @param dataId - ID of the data record
 * @param maxSize - Maximum dimension for downsampling (default: 1200)
 * @param sliceIndex - For 3D cubes, which slice to use (-1 = middle)
 */
export async function getPixelData(
  dataId: string,
  maxSize: number = 1200,
  sliceIndex: number = -1
): Promise<PixelDataResponse> {
  return apiClient.get<PixelDataResponse>(
    `/api/jwstdata/${dataId}/pixeldata?maxSize=${maxSize}&sliceIndex=${sliceIndex}`
  );
}

/**
 * Get 3D cube metadata for navigating data cubes
 * @param dataId - ID of the data record
 * @returns Cube info including slice count, WCS info, and axis labels
 */
export async function getCubeInfo(dataId: string): Promise<CubeInfoResponse> {
  return apiClient.get<CubeInfoResponse>(`/api/jwstdata/${dataId}/cubeinfo`);
}

// Export as named object for convenience
export const jwstDataService = {
  getAll,
  upload,
  process,
  archive,
  unarchive,
  getDeletePreview,
  deleteObservation,
  getDeleteLevelPreview,
  deleteObservationLevel,
  archiveObservationLevel,
  scanAndImportMastFiles,
  getPixelData,
  getCubeInfo,
};

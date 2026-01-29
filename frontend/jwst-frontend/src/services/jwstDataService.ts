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
  BulkImportResponse,
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
    tags.forEach(tag => formData.append('Tags', tag));
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
export async function getDeletePreview(observationBaseId: string): Promise<DeleteObservationResponse> {
  return apiClient.delete<DeleteObservationResponse>(
    `/api/jwstdata/observation/${encodeURIComponent(observationBaseId)}`
  );
}

/**
 * Confirm deletion of an observation and all its files
 * @param observationBaseId - The observation ID to delete
 */
export async function deleteObservation(observationBaseId: string): Promise<DeleteObservationResponse> {
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

// Export as named object for convenience
export const jwstDataService = {
  getAll,
  upload,
  process,
  archive,
  unarchive,
  getDeletePreview,
  deleteObservation,
  scanAndImportMastFiles,
};

/**
 * Service for image analysis operations.
 */

import { apiClient } from './apiClient';
import type {
  RegionStatisticsRequest,
  RegionStatisticsResponse,
  SourceDetectionRequest,
  SourceDetectionResponse,
  TableInfoResponse,
  TableDataResponse,
} from '../types/AnalysisTypes';

/**
 * Compute statistics for a selected region within a FITS image.
 */
export async function getRegionStatistics(
  request: RegionStatisticsRequest
): Promise<RegionStatisticsResponse> {
  return apiClient.post<RegionStatisticsResponse>('/api/analysis/region-statistics', request);
}

/**
 * Detect astronomical sources in a FITS image.
 */
export async function detectSources(
  request: SourceDetectionRequest
): Promise<SourceDetectionResponse> {
  return apiClient.post<SourceDetectionResponse>('/api/analysis/detect-sources', request);
}

/**
 * Get table HDU information from a FITS file.
 */
export async function getTableInfo(dataId: string): Promise<TableInfoResponse> {
  return apiClient.get<TableInfoResponse>(
    `/api/analysis/table-info?dataId=${encodeURIComponent(dataId)}`
  );
}

/**
 * Get paginated table data from a specific HDU.
 */
export async function getTableData(params: {
  dataId: string;
  hduIndex?: number;
  page?: number;
  pageSize?: number;
  sortColumn?: string | null;
  sortDirection?: string | null;
  search?: string;
}): Promise<TableDataResponse> {
  const query = new URLSearchParams();
  query.set('dataId', params.dataId);
  if (params.hduIndex !== undefined) query.set('hduIndex', params.hduIndex.toString());
  if (params.page !== undefined) query.set('page', params.page.toString());
  if (params.pageSize !== undefined) query.set('pageSize', params.pageSize.toString());
  if (params.sortColumn) query.set('sortColumn', params.sortColumn);
  if (params.sortDirection) query.set('sortDirection', params.sortDirection);
  if (params.search) query.set('search', params.search);
  return apiClient.get<TableDataResponse>(`/api/analysis/table-data?${query.toString()}`);
}

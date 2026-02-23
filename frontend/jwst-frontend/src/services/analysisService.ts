/**
 * Service for image analysis operations.
 */

import { apiClient } from './apiClient';
import type {
  RegionStatisticsRequest,
  RegionStatisticsResponse,
  SourceDetectionRequest,
  SourceDetectionResponse,
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

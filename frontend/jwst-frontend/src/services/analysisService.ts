/**
 * Service for image analysis operations.
 */

import { apiClient } from './apiClient';
import type { RegionStatisticsRequest, RegionStatisticsResponse } from '../types/AnalysisTypes';

/**
 * Compute statistics for a selected region within a FITS image.
 */
export async function getRegionStatistics(
  request: RegionStatisticsRequest
): Promise<RegionStatisticsResponse> {
  return apiClient.post<RegionStatisticsResponse>('/api/analysis/region-statistics', request);
}

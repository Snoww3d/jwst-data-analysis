/**
 * Service for Semantic Search API endpoints
 */

import { apiClient } from './apiClient';
import type {
  SemanticSearchResponse,
  IndexStatusResponse,
  ReindexResponse,
} from '../types/SearchTypes';

/**
 * Search FITS files using natural language queries.
 */
export async function semanticSearch(
  query: string,
  topK: number = 20,
  minScore: number = 0.3,
  signal?: AbortSignal
): Promise<SemanticSearchResponse> {
  const params = new URLSearchParams({
    q: query,
    topK: String(topK),
    minScore: String(minScore),
  });
  return apiClient.get<SemanticSearchResponse>(`/api/search/semantic?${params}`, { signal });
}

/**
 * Get the status of the semantic search index.
 */
export async function getIndexStatus(signal?: AbortSignal): Promise<IndexStatusResponse> {
  return apiClient.get<IndexStatusResponse>('/api/search/index-status', { signal });
}

/**
 * Trigger a full re-index of the semantic search index (admin only).
 */
export async function triggerReindex(signal?: AbortSignal): Promise<ReindexResponse> {
  return apiClient.post<ReindexResponse>('/api/search/reindex', undefined, { signal });
}

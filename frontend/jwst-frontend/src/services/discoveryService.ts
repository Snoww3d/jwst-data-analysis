/**
 * Service for Discovery API endpoints
 *
 * Handles featured targets and recipe suggestions.
 */

import { apiClient } from './apiClient';
import { getCached, getStale, setCache } from '../utils/cacheUtils';
import type {
  FeaturedTargetsResponse,
  SuggestRecipesRequest,
  SuggestRecipesResponse,
} from '../types/DiscoveryTypes';

const RECIPE_CACHE_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours
const RECIPE_CACHE_VERSION = 4; // Bumped: v3 had c-prefix obs_ids from unreliable dedup

export interface RecipeCacheOptions {
  skipCache?: boolean;
  onStaleData?: (data: SuggestRecipesResponse) => void;
}

/**
 * Fetch featured targets for the discovery home page.
 * @param signal - Optional AbortSignal for cancellation
 */
export async function getFeaturedTargets(signal?: AbortSignal): Promise<FeaturedTargetsResponse> {
  return apiClient.get<FeaturedTargetsResponse>('/api/discovery/featured', { signal });
}

/**
 * Get composite recipe suggestions for a set of observations.
 * @param request - Target name and observations to generate recipes from
 * @param signal - Optional AbortSignal for cancellation
 * @param options - Cache options (skipCache, onStaleData callback)
 */
export async function suggestRecipes(
  request: SuggestRecipesRequest,
  signal?: AbortSignal,
  options?: RecipeCacheOptions
): Promise<SuggestRecipesResponse> {
  const sortedObsIds = (request.observations || [])
    .map((o) => o.observationId ?? `${o.instrument}:${o.filter}`)
    .sort()
    .join(',');
  const cacheKey = `recipes:v${RECIPE_CACHE_VERSION}:${(request.targetName ?? '').toLowerCase()}:${sortedObsIds}`;

  if (!options?.skipCache) {
    const fresh = getCached<SuggestRecipesResponse>(cacheKey, RECIPE_CACHE_TTL_MS);
    if (fresh) return fresh;

    const stale = getStale<SuggestRecipesResponse>(cacheKey);
    if (stale) {
      options?.onStaleData?.(stale);
    }
  }

  const data = await apiClient.post<SuggestRecipesResponse>(
    '/api/discovery/suggest-recipes',
    request,
    { signal }
  );

  setCache(cacheKey, data);
  return data;
}

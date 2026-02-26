/**
 * Service for Discovery API endpoints
 *
 * Handles featured targets and recipe suggestions.
 */

import { apiClient } from './apiClient';
import type {
  FeaturedTargetsResponse,
  SuggestRecipesRequest,
  SuggestRecipesResponse,
} from '../types/DiscoveryTypes';

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
 */
export async function suggestRecipes(
  request: SuggestRecipesRequest,
  signal?: AbortSignal
): Promise<SuggestRecipesResponse> {
  return apiClient.post<SuggestRecipesResponse>('/api/discovery/suggest-recipes', request, {
    signal,
  });
}

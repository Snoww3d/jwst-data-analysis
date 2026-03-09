/**
 * Unit tests for discoveryService
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./apiClient', () => ({
  apiClient: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));

vi.mock('../utils/cacheUtils', () => ({
  getCached: vi.fn().mockReturnValue(null),
  getStale: vi.fn().mockReturnValue(null),
  setCache: vi.fn(),
}));

import { apiClient } from './apiClient';
import { getCached, getStale, setCache } from '../utils/cacheUtils';
import { getFeaturedTargets, suggestRecipes } from './discoveryService';

describe('discoveryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCached).mockReturnValue(null);
    vi.mocked(getStale).mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getFeaturedTargets', () => {
    it('should GET /api/discovery/featured', async () => {
      const mockResponse = { targets: [] };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const result = await getFeaturedTargets();

      expect(apiClient.get).toHaveBeenCalledWith('/api/discovery/featured', { signal: undefined });
      expect(result).toEqual(mockResponse);
    });
  });

  describe('suggestRecipes', () => {
    const mockRequest = {
      targetName: 'M51',
      observations: [
        { filter: 'F200W', instrument: 'NIRCam', observationId: 'obs-1' },
        { filter: 'F150W', instrument: 'NIRCam', observationId: 'obs-2' },
      ],
    };

    it('should POST to /api/discovery/suggest-recipes', async () => {
      const mockResponse = { recipes: [{ name: 'RGB' }] };
      vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

      const result = await suggestRecipes(mockRequest);

      expect(apiClient.post).toHaveBeenCalledWith('/api/discovery/suggest-recipes', mockRequest, {
        signal: undefined,
      });
      expect(result).toEqual(mockResponse);
      expect(setCache).toHaveBeenCalled();
    });

    it('should return cached data when available', async () => {
      const cachedData = { recipes: [{ name: 'cached-recipe' }] };
      vi.mocked(getCached).mockReturnValue(cachedData);

      const result = await suggestRecipes(mockRequest);

      expect(result).toEqual(cachedData);
      expect(apiClient.post).not.toHaveBeenCalled();
    });

    it('should call onStaleData callback with stale data', async () => {
      const staleData = { recipes: [{ name: 'stale-recipe' }] };
      const freshData = { recipes: [{ name: 'fresh-recipe' }] };
      vi.mocked(getCached).mockReturnValue(null);
      vi.mocked(getStale).mockReturnValue(staleData);
      vi.mocked(apiClient.post).mockResolvedValue(freshData);

      const onStaleData = vi.fn();
      const result = await suggestRecipes(mockRequest, undefined, { onStaleData });

      expect(onStaleData).toHaveBeenCalledWith(staleData);
      expect(result).toEqual(freshData);
    });

    it('should skip cache when skipCache is true', async () => {
      const cachedData = { recipes: [{ name: 'cached-recipe' }] };
      const freshData = { recipes: [{ name: 'fresh-recipe' }] };
      vi.mocked(getCached).mockReturnValue(cachedData);
      vi.mocked(apiClient.post).mockResolvedValue(freshData);

      const result = await suggestRecipes(mockRequest, undefined, { skipCache: true });

      expect(getCached).not.toHaveBeenCalled();
      expect(getStale).not.toHaveBeenCalled();
      expect(result).toEqual(freshData);
    });

    it('should use sorted observation IDs in cache key', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ recipes: [] });

      // obs-2 comes before obs-1 in array, but cache key should sort them
      await suggestRecipes({
        targetName: 'M51',
        observations: [
          { filter: 'F200W', instrument: 'NIRCam', observationId: 'obs-2' },
          { filter: 'F150W', instrument: 'NIRCam', observationId: 'obs-1' },
        ],
      });

      expect(getCached).toHaveBeenCalledWith('recipes:v2:m51:obs-1,obs-2', expect.any(Number));
    });

    it('should handle observations without observationId in cache key', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ recipes: [] });

      await suggestRecipes({
        targetName: 'M51',
        observations: [
          { filter: 'F200W', instrument: 'NIRCam' },
          { filter: 'F150W', instrument: 'MIRI' },
        ],
      });

      expect(getCached).toHaveBeenCalledWith(
        'recipes:v2:m51:MIRI:F150W,NIRCam:F200W',
        expect.any(Number)
      );
    });
  });
});

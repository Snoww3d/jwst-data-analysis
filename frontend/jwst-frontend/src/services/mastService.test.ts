/**
 * Unit tests for mastService
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./apiClient', () => ({
  apiClient: {
    post: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    put: vi.fn(),
    postFormData: vi.fn(),
  },
}));

vi.mock('../utils/cacheUtils', () => ({
  getCached: vi.fn().mockReturnValue(null),
  getStale: vi.fn().mockReturnValue(null),
  setCache: vi.fn(),
}));

import { apiClient } from './apiClient';
import { getCached, getStale, setCache } from '../utils/cacheUtils';
import {
  searchByTarget,
  searchByCoordinates,
  searchByObservation,
  searchByProgram,
  searchByFacets,
  getRecentReleases,
  startImport,
  getImportProgress,
  cancelImport,
  resumeImport,
  importFromExisting,
  getResumableImports,
  dismissResumableImport,
  refreshMetadataAll,
} from './mastService';

describe('mastService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-establish default return values (clearAllMocks doesn't reset mockReturnValue)
    vi.mocked(getCached).mockReturnValue(null);
    vi.mocked(getStale).mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('searchByTarget', () => {
    it('should POST to /api/mast/search/target with params', async () => {
      const mockResponse = { results: [], totalCount: 0 };
      vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

      const result = await searchByTarget({ targetName: 'M51', radius: 0.5 });

      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/mast/search/target',
        { targetName: 'M51', radius: 0.5, calibLevel: undefined },
        { signal: undefined }
      );
      expect(result).toEqual(mockResponse);
    });

    it('should include calibLevel when provided', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({});

      await searchByTarget({ targetName: 'NGC1234', calibLevel: [2, 3] });

      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/mast/search/target',
        { targetName: 'NGC1234', radius: undefined, calibLevel: [2, 3] },
        { signal: undefined }
      );
    });

    it('should pass abort signal', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({});
      const controller = new AbortController();

      await searchByTarget({ targetName: 'M31' }, controller.signal);

      expect(apiClient.post).toHaveBeenCalledWith('/api/mast/search/target', expect.any(Object), {
        signal: controller.signal,
      });
    });

    it('should return cached data when available', async () => {
      const cachedData = { results: [{ id: 'cached' }], totalCount: 1 };
      vi.mocked(getCached).mockReturnValue(cachedData);

      const result = await searchByTarget({ targetName: 'M51' });

      expect(result).toEqual(cachedData);
      expect(apiClient.post).not.toHaveBeenCalled();
    });

    it('should call onStaleData callback with stale data', async () => {
      const staleData = { results: [{ id: 'stale' }], totalCount: 1 };
      const freshData = { results: [{ id: 'fresh' }], totalCount: 2 };
      vi.mocked(getCached).mockReturnValue(null);
      vi.mocked(getStale).mockReturnValue(staleData);
      vi.mocked(apiClient.post).mockResolvedValue(freshData);

      const onStaleData = vi.fn();
      const result = await searchByTarget({ targetName: 'M51' }, undefined, { onStaleData });

      expect(onStaleData).toHaveBeenCalledWith(staleData);
      expect(result).toEqual(freshData);
      expect(setCache).toHaveBeenCalledWith(
        'mast_search_v2:target:m51:default:all:nofilters',
        freshData
      );
    });

    it('should skip cache when skipCache is true', async () => {
      const cachedData = { results: [{ id: 'cached' }], totalCount: 1 };
      const freshData = { results: [{ id: 'fresh' }], totalCount: 2 };
      vi.mocked(getCached).mockReturnValue(cachedData);
      vi.mocked(apiClient.post).mockResolvedValue(freshData);

      const result = await searchByTarget({ targetName: 'M51' }, undefined, { skipCache: true });

      expect(getCached).not.toHaveBeenCalled();
      expect(getStale).not.toHaveBeenCalled();
      expect(result).toEqual(freshData);
    });

    it('should use correct cache key with all params', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ results: [] });

      await searchByTarget({ targetName: 'NGC 1234', radius: 0.5, calibLevel: [2, 3] });

      expect(getCached).toHaveBeenCalledWith(
        'mast_search_v2:target:ngc 1234:0.5:2,3:nofilters',
        expect.any(Number)
      );
    });
  });

  describe('filters (MAST Search v2 Phase 4)', () => {
    const filters = { intentType: ['science'], instrument_name: ['MIRI*'] };

    it('target search sends `filters` and keys the cache on them, key-sorted', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ results: [] });
      await searchByTarget({ targetName: 'M16', radius: 0.2, calibLevel: [3], filters });
      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/mast/search/target',
        { targetName: 'M16', radius: 0.2, calibLevel: [3], filters },
        { signal: undefined }
      );
      expect(getCached).toHaveBeenCalledWith(
        'mast_search_v2:target:m16:0.2:3:{"instrument_name":["MIRI*"],"intentType":["science"]}',
        expect.any(Number)
      );
    });

    it('coordinate search sends `filters` too', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ results: [] });
      await searchByCoordinates({ ra: 1, dec: 2, radius: 0.2, calibLevel: [3], filters });
      expect(vi.mocked(apiClient.post).mock.lastCall?.[1]).toMatchObject({ filters });
      expect(vi.mocked(getCached).mock.lastCall?.[0]).toContain('"instrument_name":["MIRI*"]');
    });

    it('searchByFacets POSTs to /api/mast/search/facets with a short-TTL cache key', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ results: [], default_window_applied: true });
      const data = await searchByFacets({ filters, calibLevel: [3], daysBack: 365 });
      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/mast/search/facets',
        { filters, calibLevel: [3], daysBack: 365, limit: undefined, offset: undefined },
        { signal: undefined }
      );
      expect(getCached).toHaveBeenCalledWith(
        'mast_search_v2:facets:{"instrument_name":["MIRI*"],"intentType":["science"]}:3:365:default:0',
        15 * 60 * 1000
      );
      expect(data.default_window_applied).toBe(true);
    });

    it('searchByFacets sends an empty criteria object when none are given', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ results: [] });
      await searchByFacets({});
      expect(vi.mocked(apiClient.post).mock.lastCall?.[1]).toMatchObject({ filters: {} });
      expect(vi.mocked(getCached).mock.lastCall?.[0]).toBe(
        'mast_search_v2:facets:nofilters:all:default:default:0'
      );
    });
  });

  describe('searchByCoordinates', () => {
    it('should POST to /api/mast/search/coordinates with params', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ results: [] });

      await searchByCoordinates({ ra: 180.5, dec: -45.2, radius: 1.0 });

      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/mast/search/coordinates',
        { ra: 180.5, dec: -45.2, radius: 1.0, calibLevel: undefined },
        { signal: undefined }
      );
    });

    it('caches under a key that carries every param (Phase 2: all modes cached)', async () => {
      const data = { results: [] };
      vi.mocked(apiClient.post).mockResolvedValue(data);

      await searchByCoordinates({ ra: 180.5, dec: -45.2, radius: 1.0, calibLevel: [3] });

      expect(getCached).toHaveBeenCalledWith(
        'mast_search_v2:coords:180.5:-45.2:1:3:nofilters:cone',
        expect.any(Number)
      );
      expect(setCache).toHaveBeenCalledWith(
        'mast_search_v2:coords:180.5:-45.2:1:3:nofilters:cone',
        data
      );
    });

    it("sends mode:'box' and keys the cache on it (Phase 6: draw-to-search)", async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ results: [] });

      await searchByCoordinates({ ra: 180.5, dec: -45.2, radius: 1.0, mode: 'box' });

      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/mast/search/coordinates',
        expect.objectContaining({ mode: 'box' }),
        { signal: undefined }
      );
      expect(getCached).toHaveBeenCalledWith(
        'mast_search_v2:coords:180.5:-45.2:1:all:nofilters:box',
        expect.any(Number)
      );
    });

    it('returns a fresh cache hit without calling the API', async () => {
      const cachedData = { results: [{ id: 'cached' }], totalCount: 1 };
      vi.mocked(getCached).mockReturnValue(cachedData);

      const result = await searchByCoordinates({ ra: 1, dec: 2 });

      expect(result).toEqual(cachedData);
      expect(apiClient.post).not.toHaveBeenCalled();
    });
  });

  describe('searchByObservation', () => {
    it('should POST to /api/mast/search/observation with params', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ results: [] });

      await searchByObservation({ obsId: 'jw01234-o001' });

      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/mast/search/observation',
        { obsId: 'jw01234-o001', calibLevel: undefined },
        { signal: undefined }
      );
      expect(setCache).toHaveBeenCalledWith('mast_search_v2:obs:jw01234-o001:all', {
        results: [],
      });
    });
  });

  describe('searchByProgram', () => {
    it('should POST to /api/mast/search/program with params', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ results: [] });

      await searchByProgram({ programId: '1234', calibLevel: [3] });

      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/mast/search/program',
        { programId: '1234', calibLevel: [3] },
        { signal: undefined }
      );
      expect(setCache).toHaveBeenCalledWith('mast_search_v2:program:1234:3', { results: [] });
    });
  });

  describe('getRecentReleases', () => {
    it('should POST to /api/mast/whats-new with default params', async () => {
      const mockResponse = { results: [], totalCount: 5 };
      vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

      const result = await getRecentReleases();

      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/mast/whats-new',
        { daysBack: 30, instrument: undefined, limit: 50, offset: 0 },
        { signal: undefined }
      );
      expect(result).toEqual(mockResponse);
      expect(setCache).toHaveBeenCalledWith('whats_new:30:all:0', mockResponse);
    });

    it('should return cached data when available', async () => {
      const cachedData = { results: [{ id: 'cached' }], totalCount: 1 };
      vi.mocked(getCached).mockReturnValue(cachedData);

      const result = await getRecentReleases();

      expect(result).toEqual(cachedData);
      expect(apiClient.post).not.toHaveBeenCalled();
    });

    it('should call onStaleData callback with stale data', async () => {
      const staleData = { results: [{ id: 'stale' }], totalCount: 1 };
      const freshData = { results: [{ id: 'fresh' }], totalCount: 2 };
      vi.mocked(getCached).mockReturnValue(null);
      vi.mocked(getStale).mockReturnValue(staleData);
      vi.mocked(apiClient.post).mockResolvedValue(freshData);

      const onStaleData = vi.fn();
      const result = await getRecentReleases({}, undefined, { onStaleData });

      expect(onStaleData).toHaveBeenCalledWith(staleData);
      expect(result).toEqual(freshData);
    });

    it('should skip cache when skipCache is true', async () => {
      const cachedData = { results: [{ id: 'cached' }], totalCount: 1 };
      const freshData = { results: [{ id: 'fresh' }], totalCount: 2 };
      vi.mocked(getCached).mockReturnValue(cachedData);
      vi.mocked(apiClient.post).mockResolvedValue(freshData);

      const result = await getRecentReleases({}, undefined, { skipCache: true });

      expect(getCached).not.toHaveBeenCalled();
      expect(getStale).not.toHaveBeenCalled();
      expect(result).toEqual(freshData);
    });

    it('should use custom params in cache key and API request', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ results: [] });

      await getRecentReleases({ daysBack: 7, instrument: 'NIRCam', offset: 10, limit: 25 });

      expect(getCached).toHaveBeenCalledWith('whats_new:7:NIRCam:10', expect.any(Number));
      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/mast/whats-new',
        { daysBack: 7, instrument: 'NIRCam', limit: 25, offset: 10 },
        { signal: undefined }
      );
    });
  });

  describe('startImport', () => {
    it('should POST to /api/mast/import with default values', async () => {
      const mockResponse = { jobId: 'job-123', status: 'started' };
      vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

      const result = await startImport({ obsId: 'jw01234' });

      expect(apiClient.post).toHaveBeenCalledWith('/api/mast/import', {
        obsId: 'jw01234',
        productType: 'SCIENCE',
        tags: ['mast-import'],
        calibLevel: undefined,
        downloadSource: 'auto',
      });
      expect(result).toEqual(mockResponse);
    });

    it('should use provided values when specified', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({});

      await startImport({
        obsId: 'jw01234',
        productType: 'CALIBRATION',
        tags: ['custom-tag'],
        calibLevel: [2],
        downloadSource: 's3',
      });

      expect(apiClient.post).toHaveBeenCalledWith('/api/mast/import', {
        obsId: 'jw01234',
        productType: 'CALIBRATION',
        tags: ['custom-tag'],
        calibLevel: [2],
        downloadSource: 's3',
      });
    });
  });

  describe('getImportProgress', () => {
    it('should GET /api/mast/import-progress/{jobId}', async () => {
      const mockStatus = { jobId: 'job-123', progress: 50, status: 'downloading' };
      vi.mocked(apiClient.get).mockResolvedValue(mockStatus);

      const result = await getImportProgress('job-123');

      expect(apiClient.get).toHaveBeenCalledWith('/api/mast/import-progress/job-123');
      expect(result).toEqual(mockStatus);
    });
  });

  describe('cancelImport', () => {
    it('should POST to /api/mast/import/cancel/{jobId}', async () => {
      vi.mocked(apiClient.post).mockResolvedValue(undefined);

      await cancelImport('job-123');

      expect(apiClient.post).toHaveBeenCalledWith('/api/mast/import/cancel/job-123');
    });
  });

  describe('resumeImport', () => {
    it('should POST to /api/mast/import/resume/{jobId}', async () => {
      const mockStatus = { jobId: 'job-123', status: 'downloading' };
      vi.mocked(apiClient.post).mockResolvedValue(mockStatus);

      const result = await resumeImport('job-123');

      expect(apiClient.post).toHaveBeenCalledWith('/api/mast/import/resume/job-123');
      expect(result).toEqual(mockStatus);
    });
  });

  describe('importFromExisting', () => {
    it('should POST to /api/mast/import/from-existing/{obsId}', async () => {
      const mockResponse = { jobId: 'job-456', status: 'started' };
      vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

      const result = await importFromExisting('jw01234');

      expect(apiClient.post).toHaveBeenCalledWith('/api/mast/import/from-existing/jw01234');
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getResumableImports', () => {
    it('should GET /api/mast/import/resumable', async () => {
      const mockResponse = { jobs: [{ jobId: 'job-123' }] };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const result = await getResumableImports();

      expect(apiClient.get).toHaveBeenCalledWith('/api/mast/import/resumable');
      expect(result).toEqual(mockResponse);
    });
  });

  describe('dismissResumableImport', () => {
    it('should DELETE with deleteFiles=false by default', async () => {
      const mockResponse = { jobId: 'job-123', dismissed: true };
      vi.mocked(apiClient.delete).mockResolvedValue(mockResponse);

      const result = await dismissResumableImport('job-123');

      expect(apiClient.delete).toHaveBeenCalledWith(
        '/api/mast/import/resumable/job-123?deleteFiles=false'
      );
      expect(result).toEqual(mockResponse);
    });

    it('should DELETE with deleteFiles=true when specified', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({ jobId: 'job-123', dismissed: true });

      await dismissResumableImport('job-123', true);

      expect(apiClient.delete).toHaveBeenCalledWith(
        '/api/mast/import/resumable/job-123?deleteFiles=true'
      );
    });
  });

  describe('refreshMetadataAll', () => {
    it('should POST to /api/mast/refresh-metadata-all', async () => {
      const mockResponse = { updated: 10, failed: 0 };
      vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

      const result = await refreshMetadataAll();

      expect(apiClient.post).toHaveBeenCalledWith('/api/mast/refresh-metadata-all');
      expect(result).toEqual(mockResponse);
    });
  });
});

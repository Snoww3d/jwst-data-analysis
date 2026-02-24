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

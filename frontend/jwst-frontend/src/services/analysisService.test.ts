/**
 * Unit tests for analysisService
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

import { apiClient } from './apiClient';
import {
  getRegionStatistics,
  detectSources,
  getTableInfo,
  getTableData,
  getSpectralData,
} from './analysisService';

describe('analysisService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getRegionStatistics', () => {
    it('should POST to /api/analysis/region-statistics with the request', async () => {
      const request = {
        dataId: 'abc123',
        region: { x: 10, y: 20, width: 100, height: 100 },
      };
      const mockResponse = { mean: 42.5, median: 40, stddev: 5.2 };
      vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

      const result = await getRegionStatistics(request as never);

      expect(apiClient.post).toHaveBeenCalledWith('/api/analysis/region-statistics', request);
      expect(result).toEqual(mockResponse);
    });

    it('should propagate errors from apiClient', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('Server error'));

      await expect(getRegionStatistics({} as never)).rejects.toThrow('Server error');
    });
  });

  describe('detectSources', () => {
    it('should POST to /api/analysis/detect-sources with the request', async () => {
      const request = { dataId: 'abc123', threshold: 3.0 };
      const mockResponse = { sources: [], count: 0 };
      vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

      const result = await detectSources(request as never);

      expect(apiClient.post).toHaveBeenCalledWith('/api/analysis/detect-sources', request);
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getTableInfo', () => {
    it('should GET table info with encoded dataId', async () => {
      const mockResponse = { hdus: [{ index: 1, name: 'TABLE', columns: [] }] };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const result = await getTableInfo('abc123');

      expect(apiClient.get).toHaveBeenCalledWith('/api/analysis/table-info?dataId=abc123');
      expect(result).toEqual(mockResponse);
    });

    it('should encode special characters in dataId', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({});

      await getTableInfo('abc/123+test');

      expect(apiClient.get).toHaveBeenCalledWith(
        `/api/analysis/table-info?dataId=${encodeURIComponent('abc/123+test')}`
      );
    });
  });

  describe('getTableData', () => {
    it('should GET with required dataId param', async () => {
      const mockResponse = { rows: [], totalCount: 0, columns: [] };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const result = await getTableData({ dataId: 'abc123' });

      const calledUrl = vi.mocked(apiClient.get).mock.calls[0][0];
      expect(calledUrl).toContain('/api/analysis/table-data?');
      expect(calledUrl).toContain('dataId=abc123');
      expect(result).toEqual(mockResponse);
    });

    it('should include all optional params when provided', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({});

      await getTableData({
        dataId: 'abc123',
        hduIndex: 2,
        page: 3,
        pageSize: 50,
        sortColumn: 'RA',
        sortDirection: 'asc',
        search: 'test query',
      });

      const calledUrl = vi.mocked(apiClient.get).mock.calls[0][0];
      expect(calledUrl).toContain('dataId=abc123');
      expect(calledUrl).toContain('hduIndex=2');
      expect(calledUrl).toContain('page=3');
      expect(calledUrl).toContain('pageSize=50');
      expect(calledUrl).toContain('sortColumn=RA');
      expect(calledUrl).toContain('sortDirection=asc');
      expect(calledUrl).toContain('search=test+query');
    });

    it('should omit sortColumn when null', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({});

      await getTableData({
        dataId: 'abc123',
        sortColumn: null,
        sortDirection: null,
      });

      const calledUrl = vi.mocked(apiClient.get).mock.calls[0][0];
      expect(calledUrl).not.toContain('sortColumn');
      expect(calledUrl).not.toContain('sortDirection');
    });

    it('should omit search when empty string', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({});

      await getTableData({
        dataId: 'abc123',
        search: '',
      });

      const calledUrl = vi.mocked(apiClient.get).mock.calls[0][0];
      expect(calledUrl).not.toContain('search');
    });
  });

  describe('getSpectralData', () => {
    it('should GET spectral data with dataId only', async () => {
      const mockResponse = { wavelengths: [], flux: [] };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const result = await getSpectralData('abc123');

      const calledUrl = vi.mocked(apiClient.get).mock.calls[0][0];
      expect(calledUrl).toContain('/api/analysis/spectral-data?');
      expect(calledUrl).toContain('dataId=abc123');
      expect(calledUrl).not.toContain('hduIndex');
      expect(result).toEqual(mockResponse);
    });

    it('should include hduIndex when provided', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({});

      await getSpectralData('abc123', 3);

      const calledUrl = vi.mocked(apiClient.get).mock.calls[0][0];
      expect(calledUrl).toContain('dataId=abc123');
      expect(calledUrl).toContain('hduIndex=3');
    });
  });
});

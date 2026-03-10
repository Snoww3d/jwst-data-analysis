/**
 * Unit tests for mosaicService
 *
 * Since all requests now route through apiClient, we mock apiClient
 * and verify that the service builds correct requests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./apiClient', () => {
  const mockApiClient = {
    postBlob: vi.fn(),
    post: vi.fn(),
    get: vi.fn(),
  };
  return {
    apiClient: mockApiClient,
    ApiClient: vi.fn(),
    setTokenGetter: vi.fn(),
    clearTokenGetter: vi.fn(),
    setTokenRefresher: vi.fn(),
    clearTokenRefresher: vi.fn(),
    attemptTokenRefresh: vi.fn(),
    ensureTokenFresh: vi.fn(),
    getAuthLogs: vi.fn(),
    printAuthLogs: vi.fn(),
  };
});

import { apiClient } from './apiClient';
import {
  generateMosaic,
  generateAndSaveMosaic,
  getLimits,
  getFootprints,
  downloadMosaic,
  generateMosaicFilename,
  exportMosaicAsync,
  saveMosaicAsync,
} from './mosaicService';

describe('mosaicService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('generateMosaic', () => {
    it('should call apiClient.postBlob with correct endpoint and request', async () => {
      const mockBlob = new Blob(['mosaic-data'], { type: 'image/png' });
      vi.mocked(apiClient.postBlob).mockResolvedValue(mockBlob);

      const request = {
        files: [{ dataId: 'abc' }, { dataId: 'def' }],
        outputFormat: 'png',
      };

      const result = await generateMosaic(request as never);

      expect(apiClient.postBlob).toHaveBeenCalledWith('/api/mosaic/generate', request, {
        signal: undefined,
      });
      expect(result).toBe(mockBlob);
    });

    it('should propagate errors from apiClient', async () => {
      vi.mocked(apiClient.postBlob).mockRejectedValue(new Error('Server Error'));

      await expect(generateMosaic({} as never)).rejects.toThrow('Server Error');
    });

    it('should pass abort signal', async () => {
      vi.mocked(apiClient.postBlob).mockResolvedValue(new Blob());
      const controller = new AbortController();

      await generateMosaic({} as never, controller.signal);

      expect(apiClient.postBlob).toHaveBeenCalledWith('/api/mosaic/generate', expect.any(Object), {
        signal: controller.signal,
      });
    });
  });

  describe('generateAndSaveMosaic', () => {
    it('should call apiClient.post to /api/mosaic/generate-and-save', async () => {
      const mockResponse = { id: 'mosaic-123', fileName: 'mosaic.fits' };
      vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

      const request = { files: [{ dataId: 'abc' }] };
      const result = await generateAndSaveMosaic(request as never);

      expect(apiClient.post).toHaveBeenCalledWith('/api/mosaic/generate-and-save', request, {
        signal: undefined,
      });
      expect(result).toEqual(mockResponse);
    });

    it('should propagate errors from apiClient', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('Unprocessable'));

      await expect(generateAndSaveMosaic({} as never)).rejects.toThrow();
    });
  });

  describe('getLimits', () => {
    it('should call apiClient.get on /api/mosaic/limits', async () => {
      const mockLimits = { maxFiles: 10, maxPixels: 100000000 };
      vi.mocked(apiClient.get).mockResolvedValue(mockLimits);

      const result = await getLimits();

      expect(apiClient.get).toHaveBeenCalledWith('/api/mosaic/limits');
      expect(result).toEqual(mockLimits);
    });

    it('should propagate errors from apiClient', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Forbidden'));

      await expect(getLimits()).rejects.toThrow();
    });
  });

  describe('getFootprints', () => {
    it('should call apiClient.post to /api/mosaic/footprint with dataIds', async () => {
      const mockFootprints = { footprints: [], boundingBox: {} };
      vi.mocked(apiClient.post).mockResolvedValue(mockFootprints);

      const dataIds = ['abc123', 'def456'];
      const result = await getFootprints(dataIds);

      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/mosaic/footprint',
        { dataIds },
        { signal: undefined }
      );
      expect(result).toEqual(mockFootprints);
    });

    it('should propagate errors from apiClient', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('Bad Request'));

      await expect(getFootprints(['abc'])).rejects.toThrow();
    });

    it('should pass abort signal', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({});
      const controller = new AbortController();

      await getFootprints(['abc'], controller.signal);

      expect(apiClient.post).toHaveBeenCalledWith('/api/mosaic/footprint', expect.any(Object), {
        signal: controller.signal,
      });
    });
  });

  describe('downloadMosaic', () => {
    it('should create link, click it, and schedule cleanup', () => {
      const mockUrl = 'blob:http://localhost/mosaic-blob';
      const createObjectURL = vi.fn().mockReturnValue(mockUrl);
      const revokeObjectURL = vi.fn();
      vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

      const mockLink = {
        href: '',
        download: '',
        style: { display: '' },
        click: vi.fn(),
      };
      const createElement = vi.spyOn(document, 'createElement').mockReturnValue(mockLink as never);
      const appendChild = vi
        .spyOn(document.body, 'appendChild')
        .mockImplementation(() => mockLink as never);
      const removeChild = vi
        .spyOn(document.body, 'removeChild')
        .mockImplementation(() => mockLink as never);

      vi.useFakeTimers();

      const blob = new Blob(['mosaic'], { type: 'image/png' });
      downloadMosaic(blob, 'test-mosaic.png');

      expect(createObjectURL).toHaveBeenCalledWith(blob);
      expect(mockLink.href).toBe(mockUrl);
      expect(mockLink.download).toBe('test-mosaic.png');
      expect(mockLink.style.display).toBe('none');
      expect(appendChild).toHaveBeenCalledWith(mockLink);
      expect(mockLink.click).toHaveBeenCalled();

      vi.advanceTimersByTime(100);
      expect(removeChild).toHaveBeenCalledWith(mockLink);
      expect(revokeObjectURL).toHaveBeenCalledWith(mockUrl);

      createElement.mockRestore();
      appendChild.mockRestore();
      removeChild.mockRestore();
      vi.useRealTimers();
    });
  });

  describe('generateMosaicFilename', () => {
    it('should generate filename with png extension', () => {
      const filename = generateMosaicFilename('png');

      expect(filename).toMatch(/^jwst-mosaic-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.png$/);
    });

    it('should generate filename with jpg extension for jpeg format', () => {
      const filename = generateMosaicFilename('jpeg');

      expect(filename).toMatch(/^jwst-mosaic-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.jpg$/);
    });

    it('should generate filename with fits extension', () => {
      const filename = generateMosaicFilename('fits');

      expect(filename).toMatch(/^jwst-mosaic-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.fits$/);
    });
  });

  describe('exportMosaicAsync', () => {
    it('should call apiClient.post to /api/mosaic/export and return jobId', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ jobId: 'export-job-123' });

      const request = {
        files: [{ dataId: 'abc' }, { dataId: 'def' }],
        outputFormat: 'png',
      };

      const result = await exportMosaicAsync(request as never);

      expect(apiClient.post).toHaveBeenCalledWith('/api/mosaic/export', request);
      expect(result).toEqual({ jobId: 'export-job-123' });
    });

    it('should propagate errors from apiClient', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('Too Many Requests'));

      await expect(exportMosaicAsync({} as never)).rejects.toThrow();
    });
  });

  describe('saveMosaicAsync', () => {
    it('should call apiClient.post to /api/mosaic/save and return jobId', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ jobId: 'save-job-123' });

      const request = {
        files: [{ dataId: 'abc' }, { dataId: 'def' }],
      };

      const result = await saveMosaicAsync(request as never);

      expect(apiClient.post).toHaveBeenCalledWith('/api/mosaic/save', request);
      expect(result).toEqual({ jobId: 'save-job-123' });
    });

    it('should propagate errors from apiClient', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('Bad Request'));

      await expect(saveMosaicAsync({} as never)).rejects.toThrow();
    });
  });
});

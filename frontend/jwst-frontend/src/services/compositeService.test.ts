/**
 * Unit tests for compositeService
 *
 * Since all requests now route through apiClient, we mock apiClient
 * and verify that the service builds correct requests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./apiClient', () => {
  const mockApiClient = {
    postBlob: vi.fn(),
    post: vi.fn(),
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
  generateNChannelComposite,
  generateNChannelPreview,
  exportNChannelComposite,
  exportNChannelCompositeAsync,
  analyzeChannels,
  downloadComposite,
  generateFilename,
} from './compositeService';

describe('compositeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('generateNChannelComposite', () => {
    it('should call apiClient.postBlob with correct endpoint and request', async () => {
      const mockBlob = new Blob(['image-data'], { type: 'image/png' });
      vi.mocked(apiClient.postBlob).mockResolvedValue(mockBlob);

      const request = {
        channels: [{ dataId: 'abc', color: 'red' }],
        outputFormat: 'png' as const,
        quality: 100,
        width: 800,
        height: 800,
      };

      const result = await generateNChannelComposite(request as never);

      expect(apiClient.postBlob).toHaveBeenCalledWith('/api/composite/generate-nchannel', request, {
        signal: undefined,
      });
      expect(result).toBe(mockBlob);
    });

    it('should pass abort signal', async () => {
      vi.mocked(apiClient.postBlob).mockResolvedValue(new Blob());
      const controller = new AbortController();

      await generateNChannelComposite({ channels: [] } as never, controller.signal);

      expect(apiClient.postBlob).toHaveBeenCalledWith(
        '/api/composite/generate-nchannel',
        expect.any(Object),
        { signal: controller.signal }
      );
    });

    it('should propagate errors from apiClient', async () => {
      vi.mocked(apiClient.postBlob).mockRejectedValue(new Error('API Error'));

      await expect(generateNChannelComposite({ channels: [] } as never)).rejects.toThrow(
        'API Error'
      );
    });
  });

  describe('generateNChannelPreview', () => {
    it('should build preview request with defaults', async () => {
      vi.mocked(apiClient.postBlob).mockResolvedValue(new Blob());

      const channels = [{ dataId: 'abc', color: 'red' }];
      await generateNChannelPreview(channels as never);

      expect(apiClient.postBlob).toHaveBeenCalledWith(
        '/api/composite/generate-nchannel',
        {
          channels,
          overall: undefined,
          backgroundNeutralization: undefined,
          outputFormat: 'jpeg',
          quality: 85,
          width: 800,
          height: 800,
        },
        { signal: undefined }
      );
    });

    it('should use custom preview size', async () => {
      vi.mocked(apiClient.postBlob).mockResolvedValue(new Blob());

      await generateNChannelPreview([], 400);

      expect(apiClient.postBlob).toHaveBeenCalledWith(
        '/api/composite/generate-nchannel',
        expect.objectContaining({ width: 400, height: 400 }),
        expect.any(Object)
      );
    });

    it('should pass sharpening through into the request body', async () => {
      vi.mocked(apiClient.postBlob).mockResolvedValue(new Blob());

      await generateNChannelPreview([], 800, undefined, undefined, undefined, undefined, {
        radius: 1.5,
        amount: 0.6,
        threshold: 0.01,
      });

      expect(apiClient.postBlob).toHaveBeenCalledWith(
        '/api/composite/generate-nchannel',
        expect.objectContaining({
          sharpening: { radius: 1.5, amount: 0.6, threshold: 0.01 },
        }),
        expect.any(Object)
      );
    });
  });

  describe('exportNChannelComposite', () => {
    it('should build export request with specified format/quality/dimensions', async () => {
      vi.mocked(apiClient.postBlob).mockResolvedValue(new Blob());

      const channels = [{ dataId: 'abc' }];
      await exportNChannelComposite(channels as never, 'png', 100, 2000, 1500);

      expect(apiClient.postBlob).toHaveBeenCalledWith(
        '/api/composite/generate-nchannel',
        expect.objectContaining({
          outputFormat: 'png',
          quality: 100,
          width: 2000,
          height: 1500,
        }),
        expect.any(Object)
      );
    });

    it('should include overall adjustments and backgroundNeutralization', async () => {
      vi.mocked(apiClient.postBlob).mockResolvedValue(new Blob());

      const overall = { brightness: 1.2, contrast: 1.0 };
      await exportNChannelComposite([], 'jpeg', 85, 800, 800, overall as never, undefined, true);

      expect(apiClient.postBlob).toHaveBeenCalledWith(
        '/api/composite/generate-nchannel',
        expect.objectContaining({
          overall,
          backgroundNeutralization: true,
        }),
        expect.any(Object)
      );
    });

    it('should pass sharpening through into the export request body', async () => {
      vi.mocked(apiClient.postBlob).mockResolvedValue(new Blob());

      await exportNChannelComposite(
        [],
        'png',
        100,
        1000,
        1000,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { radius: 2.0, amount: 1.2, threshold: 0.0 }
      );

      expect(apiClient.postBlob).toHaveBeenCalledWith(
        '/api/composite/generate-nchannel',
        expect.objectContaining({
          sharpening: { radius: 2.0, amount: 1.2, threshold: 0.0 },
        }),
        expect.any(Object)
      );
    });
  });

  describe('exportNChannelCompositeAsync', () => {
    it('should call apiClient.post to /api/composite/export-nchannel and return jobId', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ jobId: 'job-123' });

      const channels = [{ dataId: 'abc' }];
      const result = await exportNChannelCompositeAsync(channels as never, 'png', 100, 2000, 1500);

      expect(apiClient.post).toHaveBeenCalledWith('/api/composite/export-nchannel', {
        channels,
        overall: undefined,
        backgroundNeutralization: undefined,
        outputFormat: 'png',
        quality: 100,
        width: 2000,
        height: 1500,
      });
      expect(result).toEqual({ jobId: 'job-123' });
    });

    it('should propagate errors from apiClient', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('Too Many Requests'));

      await expect(
        exportNChannelCompositeAsync([] as never, 'png', 100, 800, 800)
      ).rejects.toThrow();
    });

    it('should pass sharpening through into the async export request body', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ jobId: 'job-777' });

      await exportNChannelCompositeAsync(
        [] as never,
        'jpeg',
        92,
        2000,
        2000,
        undefined,
        undefined,
        undefined,
        undefined,
        { radius: 1.0, amount: 0.4, threshold: 0.005 }
      );

      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/composite/export-nchannel',
        expect.objectContaining({
          sharpening: { radius: 1.0, amount: 0.4, threshold: 0.005 },
        })
      );
    });
  });

  describe('analyzeChannels', () => {
    it('should call apiClient.post with correct endpoint and request body', async () => {
      const mockResponse = {
        channels: [
          {
            channel_name: 'ch0_F444W',
            label: 'F444W',
            params: { stretch: 'asinh', asinh_a: 0.02 },
            histogram: { counts: [1, 2], bin_centers: [0.5, 1.5], bin_edges: [0, 1, 2], n_bins: 2 },
            meta: { dynamic_range: 500, snr: 80, hdr_detected: false },
            stats: { min: 0, max: 100, mean: 50, std: 20 },
          },
        ],
      };
      vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

      const channels = [{ dataIds: ['abc'], color: { hue: 0 } }];
      const result = await analyzeChannels(channels as never, true);

      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/composite/analyze-channels',
        { channels, backgroundNeutralization: true },
        { signal: undefined }
      );
      expect(result.channels).toHaveLength(1);
      expect(result.channels[0].channel_name).toBe('ch0_F444W');
    });

    it('should pass abort signal', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ channels: [] });
      const controller = new AbortController();

      await analyzeChannels([] as never, false, controller.signal);

      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/composite/analyze-channels',
        { channels: [], backgroundNeutralization: false },
        { signal: controller.signal }
      );
    });

    it('should propagate errors from apiClient', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('Analysis Failed'));

      await expect(analyzeChannels([] as never)).rejects.toThrow('Analysis Failed');
    });
  });

  describe('downloadComposite', () => {
    it('should create link, click it, and schedule cleanup', () => {
      const mockUrl = 'blob:http://localhost/abc-123';
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

      const blob = new Blob(['image'], { type: 'image/png' });
      downloadComposite(blob, 'test-composite.png');

      expect(createObjectURL).toHaveBeenCalledWith(blob);
      expect(mockLink.href).toBe(mockUrl);
      expect(mockLink.download).toBe('test-composite.png');
      expect(mockLink.style.display).toBe('none');
      expect(appendChild).toHaveBeenCalledWith(mockLink);
      expect(mockLink.click).toHaveBeenCalled();

      // Cleanup should happen after timeout
      vi.advanceTimersByTime(100);
      expect(removeChild).toHaveBeenCalledWith(mockLink);
      expect(revokeObjectURL).toHaveBeenCalledWith(mockUrl);

      createElement.mockRestore();
      appendChild.mockRestore();
      removeChild.mockRestore();
      vi.useRealTimers();
    });
  });

  describe('generateFilename', () => {
    it('should generate filename with png extension', () => {
      const filename = generateFilename('png');

      expect(filename).toMatch(/^jwst-composite-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.png$/);
    });

    it('should generate filename with jpg extension for jpeg format', () => {
      const filename = generateFilename('jpeg');

      expect(filename).toMatch(/^jwst-composite-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.jpg$/);
    });
  });
});

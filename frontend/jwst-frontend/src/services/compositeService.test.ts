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
    postBlobWithHeaders: vi.fn(),
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
  estimateComposite,
  exportNChannelComposite,
  exportNChannelCompositeAsync,
  generateNChannelComposite,
  generateNChannelPreview,
  generateNChannelPreviewAsync,
  parseCompositeWarning,
  analyzeChannels,
  downloadComposite,
  generateFilename,
} from './compositeService';

/** Build a Headers object from a plain dict for terse mock responses. */
function H(obj: Record<string, string> = {}): Headers {
  return new Headers(obj);
}

describe('compositeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('generateNChannelComposite', () => {
    it('should call apiClient.postBlobWithHeaders with correct endpoint and request', async () => {
      const mockBlob = new Blob(['image-data'], { type: 'image/png' });
      vi.mocked(apiClient.postBlobWithHeaders).mockResolvedValue({ blob: mockBlob, headers: H() });

      const request = {
        channels: [{ dataId: 'abc', color: 'red' }],
        outputFormat: 'png' as const,
        quality: 100,
        width: 800,
        height: 800,
      };

      const result = await generateNChannelComposite(request as never);

      expect(apiClient.postBlobWithHeaders).toHaveBeenCalledWith(
        '/api/composite/generate-nchannel',
        request,
        {
          signal: undefined,
        }
      );
      expect(result.blob).toBe(mockBlob);
      expect(result.warning).toBeNull();
    });

    it('should pass abort signal', async () => {
      vi.mocked(apiClient.postBlobWithHeaders).mockResolvedValue({
        blob: new Blob(),
        headers: H(),
      });
      const controller = new AbortController();

      await generateNChannelComposite({ channels: [] } as never, controller.signal);

      expect(apiClient.postBlobWithHeaders).toHaveBeenCalledWith(
        '/api/composite/generate-nchannel',
        expect.any(Object),
        { signal: controller.signal }
      );
    });

    it('should propagate errors from apiClient', async () => {
      vi.mocked(apiClient.postBlobWithHeaders).mockRejectedValue(new Error('API Error'));

      await expect(generateNChannelComposite({ channels: [] } as never)).rejects.toThrow(
        'API Error'
      );
    });

    it('forwards allowForceDownscale on the request payload', async () => {
      vi.mocked(apiClient.postBlobWithHeaders).mockResolvedValue({
        blob: new Blob(),
        headers: H(),
      });

      await generateNChannelComposite({
        channels: [],
        outputFormat: 'png',
        quality: 95,
        width: 1000,
        height: 1000,
        allowForceDownscale: true,
      } as never);

      expect(apiClient.postBlobWithHeaders).toHaveBeenCalledWith(
        '/api/composite/generate-nchannel',
        expect.objectContaining({ allowForceDownscale: true }),
        expect.any(Object)
      );
    });
  });

  describe('generateNChannelPreview', () => {
    it('should build preview request with defaults', async () => {
      vi.mocked(apiClient.postBlobWithHeaders).mockResolvedValue({
        blob: new Blob(),
        headers: H(),
      });

      const channels = [{ dataId: 'abc', color: 'red' }];
      await generateNChannelPreview(channels as never);

      expect(apiClient.postBlobWithHeaders).toHaveBeenCalledWith(
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
      vi.mocked(apiClient.postBlobWithHeaders).mockResolvedValue({
        blob: new Blob(),
        headers: H(),
      });

      await generateNChannelPreview([], { previewSize: 400 });

      expect(apiClient.postBlobWithHeaders).toHaveBeenCalledWith(
        '/api/composite/generate-nchannel',
        expect.objectContaining({ width: 400, height: 400 }),
        expect.any(Object)
      );
    });

    it('should pass sharpening through into the request body', async () => {
      vi.mocked(apiClient.postBlobWithHeaders).mockResolvedValue({
        blob: new Blob(),
        headers: H(),
      });

      await generateNChannelPreview([], {
        sharpening: { radius: 1.5, amount: 0.6, threshold: 0.01 },
      });

      expect(apiClient.postBlobWithHeaders).toHaveBeenCalledWith(
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
      vi.mocked(apiClient.postBlobWithHeaders).mockResolvedValue({
        blob: new Blob(),
        headers: H(),
      });

      const channels = [{ dataId: 'abc' }];
      await exportNChannelComposite(channels as never, {
        format: 'png',
        quality: 100,
        width: 2000,
        height: 1500,
      });

      expect(apiClient.postBlobWithHeaders).toHaveBeenCalledWith(
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
      vi.mocked(apiClient.postBlobWithHeaders).mockResolvedValue({
        blob: new Blob(),
        headers: H(),
      });

      const overall = { brightness: 1.2, contrast: 1.0 };
      await exportNChannelComposite([], {
        format: 'jpeg',
        quality: 85,
        width: 800,
        height: 800,
        overall: overall as never,
        backgroundNeutralization: true,
      });

      expect(apiClient.postBlobWithHeaders).toHaveBeenCalledWith(
        '/api/composite/generate-nchannel',
        expect.objectContaining({
          overall,
          backgroundNeutralization: true,
        }),
        expect.any(Object)
      );
    });

    it('should pass sharpening through into the export request body', async () => {
      vi.mocked(apiClient.postBlobWithHeaders).mockResolvedValue({
        blob: new Blob(),
        headers: H(),
      });

      await exportNChannelComposite([], {
        format: 'png',
        quality: 100,
        width: 1000,
        height: 1000,
        sharpening: { radius: 2.0, amount: 1.2, threshold: 0.0 },
      });

      expect(apiClient.postBlobWithHeaders).toHaveBeenCalledWith(
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
      const result = await exportNChannelCompositeAsync(channels as never, {
        format: 'png',
        quality: 100,
        width: 2000,
        height: 1500,
      });

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
        exportNChannelCompositeAsync([] as never, {
          format: 'png',
          quality: 100,
          width: 800,
          height: 800,
        })
      ).rejects.toThrow();
    });

    it('should pass sharpening through into the async export request body', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ jobId: 'job-777' });

      await exportNChannelCompositeAsync([] as never, {
        format: 'jpeg',
        quality: 92,
        width: 2000,
        height: 2000,
        sharpening: { radius: 1.0, amount: 0.4, threshold: 0.005 },
      });

      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/composite/export-nchannel',
        expect.objectContaining({
          sharpening: { radius: 1.0, amount: 0.4, threshold: 0.005 },
        })
      );
    });
  });

  describe('generateNChannelPreviewAsync', () => {
    it('should post to /api/composite/generate-nchannel-async and return jobId', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ jobId: 'preview-job-1' });

      const channels = [{ dataId: 'abc' }];
      const result = await generateNChannelPreviewAsync(channels as never, {
        previewSize: 1000,
      });

      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/composite/generate-nchannel-async',
        expect.objectContaining({
          channels,
          outputFormat: 'jpeg',
          quality: 85,
          width: 1000,
          height: 1000,
        }),
        expect.any(Object)
      );
      expect(result).toEqual({ jobId: 'preview-job-1' });
    });

    it('should default previewSize to 800 when omitted', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ jobId: 'preview-job-2' });

      await generateNChannelPreviewAsync([] as never);

      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/composite/generate-nchannel-async',
        expect.objectContaining({ width: 800, height: 800 }),
        expect.any(Object)
      );
    });

    it('should forward abortSignal to apiClient.post', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ jobId: 'preview-job-3' });

      const controller = new AbortController();
      await generateNChannelPreviewAsync([] as never, {
        abortSignal: controller.signal,
      });

      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/composite/generate-nchannel-async',
        expect.any(Object),
        expect.objectContaining({ signal: controller.signal })
      );
    });

    it('should propagate errors from apiClient', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('Queue full'));

      await expect(generateNChannelPreviewAsync([] as never)).rejects.toThrow('Queue full');
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

  describe('parseCompositeWarning', () => {
    it('returns null when X-Composite-Budget-Status is absent', () => {
      expect(parseCompositeWarning(H())).toBeNull();
    });

    it('returns null when budget status is an unknown value', () => {
      expect(parseCompositeWarning(H({ 'X-Composite-Budget-Status': 'mystery' }))).toBeNull();
    });

    it('parses ok status without downscale', () => {
      const w = parseCompositeWarning(H({ 'X-Composite-Budget-Status': 'ok' }));
      expect(w).toEqual({
        budgetStatus: 'ok',
        wasDownscaled: false,
        originalShape: undefined,
        outputShape: undefined,
        sideFactor: undefined,
      });
    });

    it('parses warn status with downscale shapes and side factor', () => {
      const w = parseCompositeWarning(
        H({
          'X-Composite-Budget-Status': 'warn',
          'X-Composite-Was-Downscaled': 'true',
          'X-Composite-Original-Shape': '5750,5750',
          'X-Composite-Output-Shape': '5462,5462',
          'X-Composite-Side-Factor': '0.950',
        })
      );
      expect(w).toEqual({
        budgetStatus: 'warn',
        wasDownscaled: true,
        originalShape: [5750, 5750],
        outputShape: [5462, 5462],
        sideFactor: 0.95,
      });
    });

    it('handles fail status from a stale-budget cache hit', () => {
      const w = parseCompositeWarning(
        H({
          'X-Composite-Budget-Status': 'fail',
          'X-Composite-Was-Downscaled': 'false',
        })
      );
      expect(w?.budgetStatus).toBe('fail');
      expect(w?.wasDownscaled).toBe(false);
    });

    it('forwards allowForceDownscale through generateNChannelPreview', async () => {
      vi.mocked(apiClient.postBlobWithHeaders).mockResolvedValue({
        blob: new Blob(),
        headers: H(),
      });

      await generateNChannelPreview([] as never, { allowForceDownscale: true });

      expect(apiClient.postBlobWithHeaders).toHaveBeenCalledWith(
        '/api/composite/generate-nchannel',
        expect.objectContaining({ allowForceDownscale: true }),
        expect.any(Object)
      );
    });

    it('forwards allowForceDownscale through exportNChannelComposite', async () => {
      vi.mocked(apiClient.postBlobWithHeaders).mockResolvedValue({
        blob: new Blob(),
        headers: H(),
      });

      await exportNChannelComposite(
        [] as never,
        {
          format: 'png',
          quality: 95,
          width: 1000,
          height: 1000,
          allowForceDownscale: true,
        } as never
      );

      expect(apiClient.postBlobWithHeaders).toHaveBeenCalledWith(
        '/api/composite/generate-nchannel',
        expect.objectContaining({ allowForceDownscale: true }),
        expect.any(Object)
      );
    });

    it('forwards allowForceDownscale through exportNChannelCompositeAsync', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ jobId: 'j-1' });

      await exportNChannelCompositeAsync(
        [] as never,
        {
          format: 'png',
          quality: 95,
          width: 1000,
          height: 1000,
          allowForceDownscale: true,
        } as never
      );

      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/composite/export-nchannel',
        expect.objectContaining({ allowForceDownscale: true })
      );
    });

    it('parses forced status from an opted-in or cache-hit force-downscale', () => {
      const w = parseCompositeWarning(
        H({
          'X-Composite-Budget-Status': 'forced',
          'X-Composite-Was-Downscaled': 'true',
          'X-Composite-Original-Shape': '11399,8949',
          'X-Composite-Output-Shape': '4353,3417',
          'X-Composite-Side-Factor': '0.382',
        })
      );
      expect(w).toEqual({
        budgetStatus: 'forced',
        wasDownscaled: true,
        originalShape: [11399, 8949],
        outputShape: [4353, 3417],
        sideFactor: 0.382,
      });
    });

    it('returns undefined shape when header is malformed', () => {
      const w = parseCompositeWarning(
        H({
          'X-Composite-Budget-Status': 'warn',
          'X-Composite-Was-Downscaled': 'true',
          'X-Composite-Original-Shape': 'not,a,shape',
        })
      );
      expect(w?.originalShape).toBeUndefined();
    });

    it('rejects Infinity side factor', () => {
      const w = parseCompositeWarning(
        H({ 'X-Composite-Budget-Status': 'warn', 'X-Composite-Side-Factor': 'Infinity' })
      );
      expect(w?.sideFactor).toBeUndefined();
    });

    it('rejects negative side factor', () => {
      const w = parseCompositeWarning(
        H({ 'X-Composite-Budget-Status': 'warn', 'X-Composite-Side-Factor': '-0.5' })
      );
      expect(w?.sideFactor).toBeUndefined();
    });

    it('rejects side factor > 1 (engine contract violation)', () => {
      const w = parseCompositeWarning(
        H({ 'X-Composite-Budget-Status': 'warn', 'X-Composite-Side-Factor': '1.5' })
      );
      expect(w?.sideFactor).toBeUndefined();
    });

    it('accepts side factor = 1.0 (boundary)', () => {
      const w = parseCompositeWarning(
        H({ 'X-Composite-Budget-Status': 'warn', 'X-Composite-Side-Factor': '1.0' })
      );
      expect(w?.sideFactor).toBe(1.0);
    });
  });

  describe('parseMemoryBudgetError', () => {
    // Inline import to avoid breaking earlier tests if the helper is added later
    // in a follow-up; keeps each test self-contained.

    it('strips MEMORY_BUDGET: prefix from async-path errors', async () => {
      const { parseMemoryBudgetError } = await import('./compositeService');
      const result = parseMemoryBudgetError(
        'MEMORY_BUDGET:Composite output would shrink to 38% of requested side length ' +
          '(4353x3417 from 11399x8949). Memory limit MAX_COMPOSITE_MEMORY_BYTES = 3000 MB.'
      );
      expect(result.isMemoryBudget).toBe(true);
      expect(result.displayMessage.startsWith('MEMORY_BUDGET:')).toBe(false);
      expect(result.projectedShape).toEqual([4353, 3417]);
    });

    it('detects memory-budget pattern in sync-path errors without prefix', async () => {
      const { parseMemoryBudgetError } = await import('./compositeService');
      const result = parseMemoryBudgetError(
        'Composite output would shrink to 38% of requested side length ' +
          '(4353x3417 from 11399x8949). Memory limit MAX_COMPOSITE_MEMORY_BYTES = 3000 MB.'
      );
      expect(result.isMemoryBudget).toBe(true);
      expect(result.projectedShape).toEqual([4353, 3417]);
    });

    it('returns isMemoryBudget=false for unrelated errors', async () => {
      const { parseMemoryBudgetError } = await import('./compositeService');
      const result = parseMemoryBudgetError('Network error: ECONNREFUSED');
      expect(result.isMemoryBudget).toBe(false);
      expect(result.projectedShape).toBeNull();
      expect(result.displayMessage).toBe('Network error: ECONNREFUSED');
    });

    it('returns null projectedShape when shape pattern is missing but prefix matches', async () => {
      const { parseMemoryBudgetError } = await import('./compositeService');
      const result = parseMemoryBudgetError(
        'MEMORY_BUDGET:engine refused due to MAX_COMPOSITE_MEMORY_BYTES'
      );
      expect(result.isMemoryBudget).toBe(true);
      expect(result.projectedShape).toBeNull();
    });

    it('does not match when only one keyword is present (without prefix)', async () => {
      const { parseMemoryBudgetError } = await import('./compositeService');
      // Some unrelated docs/error path mentions only one of the keywords —
      // detection should require both to avoid offering an inert override.
      const result = parseMemoryBudgetError(
        'Memory exceeded MAX_COMPOSITE_MEMORY_BYTES at runtime'
      );
      expect(result.isMemoryBudget).toBe(false);
    });
  });

  describe('generateNChannelComposite warning surface', () => {
    it('forwards parsed warning when engine emits downscale headers', async () => {
      const mockBlob = new Blob();
      vi.mocked(apiClient.postBlobWithHeaders).mockResolvedValue({
        blob: mockBlob,
        headers: H({
          'X-Composite-Budget-Status': 'warn',
          'X-Composite-Was-Downscaled': 'true',
          'X-Composite-Original-Shape': '5750,5750',
          'X-Composite-Output-Shape': '5462,5462',
          'X-Composite-Side-Factor': '0.950',
        }),
      });

      const result = await generateNChannelComposite({ channels: [] } as never);

      expect(result.blob).toBe(mockBlob);
      expect(result.warning?.budgetStatus).toBe('warn');
      expect(result.warning?.wasDownscaled).toBe(true);
      expect(result.warning?.outputShape).toEqual([5462, 5462]);
    });
  });

  describe('estimateComposite', () => {
    it('POSTs to /api/composite/estimate and returns the verdict', async () => {
      const verdict = {
        status: 'warn' as const,
        originalShape: [4150, 4150] as [number, number],
        outputShape: [3947, 3947] as [number, number],
        sideFactor: 0.951,
        detail: 'Composite output would shrink to 95% of requested side length.',
        memoryLimitMb: 3000,
        failThreshold: 0.85,
      };
      vi.mocked(apiClient.post).mockResolvedValue(verdict);

      const result = await estimateComposite({ channels: [] } as never);

      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/composite/estimate',
        { channels: [] },
        { signal: undefined }
      );
      expect(result).toEqual(verdict);
    });

    it('passes abort signal through', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({});
      const controller = new AbortController();

      await estimateComposite({ channels: [] } as never, controller.signal);

      expect(apiClient.post).toHaveBeenCalledWith('/api/composite/estimate', expect.any(Object), {
        signal: controller.signal,
      });
    });

    it('propagates errors from the API', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('engine down'));

      await expect(estimateComposite({ channels: [] } as never)).rejects.toThrow('engine down');
    });
  });
});

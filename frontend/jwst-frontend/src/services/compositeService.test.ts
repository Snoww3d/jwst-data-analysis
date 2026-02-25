/**
 * Unit tests for compositeService
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config/api', () => ({ API_BASE_URL: 'http://test:5001' }));

vi.mock('./ApiError', () => ({
  ApiError: {
    fromResponse: vi.fn().mockResolvedValue(new Error('API Error')),
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { ApiError } from './ApiError';
import {
  generateNChannelComposite,
  generateNChannelPreview,
  exportNChannelComposite,
  exportNChannelCompositeAsync,
  downloadComposite,
  generateFilename,
  setCompositeTokenGetter,
} from './compositeService';

describe('compositeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset token getter by setting null-returning getter
    setCompositeTokenGetter(() => null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('generateNChannelComposite', () => {
    it('should POST to /api/composite/generate-nchannel and return blob', async () => {
      const mockBlob = new Blob(['image-data'], { type: 'image/png' });
      mockFetch.mockResolvedValue({
        ok: true,
        blob: vi.fn().mockResolvedValue(mockBlob),
      });

      const request = {
        channels: [{ dataId: 'abc', color: 'red' }],
        outputFormat: 'png' as const,
        quality: 100,
        width: 800,
        height: 800,
      };

      const result = await generateNChannelComposite(request as never);

      expect(mockFetch).toHaveBeenCalledWith('http://test:5001/api/composite/generate-nchannel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: undefined,
      });
      expect(result).toBe(mockBlob);
    });

    it('should throw on error response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(generateNChannelComposite({ channels: [] } as never)).rejects.toThrow();
      expect(ApiError.fromResponse).toHaveBeenCalled();
    });

    it('should include auth header when token getter is set', async () => {
      setCompositeTokenGetter(() => 'test-token-123');

      mockFetch.mockResolvedValue({
        ok: true,
        blob: vi.fn().mockResolvedValue(new Blob()),
      });

      await generateNChannelComposite({ channels: [] } as never);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token-123',
          }),
        })
      );
    });

    it('should pass abort signal', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        blob: vi.fn().mockResolvedValue(new Blob()),
      });
      const controller = new AbortController();

      await generateNChannelComposite({ channels: [] } as never, controller.signal);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ signal: controller.signal })
      );
    });
  });

  describe('generateNChannelPreview', () => {
    it('should call generateNChannelComposite with preview defaults', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        blob: vi.fn().mockResolvedValue(new Blob()),
      });

      const channels = [{ dataId: 'abc', color: 'red' }];
      await generateNChannelPreview(channels as never);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test:5001/api/composite/generate-nchannel',
        expect.objectContaining({
          body: JSON.stringify({
            channels,
            overall: undefined,
            backgroundNeutralization: undefined,
            outputFormat: 'jpeg',
            quality: 85,
            width: 800,
            height: 800,
          }),
        })
      );
    });

    it('should use custom preview size', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        blob: vi.fn().mockResolvedValue(new Blob()),
      });

      await generateNChannelPreview([], 400);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.width).toBe(400);
      expect(body.height).toBe(400);
    });
  });

  describe('exportNChannelComposite', () => {
    it('should call generateNChannelComposite with specified format/quality/dimensions', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        blob: vi.fn().mockResolvedValue(new Blob()),
      });

      const channels = [{ dataId: 'abc' }];
      await exportNChannelComposite(channels as never, 'png', 100, 2000, 1500);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.outputFormat).toBe('png');
      expect(body.quality).toBe(100);
      expect(body.width).toBe(2000);
      expect(body.height).toBe(1500);
    });

    it('should include overall adjustments and backgroundNeutralization', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        blob: vi.fn().mockResolvedValue(new Blob()),
      });

      const overall = { brightness: 1.2, contrast: 1.0 };
      await exportNChannelComposite([], 'jpeg', 85, 800, 800, overall as never, undefined, true);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.overall).toEqual(overall);
      expect(body.backgroundNeutralization).toBe(true);
    });
  });

  describe('exportNChannelCompositeAsync', () => {
    it('should POST to /api/composite/export-nchannel and return jobId', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ jobId: 'job-123', status: 'queued' }),
      });

      setCompositeTokenGetter(() => 'test-token');

      const channels = [{ dataId: 'abc' }];
      const result = await exportNChannelCompositeAsync(channels as never, 'png', 100, 2000, 1500);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test:5001/api/composite/export-nchannel',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      );
      expect(result).toEqual({ jobId: 'job-123', status: 'queued' });
    });

    it('should throw on error response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      });

      await expect(
        exportNChannelCompositeAsync([] as never, 'png', 100, 800, 800)
      ).rejects.toThrow();
      expect(ApiError.fromResponse).toHaveBeenCalled();
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

  describe('setCompositeTokenGetter', () => {
    it('should cause auth header to be included in requests', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        blob: vi.fn().mockResolvedValue(new Blob()),
      });

      setCompositeTokenGetter(() => 'my-access-token');

      await generateNChannelComposite({ channels: [] } as never);

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['Authorization']).toBe('Bearer my-access-token');
    });

    it('should not include auth header when getter returns null', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        blob: vi.fn().mockResolvedValue(new Blob()),
      });

      setCompositeTokenGetter(() => null);

      await generateNChannelComposite({ channels: [] } as never);

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['Authorization']).toBeUndefined();
    });
  });
});

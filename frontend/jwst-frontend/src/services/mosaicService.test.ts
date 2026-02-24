/**
 * Unit tests for mosaicService
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

// Mock localStorage for token fallback in getAuthHeaders
const mockStorage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => mockStorage.get(key) ?? null,
  setItem: (key: string, val: string) => mockStorage.set(key, val),
  removeItem: (key: string) => mockStorage.delete(key),
  get length() {
    return mockStorage.size;
  },
  key: (i: number) => [...mockStorage.keys()][i] ?? null,
  clear: () => mockStorage.clear(),
});

import { ApiError } from './ApiError';
import {
  generateMosaic,
  generateAndSaveMosaic,
  getLimits,
  getFootprints,
  downloadMosaic,
  generateMosaicFilename,
  setMosaicTokenGetter,
} from './mosaicService';

describe('mosaicService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.clear();
    setMosaicTokenGetter(() => null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('generateMosaic', () => {
    it('should POST to /api/mosaic/generate and return blob', async () => {
      const mockBlob = new Blob(['mosaic-data'], { type: 'image/png' });
      mockFetch.mockResolvedValue({
        ok: true,
        blob: vi.fn().mockResolvedValue(mockBlob),
      });

      const request = {
        files: [{ dataId: 'abc' }, { dataId: 'def' }],
        outputFormat: 'png',
      };

      const result = await generateMosaic(request as never);

      expect(mockFetch).toHaveBeenCalledWith('http://test:5001/api/mosaic/generate', {
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

      await expect(generateMosaic({} as never)).rejects.toThrow();
      expect(ApiError.fromResponse).toHaveBeenCalled();
    });

    it('should include auth header when token getter is set', async () => {
      setMosaicTokenGetter(() => 'mosaic-token');

      mockFetch.mockResolvedValue({
        ok: true,
        blob: vi.fn().mockResolvedValue(new Blob()),
      });

      await generateMosaic({} as never);

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['Authorization']).toBe('Bearer mosaic-token');
    });

    it('should fall back to localStorage token', async () => {
      setMosaicTokenGetter(() => null);
      mockStorage.set('jwst_auth_token', 'stored-token');

      mockFetch.mockResolvedValue({
        ok: true,
        blob: vi.fn().mockResolvedValue(new Blob()),
      });

      await generateMosaic({} as never);

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['Authorization']).toBe('Bearer stored-token');
    });

    it('should pass abort signal', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        blob: vi.fn().mockResolvedValue(new Blob()),
      });
      const controller = new AbortController();

      await generateMosaic({} as never, controller.signal);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ signal: controller.signal })
      );
    });
  });

  describe('generateAndSaveMosaic', () => {
    it('should POST to /api/mosaic/generate-and-save and return JSON', async () => {
      const mockResponse = { id: 'mosaic-123', fileName: 'mosaic.fits' };
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      });

      const request = { files: [{ dataId: 'abc' }] };
      const result = await generateAndSaveMosaic(request as never);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test:5001/api/mosaic/generate-and-save',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(request),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it('should throw on error response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
      });

      await expect(generateAndSaveMosaic({} as never)).rejects.toThrow();
    });
  });

  describe('getLimits', () => {
    it('should GET /api/mosaic/limits', async () => {
      const mockLimits = { maxFiles: 10, maxPixels: 100000000 };
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockLimits),
      });

      const result = await getLimits();

      expect(mockFetch).toHaveBeenCalledWith('http://test:5001/api/mosaic/limits', {
        headers: {},
      });
      expect(result).toEqual(mockLimits);
    });

    it('should throw on error response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      });

      await expect(getLimits()).rejects.toThrow();
    });

    it('should include auth header when token available', async () => {
      setMosaicTokenGetter(() => 'limits-token');

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({}),
      });

      await getLimits();

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['Authorization']).toBe('Bearer limits-token');
    });
  });

  describe('getFootprints', () => {
    it('should POST to /api/mosaic/footprint with dataIds', async () => {
      const mockFootprints = { footprints: [], boundingBox: {} };
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockFootprints),
      });

      const dataIds = ['abc123', 'def456'];
      const result = await getFootprints(dataIds);

      expect(mockFetch).toHaveBeenCalledWith('http://test:5001/api/mosaic/footprint', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ dataIds }),
        signal: undefined,
      });
      expect(result).toEqual(mockFootprints);
    });

    it('should throw on error response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      });

      await expect(getFootprints(['abc'])).rejects.toThrow();
    });

    it('should pass abort signal', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({}),
      });
      const controller = new AbortController();

      await getFootprints(['abc'], controller.signal);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ signal: controller.signal })
      );
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

  describe('setMosaicTokenGetter', () => {
    it('should cause auth header to be included in requests', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        blob: vi.fn().mockResolvedValue(new Blob()),
      });

      setMosaicTokenGetter(() => 'my-mosaic-token');

      await generateMosaic({} as never);

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['Authorization']).toBe('Bearer my-mosaic-token');
    });

    it('should not include auth header when getter returns null and no localStorage', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        blob: vi.fn().mockResolvedValue(new Blob()),
      });

      setMosaicTokenGetter(() => null);

      await generateMosaic({} as never);

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['Authorization']).toBeUndefined();
    });
  });
});

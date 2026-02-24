/**
 * Unit tests for apiClient
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config/api', () => ({ API_BASE_URL: 'http://test:5001' }));

// DO NOT mock ApiError — use real implementation

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock localStorage
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

// Mock sessionStorage for auth logs
const mockSessionStorage = new Map<string, string>();
vi.stubGlobal('sessionStorage', {
  getItem: (key: string) => mockSessionStorage.get(key) ?? null,
  setItem: (key: string, val: string) => mockSessionStorage.set(key, val),
  removeItem: (key: string) => mockSessionStorage.delete(key),
  get length() {
    return mockSessionStorage.size;
  },
  key: (i: number) => [...mockSessionStorage.keys()][i] ?? null,
  clear: () => mockSessionStorage.clear(),
});

// console.warn spy will be set up in beforeEach to survive restoreAllMocks

import {
  apiClient,
  ApiClient,
  setTokenGetter,
  clearTokenGetter,
  setTokenRefresher,
  clearTokenRefresher,
  attemptTokenRefresh,
  getAuthLogs,
  printAuthLogs,
} from './apiClient';
import { ApiError } from './ApiError';

/** Helper to create a mock fetch Response */
function mockResponse(status: number, body: unknown = {}, ok?: boolean): Response {
  return {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    ok: ok ?? (status >= 200 && status < 300),
    url: 'http://test:5001/api/test',
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
    blob: vi.fn().mockResolvedValue(new Blob()),
  } as unknown as Response;
}

describe('apiClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.clear();
    mockSessionStorage.clear();
    // Suppress console.warn from authLog (re-spy each test since restoreAllMocks undoes it)
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    clearTokenGetter();
    clearTokenRefresher();
    // Clear any auth logs left by clearTokenRefresher above
    mockSessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('get', () => {
    it('should call fetch with GET method and correct URL', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, { data: 'test' }));

      const result = await apiClient.get('/api/test');

      expect(mockFetch).toHaveBeenCalledWith('http://test:5001/api/test', {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: undefined,
      });
      expect(result).toEqual({ data: 'test' });
    });

    it('should include auth header when token getter is set', async () => {
      setTokenGetter(() => 'test-token');
      mockFetch.mockResolvedValue(mockResponse(200, {}));

      await apiClient.get('/api/test');

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['Authorization']).toBe('Bearer test-token');
    });

    it('should fall back to localStorage token', async () => {
      mockStorage.set('jwst_auth_token', 'stored-token');
      mockFetch.mockResolvedValue(mockResponse(200, {}));

      await apiClient.get('/api/test');

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['Authorization']).toBe('Bearer stored-token');
    });

    it('should normalize endpoint without leading slash', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, {}));

      await apiClient.get('api/test');

      expect(mockFetch).toHaveBeenCalledWith('http://test:5001/api/test', expect.any(Object));
    });
  });

  describe('post', () => {
    it('should call fetch with POST method and JSON body', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, { id: '123' }));

      const result = await apiClient.post('/api/test', { name: 'value' });

      expect(mockFetch).toHaveBeenCalledWith('http://test:5001/api/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ name: 'value' }),
        signal: undefined,
      });
      expect(result).toEqual({ id: '123' });
    });

    it('should send undefined body when data is undefined', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, {}));

      await apiClient.post('/api/test');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ body: undefined })
      );
    });
  });

  describe('put', () => {
    it('should call fetch with PUT method and JSON body', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, { updated: true }));

      const result = await apiClient.put('/api/test/1', { name: 'updated' });

      expect(mockFetch).toHaveBeenCalledWith('http://test:5001/api/test/1', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ name: 'updated' }),
        signal: undefined,
      });
      expect(result).toEqual({ updated: true });
    });
  });

  describe('delete', () => {
    it('should call fetch with DELETE method', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, { deleted: true }));

      const result = await apiClient.delete('/api/test/1');

      expect(mockFetch).toHaveBeenCalledWith('http://test:5001/api/test/1', {
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
        },
        signal: undefined,
      });
      expect(result).toEqual({ deleted: true });
    });
  });

  describe('postFormData', () => {
    it('should call fetch with POST and FormData without Content-Type', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, { id: 'uploaded' }));

      const formData = new FormData();
      formData.append('file', new Blob(['data']), 'test.fits');

      const result = await apiClient.postFormData('/api/upload', formData);

      expect(mockFetch).toHaveBeenCalledWith('http://test:5001/api/upload', {
        method: 'POST',
        headers: {},
        body: formData,
        signal: undefined,
      });
      expect(result).toEqual({ id: 'uploaded' });
    });

    it('should not set Content-Type header (browser handles multipart boundary)', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, {}));

      await apiClient.postFormData('/api/upload', new FormData());

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['Content-Type']).toBeUndefined();
    });
  });

  describe('204 No Content', () => {
    it('should return undefined for 204 responses', async () => {
      const resp = {
        status: 204,
        statusText: 'No Content',
        ok: true,
        url: 'http://test:5001/api/test',
        json: vi.fn(),
        text: vi.fn(),
      } as unknown as Response;
      mockFetch.mockResolvedValue(resp);

      const result = await apiClient.post('/api/test', {});

      expect(result).toBeUndefined();
      expect(resp.json).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should throw ApiError on non-ok response', async () => {
      const errorResponse = {
        status: 400,
        statusText: 'Bad Request',
        ok: false,
        url: 'http://test:5001/api/test',
        json: vi.fn().mockResolvedValue({ error: 'Validation failed' }),
        text: vi.fn().mockResolvedValue(''),
      } as unknown as Response;
      mockFetch.mockResolvedValue(errorResponse);

      try {
        await apiClient.get('/api/test');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(ApiError.isApiError(err)).toBe(true);
        if (ApiError.isApiError(err)) {
          expect(err.status).toBe(400);
          expect(err.message).toBe('Validation failed');
        }
      }
    });
  });

  describe('401 retry with token refresh', () => {
    it('should retry request after successful token refresh', async () => {
      const refresher = vi.fn().mockResolvedValue(true);
      setTokenRefresher(refresher);
      setTokenGetter(() => 'new-token-after-refresh');

      const unauthorizedResponse = {
        status: 401,
        statusText: 'Unauthorized',
        ok: false,
        url: 'http://test:5001/api/test',
        json: vi.fn().mockResolvedValue({ error: 'Unauthorized' }),
        text: vi.fn().mockResolvedValue(''),
      } as unknown as Response;

      const successResponse = mockResponse(200, { data: 'success' });

      mockFetch.mockResolvedValueOnce(unauthorizedResponse).mockResolvedValueOnce(successResponse);

      const result = await apiClient.get('/api/test');

      expect(refresher).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ data: 'success' });
    });

    it('should not retry when skipAuthRetry is true', async () => {
      const refresher = vi.fn().mockResolvedValue(true);
      setTokenRefresher(refresher);

      const unauthorizedResponse = {
        status: 401,
        statusText: 'Unauthorized',
        ok: false,
        url: 'http://test:5001/api/test',
        json: vi.fn().mockResolvedValue({ error: 'Unauthorized' }),
        text: vi.fn().mockResolvedValue(''),
      } as unknown as Response;

      mockFetch.mockResolvedValue(unauthorizedResponse);

      try {
        await apiClient.get('/api/test', { skipAuthRetry: true });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(ApiError.isApiError(err)).toBe(true);
      }

      expect(refresher).not.toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should throw when refresh fails', async () => {
      const refresher = vi.fn().mockResolvedValue(false);
      setTokenRefresher(refresher);

      const unauthorizedResponse = {
        status: 401,
        statusText: 'Unauthorized',
        ok: false,
        url: 'http://test:5001/api/test',
        json: vi.fn().mockResolvedValue({ error: 'Unauthorized' }),
        text: vi.fn().mockResolvedValue(''),
      } as unknown as Response;

      mockFetch.mockResolvedValue(unauthorizedResponse);

      try {
        await apiClient.get('/api/test');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(ApiError.isApiError(err)).toBe(true);
      }

      expect(refresher).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should not retry when no refresher is set', async () => {
      const unauthorizedResponse = {
        status: 401,
        statusText: 'Unauthorized',
        ok: false,
        url: 'http://test:5001/api/test',
        json: vi.fn().mockResolvedValue({ error: 'Unauthorized' }),
        text: vi.fn().mockResolvedValue(''),
      } as unknown as Response;

      mockFetch.mockResolvedValue(unauthorizedResponse);

      try {
        await apiClient.get('/api/test');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(ApiError.isApiError(err)).toBe(true);
      }

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('setTokenGetter / clearTokenGetter', () => {
    it('should add auth header when token getter is set', async () => {
      setTokenGetter(() => 'my-token');
      mockFetch.mockResolvedValue(mockResponse(200, {}));

      await apiClient.get('/api/test');

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['Authorization']).toBe('Bearer my-token');
    });

    it('should remove auth header after clearing token getter', async () => {
      setTokenGetter(() => 'my-token');
      clearTokenGetter();
      mockFetch.mockResolvedValue(mockResponse(200, {}));

      await apiClient.get('/api/test');

      const headers = mockFetch.mock.calls[0][1].headers;
      // No token getter, no localStorage token => no Authorization header
      expect(headers['Authorization']).toBeUndefined();
    });
  });

  describe('setTokenRefresher / clearTokenRefresher', () => {
    it('should enable 401 retry when refresher is set', async () => {
      const refresher = vi.fn().mockResolvedValue(true);
      setTokenRefresher(refresher);

      const unauthorizedResponse = {
        status: 401,
        statusText: 'Unauthorized',
        ok: false,
        url: 'http://test:5001/api/test',
        json: vi.fn().mockResolvedValue({ error: 'Unauthorized' }),
        text: vi.fn().mockResolvedValue(''),
      } as unknown as Response;
      const successResponse = mockResponse(200, { ok: true });

      mockFetch.mockResolvedValueOnce(unauthorizedResponse).mockResolvedValueOnce(successResponse);

      const result = await apiClient.get('/api/test');
      expect(result).toEqual({ ok: true });
      expect(refresher).toHaveBeenCalled();
    });

    it('should disable 401 retry after clearing refresher', async () => {
      const refresher = vi.fn().mockResolvedValue(true);
      setTokenRefresher(refresher);
      clearTokenRefresher();

      const unauthorizedResponse = {
        status: 401,
        statusText: 'Unauthorized',
        ok: false,
        url: 'http://test:5001/api/test',
        json: vi.fn().mockResolvedValue({ error: 'Unauthorized' }),
        text: vi.fn().mockResolvedValue(''),
      } as unknown as Response;

      mockFetch.mockResolvedValue(unauthorizedResponse);

      // With no refresher set, it should not retry (it will use fallback which reads localStorage)
      // The fallback will fail because no refresh token in localStorage, so it throws
      try {
        await apiClient.get('/api/test');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(ApiError.isApiError(err)).toBe(true);
      }

      expect(refresher).not.toHaveBeenCalled();
    });
  });

  describe('attemptTokenRefresh', () => {
    it('should deduplicate concurrent refresh calls', async () => {
      let resolveRefresh: ((value: boolean) => void) | undefined;
      const refresher = vi.fn().mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            resolveRefresh = resolve;
          })
      );
      setTokenRefresher(refresher);

      const promise1 = attemptTokenRefresh();
      const promise2 = attemptTokenRefresh();

      // Only one refresh call should happen
      expect(refresher).toHaveBeenCalledTimes(1);

      if (!resolveRefresh) throw new Error('expected resolveRefresh');
      resolveRefresh(true);

      const [result1, result2] = await Promise.all([promise1, promise2]);
      expect(result1).toBe(true);
      expect(result2).toBe(true);
    });

    it('should return false when refresh throws', async () => {
      const refresher = vi.fn().mockRejectedValue(new Error('Refresh failed'));
      setTokenRefresher(refresher);

      const result = await attemptTokenRefresh();

      expect(result).toBe(false);
    });
  });

  describe('getAuthLogs / printAuthLogs', () => {
    it('should return empty array when no logs exist', () => {
      const logs = getAuthLogs();
      expect(logs).toEqual([]);
    });

    it('should return stored logs', () => {
      mockSessionStorage.set('jwst_auth_debug_log', JSON.stringify(['log entry 1', 'log entry 2']));

      const logs = getAuthLogs();
      expect(logs).toEqual(['log entry 1', 'log entry 2']);
    });

    it('should handle corrupted sessionStorage gracefully', () => {
      mockSessionStorage.set('jwst_auth_debug_log', 'not-json');

      const logs = getAuthLogs();
      expect(logs).toEqual([]);
    });

    it('printAuthLogs should call console.warn with logs', () => {
      mockSessionStorage.set('jwst_auth_debug_log', JSON.stringify(['entry1']));

      printAuthLogs();

      expect(console.warn).toHaveBeenCalledWith('=== Auth Debug Logs ===');
      expect(console.warn).toHaveBeenCalledWith('entry1');
      expect(console.warn).toHaveBeenCalledWith('=== 1 entries ===');
    });
  });

  describe('ApiClient class', () => {
    it('should be importable for custom instances', () => {
      expect(ApiClient).toBeDefined();
      const custom = new ApiClient('http://custom:9999');
      expect(custom).toBeDefined();
    });
  });
});

/**
 * Unit tests for healthService
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config/api', () => ({ API_BASE_URL: 'http://test:5001' }));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { checkHealth, isProcessingEngineHealthy } from './healthService';

describe('healthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('checkHealth', () => {
    it('should return health data on successful response', async () => {
      const healthData = {
        status: 'Healthy',
        checks: [
          { name: 'processing_engine', status: 'Healthy', description: null },
          { name: 'database', status: 'Healthy', description: null },
        ],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(healthData),
      });

      const result = await checkHealth();

      expect(result).toEqual(healthData);
      expect(mockFetch).toHaveBeenCalledWith('http://test:5001/api/health', {
        signal: expect.any(AbortSignal),
      });
    });

    it('should return Unhealthy status on non-ok response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
      });

      const result = await checkHealth();

      expect(result).toEqual({ status: 'Unhealthy', checks: [] });
    });

    it('should return null on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await checkHealth();

      expect(result).toBeNull();
    });

    it('should return null on timeout', async () => {
      mockFetch.mockRejectedValue(new globalThis.DOMException('Aborted', 'AbortError'));

      const result = await checkHealth();

      expect(result).toBeNull();
    });
  });

  describe('isProcessingEngineHealthy', () => {
    it('should return true when processing_engine check is Healthy', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          status: 'Healthy',
          checks: [{ name: 'processing_engine', status: 'Healthy', description: null }],
        }),
      });

      const result = await isProcessingEngineHealthy();

      expect(result).toBe(true);
    });

    it('should return false when processing_engine check is Unhealthy', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          status: 'Degraded',
          checks: [
            { name: 'processing_engine', status: 'Unhealthy', description: 'Connection refused' },
          ],
        }),
      });

      const result = await isProcessingEngineHealthy();

      expect(result).toBe(false);
    });

    it('should return false when processing_engine check is missing', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          status: 'Healthy',
          checks: [{ name: 'database', status: 'Healthy', description: null }],
        }),
      });

      const result = await isProcessingEngineHealthy();

      expect(result).toBe(false);
    });

    it('should return false when checkHealth returns null', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await isProcessingEngineHealthy();

      expect(result).toBe(false);
    });

    it('should return false when backend returns Unhealthy (empty checks)', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
      });

      const result = await isProcessingEngineHealthy();

      expect(result).toBe(false);
    });
  });
});

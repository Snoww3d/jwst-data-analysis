/**
 * Unit tests for ApiError
 */

import { describe, it, expect, vi } from 'vitest';
import { ApiError } from './ApiError';

/** Helper to create a mock Response */
const mockResponse = (status: number, statusText: string, body: unknown, isJson = true): Response =>
  ({
    status,
    statusText,
    ok: false,
    json: isJson
      ? vi.fn().mockResolvedValue(body)
      : vi.fn().mockRejectedValue(new Error('not json')),
    text: vi.fn().mockResolvedValue(typeof body === 'string' ? body : ''),
  }) as unknown as Response;

describe('ApiError', () => {
  describe('constructor', () => {
    it('should set all fields correctly', () => {
      const error = new ApiError('Something went wrong', 404, 'Not Found', 'Resource missing');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ApiError);
      expect(error.name).toBe('ApiError');
      expect(error.message).toBe('Something went wrong');
      expect(error.status).toBe(404);
      expect(error.statusText).toBe('Not Found');
      expect(error.details).toBe('Resource missing');
    });

    it('should allow undefined details', () => {
      const error = new ApiError('Server error', 500, 'Internal Server Error');

      expect(error.status).toBe(500);
      expect(error.statusText).toBe('Internal Server Error');
      expect(error.details).toBeUndefined();
    });
  });

  describe('isApiError', () => {
    it('should return true for ApiError instances', () => {
      const error = new ApiError('test', 400, 'Bad Request');
      expect(ApiError.isApiError(error)).toBe(true);
    });

    it('should return false for regular Error instances', () => {
      const error = new Error('test');
      expect(ApiError.isApiError(error)).toBe(false);
    });

    it('should return false for null', () => {
      expect(ApiError.isApiError(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(ApiError.isApiError(undefined)).toBe(false);
    });

    it('should return false for plain objects', () => {
      expect(ApiError.isApiError({ message: 'test', status: 400 })).toBe(false);
    });

    it('should return false for strings', () => {
      expect(ApiError.isApiError('some error')).toBe(false);
    });
  });

  describe('fromResponse', () => {
    it('should parse JSON body with error field', async () => {
      const response = mockResponse(400, 'Bad Request', {
        error: 'Validation failed',
        details: 'Field X is required',
      });

      const error = await ApiError.fromResponse(response);

      expect(error).toBeInstanceOf(ApiError);
      expect(error.status).toBe(400);
      expect(error.statusText).toBe('Bad Request');
      expect(error.message).toBe('Validation failed');
      expect(error.details).toBe('Field X is required');
    });

    it('should parse JSON body with message field', async () => {
      const response = mockResponse(403, 'Forbidden', {
        message: 'Access denied',
      });

      const error = await ApiError.fromResponse(response);

      expect(error.message).toBe('Access denied');
      // details falls back to errorData.error which is undefined
      expect(error.details).toBeUndefined();
    });

    it('should parse JSON body with details field only', async () => {
      const response = mockResponse(422, 'Unprocessable Entity', {
        details: 'Invalid payload structure',
      });

      const error = await ApiError.fromResponse(response);

      expect(error.message).toBe('Invalid payload structure');
      expect(error.details).toBe('Invalid payload structure');
    });

    it('should use default message when JSON has no recognized fields', async () => {
      const response = mockResponse(500, 'Internal Server Error', {
        foo: 'bar',
      });

      const error = await ApiError.fromResponse(response);

      expect(error.message).toBe('Request failed with status 500');
      expect(error.details).toBeUndefined();
    });

    it('should parse text body when JSON parsing fails', async () => {
      const response = mockResponse(502, 'Bad Gateway', 'Service unavailable', false);

      const error = await ApiError.fromResponse(response);

      expect(error.status).toBe(502);
      expect(error.statusText).toBe('Bad Gateway');
      expect(error.message).toBe('Service unavailable');
    });

    it('should use default message when body is empty and not JSON', async () => {
      const response = mockResponse(503, 'Service Unavailable', '', false);

      const error = await ApiError.fromResponse(response);

      expect(error.message).toBe('Request failed with status 503');
    });

    it('should use default message when both json and text fail', async () => {
      const response = {
        status: 504,
        statusText: 'Gateway Timeout',
        ok: false,
        json: vi.fn().mockRejectedValue(new Error('no json')),
        text: vi.fn().mockRejectedValue(new Error('no text')),
      } as unknown as Response;

      const error = await ApiError.fromResponse(response);

      expect(error.message).toBe('Request failed with status 504');
      expect(error.status).toBe(504);
    });

    it('should prefer error field over message and details', async () => {
      const response = mockResponse(400, 'Bad Request', {
        error: 'Primary error',
        message: 'Secondary message',
        details: 'Extra details',
      });

      const error = await ApiError.fromResponse(response);

      expect(error.message).toBe('Primary error');
      // details = errorData.details || errorData.error => 'Extra details'
      expect(error.details).toBe('Extra details');
    });
  });
});

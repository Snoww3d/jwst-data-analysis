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
    headers: new globalThis.Headers(isJson ? { 'content-type': 'application/json' } : {}),
    json: isJson
      ? vi.fn().mockResolvedValue(body)
      : vi.fn().mockRejectedValue(new Error('not json')),
    text: vi.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
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
      expect(error.details).toBe(
        JSON.stringify({ error: 'Validation failed', details: 'Field X is required' })
      );
    });

    it('should parse JSON body with message field', async () => {
      const response = mockResponse(403, 'Forbidden', {
        message: 'Access denied',
      });

      const error = await ApiError.fromResponse(response);

      expect(error.message).toBe('Access denied');
      expect(error.details).toBe(JSON.stringify({ message: 'Access denied' }));
    });

    it('should parse JSON body with details field only', async () => {
      const response = mockResponse(422, 'Unprocessable Entity', {
        details: 'Invalid payload structure',
      });

      const error = await ApiError.fromResponse(response);

      expect(error.message).toBe('Invalid payload structure');
      expect(error.details).toBe(JSON.stringify({ details: 'Invalid payload structure' }));
    });

    it('should use friendly message when JSON has no recognized fields', async () => {
      const response = mockResponse(500, 'Internal Server Error', {
        foo: 'bar',
      });

      const error = await ApiError.fromResponse(response);

      expect(error.message).toBe('Something went wrong on our end. Please try again.');
      expect(error.details).toBe(JSON.stringify({ foo: 'bar' }));
    });

    it('should surface short plaintext bodies verbatim', async () => {
      const response = mockResponse(502, 'Bad Gateway', 'Service unavailable', false);

      const error = await ApiError.fromResponse(response);

      expect(error.status).toBe(502);
      expect(error.statusText).toBe('Bad Gateway');
      expect(error.message).toBe('Service unavailable');
    });

    it('should use friendly message when body is empty and not JSON', async () => {
      const response = mockResponse(503, 'Service Unavailable', '', false);

      const error = await ApiError.fromResponse(response);

      expect(error.message).toBe(
        'The service is temporarily unavailable. Please try again in a moment.'
      );
    });

    it('should use friendly message when both json and text fail', async () => {
      const response = {
        status: 504,
        statusText: 'Gateway Timeout',
        ok: false,
        json: vi.fn().mockRejectedValue(new Error('no json')),
        text: vi.fn().mockRejectedValue(new Error('no text')),
      } as unknown as Response;

      const error = await ApiError.fromResponse(response);

      expect(error.message).toBe(
        'The service is temporarily unavailable. Please try again in a moment.'
      );
      expect(error.status).toBe(504);
    });

    it('should never surface an HTML error page as the message', async () => {
      const htmlHeaders = new globalThis.Headers({ 'content-type': 'text/html' });
      const nginxPage =
        '<html>\n<head><title>502 Bad Gateway</title></head>\n<body>\n<center><h1>502 Bad Gateway</h1></center>\n<hr><center>nginx/1.29.8</center>\n</body>\n</html>';
      const response = {
        status: 502,
        statusText: 'Bad Gateway',
        ok: false,
        headers: htmlHeaders,
        json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token '<'")),
        text: vi.fn().mockResolvedValue(nginxPage),
      } as unknown as Response;

      const error = await ApiError.fromResponse(response);

      expect(error.status).toBe(502);
      // Friendly message, NOT the raw nginx HTML page
      expect(error.message).toBe(
        'The service is temporarily unavailable. Please try again in a moment.'
      );
      expect(error.message).not.toContain('<html');
      expect(error.message).not.toContain('nginx');
      // The raw HTML page must not be stored anywhere the UI renders — several
      // consumers show `err.details || err.message`, so details must stay clean.
      expect(error.details).toBeUndefined();
      // json() should NOT have been called since content-type is html
      expect(response.json).not.toHaveBeenCalled();
    });

    it('should hide HTML bodies even without an html content-type', async () => {
      // Some proxies return an HTML page with a generic/absent content-type.
      const response = mockResponse(
        502,
        'Bad Gateway',
        '<!DOCTYPE html><html><body>502 Bad Gateway</body></html>',
        false
      );

      const error = await ApiError.fromResponse(response);

      expect(error.message).toBe(
        'The service is temporarily unavailable. Please try again in a moment.'
      );
      expect(error.message).not.toContain('<');
    });

    it('should hide oversized plaintext bodies behind a friendly message', async () => {
      const longBody = 'x'.repeat(500);
      const response = mockResponse(500, 'Internal Server Error', longBody, false);

      const error = await ApiError.fromResponse(response);

      expect(error.message).toBe('Something went wrong on our end. Please try again.');
      // Oversized body is not surfaced via message OR details.
      expect(error.details).toBeUndefined();
    });

    it('should keep the full JSON object in details (consumers read non-message fields)', async () => {
      // Regression guard: MastSearch checks err.details for the `suggestion`
      // field, which is not one of the message-extraction fields.
      const response = mockResponse(409, 'Conflict', {
        error: 'Cannot resume - download state lost and no files found',
        suggestion: 'Please start a new import',
      });

      const error = await ApiError.fromResponse(response);

      expect(error.message).toBe('Cannot resume - download state lost and no files found');
      expect(error.details).toContain('Please start a new import');
    });

    it('should extract a message from JSON sent without a json content-type', async () => {
      // Some proxies return JSON with a generic/absent content-type.
      const response = mockResponse(400, 'Bad Request', '{"error":"Field X is required"}', false);

      const error = await ApiError.fromResponse(response);

      expect(error.message).toBe('Field X is required');
    });

    it('should not treat a bare JSON null body as a plaintext message', async () => {
      const response = mockResponse(500, 'Internal Server Error', 'null', false);

      const error = await ApiError.fromResponse(response);

      expect(error.message).toBe('Something went wrong on our end. Please try again.');
    });

    it('should prefer error field over message and details', async () => {
      const response = mockResponse(400, 'Bad Request', {
        error: 'Primary error',
        message: 'Secondary message',
        details: 'Extra details',
      });

      const error = await ApiError.fromResponse(response);

      expect(error.message).toBe('Primary error');
      expect(error.details).toBe(
        JSON.stringify({
          error: 'Primary error',
          message: 'Secondary message',
          details: 'Extra details',
        })
      );
    });
  });
});

/**
 * TDD tests for safeParseJson — written BEFORE implementation.
 * Issue #658: API client calls response.json() without checking content-type
 */

import { describe, it, expect, vi } from 'vitest';
import { safeParseJson } from './responseUtils';

/** Helper to create a mock Response with configurable content-type */
function mockResponse(
  body: unknown,
  contentType: string | null,
  options?: { jsonThrows?: boolean }
): Response {
  const headers = new globalThis.Headers();
  if (contentType) {
    headers.set('content-type', contentType);
  }
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers,
    json: options?.jsonThrows
      ? vi.fn().mockRejectedValue(new SyntaxError('Unexpected token <'))
      : vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

describe('safeParseJson', () => {
  // --- Happy path: JSON content-types ---

  it('should parse JSON when content-type is application/json', async () => {
    const resp = mockResponse({ data: 'test' }, 'application/json');
    const result = await safeParseJson(resp);
    expect(result).toEqual({ data: 'test' });
  });

  it('should parse JSON when content-type includes charset', async () => {
    const resp = mockResponse({ id: 1 }, 'application/json; charset=utf-8');
    const result = await safeParseJson(resp);
    expect(result).toEqual({ id: 1 });
  });

  it('should parse JSON when content-type is application/problem+json', async () => {
    const resp = mockResponse({ type: 'error', title: 'Bad Request' }, 'application/problem+json');
    const result = await safeParseJson(resp);
    expect(result).toEqual({ type: 'error', title: 'Bad Request' });
  });

  // --- Error path: non-JSON content-types ---

  it('should throw with descriptive message when content-type is text/html', async () => {
    const htmlBody = '<html><body>502 Bad Gateway</body></html>';
    const resp = mockResponse(htmlBody, 'text/html');

    await expect(safeParseJson(resp)).rejects.toThrow(/expected JSON.*text\/html/i);
  });

  it('should throw with descriptive message when content-type is text/plain', async () => {
    const resp = mockResponse('Internal Server Error', 'text/plain');

    await expect(safeParseJson(resp)).rejects.toThrow(/expected JSON.*text\/plain/i);
  });

  it('should include response body snippet in error for non-JSON responses', async () => {
    const htmlBody = '<html><body>502 Bad Gateway</body></html>';
    const resp = mockResponse(htmlBody, 'text/html');

    await expect(safeParseJson(resp)).rejects.toThrow(/502 Bad Gateway/);
  });

  // --- Edge case: missing content-type header ---

  it('should attempt JSON parse when content-type is missing', async () => {
    const resp = mockResponse({ fallback: true }, null);
    const result = await safeParseJson(resp);
    expect(result).toEqual({ fallback: true });
  });

  it('should throw with descriptive message when content-type is missing and json() fails', async () => {
    const resp = mockResponse('<html>error</html>', null, {
      jsonThrows: true,
    });

    await expect(safeParseJson(resp)).rejects.toThrow(/failed to parse.*json/i);
  });

  // --- Edge case: truncation of long bodies ---

  it('should truncate long body text in error message', async () => {
    const longBody = 'x'.repeat(1000);
    const resp = mockResponse(longBody, 'text/plain');

    try {
      await safeParseJson(resp);
      expect.unreachable('Should have thrown');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg.length).toBeLessThan(500);
    }
  });
});

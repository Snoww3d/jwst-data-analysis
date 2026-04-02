/**
 * Utility for safely parsing JSON from fetch Response objects.
 * Checks content-type header before attempting JSON.parse to avoid
 * cryptic SyntaxError when backend returns HTML (nginx 502, ASP.NET error pages).
 */

/**
 * Safely parse a JSON response, checking content-type first.
 *
 * - If content-type contains "json", reads body as text then JSON.parse
 *   (avoids consuming the stream with .json() which prevents fallback reads)
 * - If content-type is non-JSON (text/html, text/plain, etc.), reads text and throws
 *   a descriptive error including the actual content-type and a body snippet
 * - If content-type is missing, reads body as text and attempts JSON.parse with
 *   a descriptive error fallback
 */
export async function safeParseJson<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type');

  // Content-type present and contains "json" (covers application/json, application/problem+json, etc.)
  // Read as text first so the body stream isn't consumed if JSON.parse fails
  if (contentType?.includes('json')) {
    const text = await response.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      const snippet = text.length > 200 ? text.slice(0, 200) + '...' : text;
      throw new Error(
        `Expected JSON (content-type: ${contentType}) but failed to parse: ${snippet}`
      );
    }
  }

  // Content-type present but NOT json — don't even try to parse
  if (contentType) {
    const body = await response.text();
    const snippet = body.length > 200 ? body.slice(0, 200) + '...' : body;
    throw new Error(`Expected JSON response but got ${contentType}: ${snippet}`);
  }

  // No content-type header — read as text first (body stream can only be read once),
  // then try JSON.parse. This avoids consuming the stream with .json() and losing
  // the body content for diagnostics if parsing fails.
  const body = await response.text();
  try {
    return JSON.parse(body) as T;
  } catch {
    const snippet = body.length > 200 ? body.slice(0, 200) + '...' : body;
    throw new Error(`Failed to parse response as JSON (no content-type header): ${snippet}`);
  }
}

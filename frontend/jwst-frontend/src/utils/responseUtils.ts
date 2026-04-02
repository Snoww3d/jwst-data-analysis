/**
 * Utility for safely parsing JSON from fetch Response objects.
 * Checks content-type header before attempting JSON.parse to avoid
 * cryptic SyntaxError when backend returns HTML (nginx 502, ASP.NET error pages).
 */

/**
 * Safely parse a JSON response, checking content-type first.
 *
 * - If content-type contains "json", calls response.json()
 * - If content-type is non-JSON (text/html, text/plain, etc.), reads text and throws
 *   a descriptive error including the actual content-type and a body snippet
 * - If content-type is missing, attempts response.json() with a fallback to a
 *   descriptive error if parsing fails
 */
export async function safeParseJson<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type');

  // Content-type present and contains "json" (covers application/json, application/problem+json, etc.)
  if (contentType?.includes('json')) {
    return response.json();
  }

  // Content-type present but NOT json — don't even try .json()
  if (contentType) {
    const body = await response.text();
    const snippet = body.length > 200 ? body.slice(0, 200) + '...' : body;
    throw new Error(`Expected JSON response but got ${contentType}: ${snippet}`);
  }

  // No content-type header — optimistically try .json(), fall back to descriptive error
  try {
    return await response.json();
  } catch {
    const body = await response.text();
    const snippet = body.length > 200 ? body.slice(0, 200) + '...' : body;
    throw new Error(`Failed to parse response as JSON (no content-type header): ${snippet}`);
  }
}

/**
 * Custom error class for API errors with status code and details
 */

/** Non-JSON bodies longer than this are treated as opaque and hidden behind a
 *  friendly status message (a real proxy/plaintext error is short; a full HTML
 *  error page is not). */
const MAX_TEXT_MESSAGE_LENGTH = 300;

/**
 * Human-readable fallback message for a status code, used when the response body
 * carries nothing worth showing the user (empty, HTML error page, opaque proxy
 * output). These are deliberately generic and reassuring rather than technical.
 */
export function friendlyStatusMessage(status: number, statusText?: string): string {
  switch (status) {
    case 408:
      return 'The request timed out. Please try again.';
    case 429:
      return 'Too many requests. Please wait a moment and try again.';
    case 500:
      return 'Something went wrong on our end. Please try again.';
    case 502:
    case 503:
    case 504:
      return 'The service is temporarily unavailable. Please try again in a moment.';
    default:
      if (status >= 500) {
        return 'The service is temporarily unavailable. Please try again in a moment.';
      }
      return statusText
        ? `Request failed: ${statusText} (${status})`
        : `Request failed with status ${status}`;
  }
}

/**
 * Heuristic: does this body look like an HTML document (e.g. an nginx 502 page)
 * rather than a useful, human-readable error string? Such bodies must never be
 * surfaced to the user as the error message.
 */
function looksLikeHtml(text: string): boolean {
  const trimmed = text.trimStart().toLowerCase();
  return (
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<html') ||
    trimmed.startsWith('<head') ||
    trimmed.startsWith('<body') ||
    trimmed.startsWith('<')
  );
}

/**
 * Pull a human-readable message out of a parsed backend error body, checking the
 * fields the backend uses in priority order. Returns undefined for non-objects
 * or when no string field is present.
 */
function extractMessage(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const obj = data as Record<string, unknown>;
  for (const key of ['error', 'message', 'details'] as const) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

export class ApiError extends Error {
  status: number;
  statusText: string;
  details?: string;

  constructor(message: string, status: number, statusText: string, details?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.statusText = statusText;
    this.details = details;
  }

  /**
   * Type guard to check if an error is an ApiError
   */
  static isApiError(error: unknown): error is ApiError {
    return error instanceof ApiError;
  }

  /**
   * Create an ApiError from a fetch Response.
   *
   * Neither `message` nor `details` may ever carry an opaque body (an nginx
   * "502 Bad Gateway" HTML page, a proxy timeout page) — some consumers render
   * `err.details || err.message`, so both fields have to stay safe to display.
   *
   *   - Structured backend JSON errors keep their original contract: `message`
   *     is the extracted `error`/`message`/`details` field and `details` is the
   *     full stringified object (consumers such as MastSearch rely on `details`
   *     containing every field, e.g. `suggestion`).
   *   - A non-JSON body is only surfaced when it is short, non-HTML plaintext
   *     (or short JSON we can extract a message from). HTML, empty, or oversized
   *     bodies fall back to a friendly status message and are never stored on
   *     the error (they're logged in dev for debugging instead).
   */
  static async fromResponse(response: Response): Promise<ApiError> {
    let message = friendlyStatusMessage(response.status, response.statusText);
    let details: string | undefined;

    // Read body as text first — the body stream can only be consumed once,
    // so reading .json() then falling back to .text() loses the content.
    try {
      const text = await response.text();
      const contentType = response.headers?.get('content-type');
      const isJson = contentType?.includes('json') ?? false;
      const isHtml = (contentType?.includes('html') ?? false) || (!!text && looksLikeHtml(text));

      if (isJson && text) {
        // Structured backend error — preserve the original contract exactly.
        try {
          const errorData = JSON.parse(text);
          message = extractMessage(errorData) ?? message;
          details = JSON.stringify(errorData);
        } catch {
          // JSON parse failed despite content-type — keep the friendly message.
          // Do not surface the raw body (could be an HTML error page mislabeled
          // as JSON); it's logged below for debugging.
        }
      } else if (text && !isHtml) {
        // Non-JSON, non-HTML body. Some proxies send JSON without a json
        // content-type — try to extract a message before treating it as plain
        // text, and only surface short plaintext verbatim.
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = undefined;
        }
        const extracted = extractMessage(parsed);
        if (extracted) {
          message = extracted;
        } else if (parsed === undefined && text.length <= MAX_TEXT_MESSAGE_LENGTH) {
          message = text;
        }
        // else: JSON without a known field, or oversized plaintext → keep the
        // friendly fallback.
      }
      // HTML/empty/oversized bodies intentionally fall through with the friendly
      // message and no details.

      if (import.meta.env.DEV && text && details === undefined && message !== text) {
        // Debug aid: surface the raw error body we deliberately hide from users
        // so gateway failures are still diagnosable in dev.
        console.warn(`[ApiError] ${response.status} response body (not shown to user):`, text);
      }
    } catch {
      // Body unreadable — use the friendly status message
    }

    return new ApiError(message, response.status, response.statusText, details);
  }
}

/**
 * Custom error class for API errors with status code and details
 */
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
   * Create an ApiError from a fetch Response
   */
  static async fromResponse(response: Response): Promise<ApiError> {
    let message = `Request failed with status ${response.status}`;
    let details: string | undefined;

    // Read body as text first — the body stream can only be consumed once,
    // so reading .json() then falling back to .text() loses the content.
    try {
      const text = await response.text();
      const contentType = response.headers?.get('content-type');
      const isJson = contentType?.includes('json') ?? false;

      if (isJson && text) {
        try {
          const errorData = JSON.parse(text);
          // Handle various error response formats from the backend
          message = errorData.error || errorData.message || errorData.details || message;
          details = JSON.stringify(errorData);
        } catch {
          // JSON parse failed despite content-type — use raw text
          message = text;
        }
      } else if (text) {
        message = text;
      }
    } catch {
      // Body unreadable — use default message
    }

    return new ApiError(message, response.status, response.statusText, details);
  }
}

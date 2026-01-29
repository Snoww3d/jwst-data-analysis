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

    try {
      const errorData = await response.json();
      // Handle various error response formats from the backend
      message = errorData.error || errorData.message || errorData.details || message;
      details = errorData.details || errorData.error;
    } catch {
      // Response body wasn't JSON, try text
      try {
        const text = await response.text();
        if (text) {
          message = text;
        }
      } catch {
        // Ignore - use default message
      }
    }

    return new ApiError(message, response.status, response.statusText, details);
  }
}

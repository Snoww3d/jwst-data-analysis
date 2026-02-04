/**
 * Core API client for making HTTP requests to the backend
 *
 * Provides:
 * - Automatic base URL prefixing
 * - Default headers for JSON requests
 * - Consistent error handling
 * - Support for FormData (no Content-Type override)
 * - Generic typing for responses
 * - JWT authentication header injection
 */

import { API_BASE_URL } from '../config/api';
import { ApiError } from './ApiError';

type RequestOptions = {
  signal?: AbortSignal;
  /** Skip 401 retry logic - used for auth endpoints to prevent infinite loops */
  skipAuthRetry?: boolean;
};

// Token getter function - set by AuthContext
let getAccessToken: (() => string | null) | null = null;

// Token refresh callback - set by AuthContext
let refreshTokenCallback: (() => Promise<boolean>) | null = null;
let refreshPromise: Promise<boolean> | null = null;

/**
 * Set the function used to retrieve the current access token.
 * Called by AuthContext on mount to enable automatic auth header injection.
 */
export function setTokenGetter(getter: () => string | null): void {
  getAccessToken = getter;
}

/**
 * Clear the token getter (used on logout)
 */
export function clearTokenGetter(): void {
  getAccessToken = null;
}

/**
 * Set the function used to refresh the access token.
 * Called by AuthContext on mount to enable automatic 401 retry.
 */
export function setTokenRefresher(refresher: () => Promise<boolean>): void {
  refreshTokenCallback = refresher;
}

/**
 * Clear the token refresher (used on logout)
 */
export function clearTokenRefresher(): void {
  refreshTokenCallback = null;
  refreshPromise = null;
}

/**
 * Attempt to refresh the token, preventing concurrent refresh calls.
 * Uses a shared promise to ensure only one refresh happens at a time.
 */
async function attemptTokenRefresh(): Promise<boolean> {
  if (!refreshTokenCallback) return false;

  // If refresh already in progress, wait for it
  if (refreshPromise) {
    return refreshPromise;
  }

  // Start new refresh
  refreshPromise = refreshTokenCallback();
  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * Get authorization headers if a token is available
   */
  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    const token = getAccessToken?.();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  /**
   * Build full URL from endpoint
   */
  private buildUrl(endpoint: string): string {
    // Ensure endpoint starts with /
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    return `${this.baseUrl}${normalizedEndpoint}`;
  }

  /**
   * Handle response and parse JSON or throw ApiError
   */
  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      throw await ApiError.fromResponse(response);
    }

    // Handle empty responses (204 No Content)
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json();
  }

  /**
   * Handle response with automatic 401 retry after token refresh.
   * If response is 401 and we have a refresh callback, attempt to refresh
   * the token and retry the original request once.
   */
  private async handleResponseWithRetry<T>(
    response: Response,
    retryFn: () => Promise<Response>,
    skipAuthRetry?: boolean
  ): Promise<T> {
    // If 401 and we have a refresh callback (and not skipping), try to refresh and retry
    if (response.status === 401 && refreshTokenCallback && !skipAuthRetry) {
      const refreshed = await attemptTokenRefresh();
      if (refreshed) {
        // Retry the original request with new token
        const retryResponse = await retryFn();
        return this.handleResponse<T>(retryResponse);
      }
    }

    return this.handleResponse<T>(response);
  }

  /**
   * GET request
   */
  async get<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    const makeRequest = () =>
      fetch(this.buildUrl(endpoint), {
        method: 'GET',
        headers: {
          ...this.getAuthHeaders(),
          Accept: 'application/json',
        },
        signal: options?.signal,
      });

    const response = await makeRequest();
    return this.handleResponseWithRetry<T>(response, makeRequest, options?.skipAuthRetry);
  }

  /**
   * POST request with JSON body
   */
  async post<T>(endpoint: string, data?: unknown, options?: RequestOptions): Promise<T> {
    const makeRequest = () =>
      fetch(this.buildUrl(endpoint), {
        method: 'POST',
        headers: {
          ...this.getAuthHeaders(),
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: data !== undefined ? JSON.stringify(data) : undefined,
        signal: options?.signal,
      });

    const response = await makeRequest();
    return this.handleResponseWithRetry<T>(response, makeRequest, options?.skipAuthRetry);
  }

  /**
   * POST request with FormData body (for file uploads)
   * Does not set Content-Type - browser sets it automatically with boundary
   */
  async postFormData<T>(
    endpoint: string,
    formData: FormData,
    options?: RequestOptions
  ): Promise<T> {
    const makeRequest = () =>
      fetch(this.buildUrl(endpoint), {
        method: 'POST',
        headers: {
          ...this.getAuthHeaders(),
        },
        body: formData,
        signal: options?.signal,
      });

    const response = await makeRequest();
    return this.handleResponseWithRetry<T>(response, makeRequest, options?.skipAuthRetry);
  }

  /**
   * PUT request with JSON body
   */
  async put<T>(endpoint: string, data?: unknown, options?: RequestOptions): Promise<T> {
    const makeRequest = () =>
      fetch(this.buildUrl(endpoint), {
        method: 'PUT',
        headers: {
          ...this.getAuthHeaders(),
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: data !== undefined ? JSON.stringify(data) : undefined,
        signal: options?.signal,
      });

    const response = await makeRequest();
    return this.handleResponseWithRetry<T>(response, makeRequest, options?.skipAuthRetry);
  }

  /**
   * DELETE request
   */
  async delete<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    const makeRequest = () =>
      fetch(this.buildUrl(endpoint), {
        method: 'DELETE',
        headers: {
          ...this.getAuthHeaders(),
          Accept: 'application/json',
        },
        signal: options?.signal,
      });

    const response = await makeRequest();
    return this.handleResponseWithRetry<T>(response, makeRequest, options?.skipAuthRetry);
  }
}

// Export singleton instance
export const apiClient = new ApiClient();

// Export class for testing or custom instances
export { ApiClient };

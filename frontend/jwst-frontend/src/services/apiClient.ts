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
};

// Token getter function - set by AuthContext
let getAccessToken: (() => string | null) | null = null;

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
   * GET request
   */
  async get<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    const response = await fetch(this.buildUrl(endpoint), {
      method: 'GET',
      headers: {
        ...this.getAuthHeaders(),
        Accept: 'application/json',
      },
      signal: options?.signal,
    });

    return this.handleResponse<T>(response);
  }

  /**
   * POST request with JSON body
   */
  async post<T>(endpoint: string, data?: unknown, options?: RequestOptions): Promise<T> {
    const response = await fetch(this.buildUrl(endpoint), {
      method: 'POST',
      headers: {
        ...this.getAuthHeaders(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: data !== undefined ? JSON.stringify(data) : undefined,
      signal: options?.signal,
    });

    return this.handleResponse<T>(response);
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
    const response = await fetch(this.buildUrl(endpoint), {
      method: 'POST',
      headers: {
        ...this.getAuthHeaders(),
      },
      body: formData,
      signal: options?.signal,
    });

    return this.handleResponse<T>(response);
  }

  /**
   * PUT request with JSON body
   */
  async put<T>(endpoint: string, data?: unknown, options?: RequestOptions): Promise<T> {
    const response = await fetch(this.buildUrl(endpoint), {
      method: 'PUT',
      headers: {
        ...this.getAuthHeaders(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: data !== undefined ? JSON.stringify(data) : undefined,
      signal: options?.signal,
    });

    return this.handleResponse<T>(response);
  }

  /**
   * DELETE request
   */
  async delete<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    const response = await fetch(this.buildUrl(endpoint), {
      method: 'DELETE',
      headers: {
        ...this.getAuthHeaders(),
        Accept: 'application/json',
      },
      signal: options?.signal,
    });

    return this.handleResponse<T>(response);
  }
}

// Export singleton instance
export const apiClient = new ApiClient();

// Export class for testing or custom instances
export { ApiClient };

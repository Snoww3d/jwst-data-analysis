/**
 * Core API client for making HTTP requests to the backend
 *
 * Provides:
 * - Automatic base URL prefixing
 * - Default headers for JSON requests
 * - Consistent error handling
 * - Support for FormData (no Content-Type override)
 * - Generic typing for responses
 */

import { API_BASE_URL } from '../config/api';
import { ApiError } from './ApiError';

type RequestOptions = {
  signal?: AbortSignal;
};

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
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
        'Accept': 'application/json',
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
        'Content-Type': 'application/json',
        'Accept': 'application/json',
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
  async postFormData<T>(endpoint: string, formData: FormData, options?: RequestOptions): Promise<T> {
    const response = await fetch(this.buildUrl(endpoint), {
      method: 'POST',
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
        'Content-Type': 'application/json',
        'Accept': 'application/json',
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
        'Accept': 'application/json',
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

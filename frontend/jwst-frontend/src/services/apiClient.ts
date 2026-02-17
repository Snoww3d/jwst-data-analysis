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

// Persistent auth debug log - survives page redirects
const AUTH_LOG_KEY = 'jwst_auth_debug_log';
const MAX_LOG_ENTRIES = 50;

function authLog(message: string, data?: unknown): void {
  const timestamp = new Date().toISOString();
  const entry = data
    ? `${timestamp} ${message} ${JSON.stringify(data)}`
    : `${timestamp} ${message}`;

  // Also log to console for immediate visibility
  console.warn('[Auth]', message, data ?? '');

  // Store in sessionStorage for persistence across redirects
  try {
    const existing = sessionStorage.getItem(AUTH_LOG_KEY);
    const logs: string[] = existing ? JSON.parse(existing) : [];
    logs.push(entry);
    // Keep only last N entries
    while (logs.length > MAX_LOG_ENTRIES) logs.shift();
    sessionStorage.setItem(AUTH_LOG_KEY, JSON.stringify(logs));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Get stored auth debug logs (call from browser console: getAuthLogs())
 */
export function getAuthLogs(): string[] {
  try {
    const stored = sessionStorage.getItem(AUTH_LOG_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

/**
 * Print auth logs to console (call from browser console: printAuthLogs())
 */
export function printAuthLogs(): void {
  const logs = getAuthLogs();
  console.warn('=== Auth Debug Logs ===');
  logs.forEach((log) => console.warn(log));
  console.warn(`=== ${logs.length} entries ===`);
}

// Expose to window for easy console access
if (typeof window !== 'undefined') {
  (
    window as unknown as { getAuthLogs: typeof getAuthLogs; printAuthLogs: typeof printAuthLogs }
  ).getAuthLogs = getAuthLogs;
  (window as unknown as { printAuthLogs: typeof printAuthLogs }).printAuthLogs = printAuthLogs;
}

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
  authLog('setTokenRefresher called', { wasNull: refreshTokenCallback === null });
  refreshTokenCallback = refresher;
}

/**
 * Clear the token refresher (used on logout)
 */
export function clearTokenRefresher(): void {
  authLog('clearTokenRefresher called', { wasSet: refreshTokenCallback !== null });
  refreshTokenCallback = null;
  refreshPromise = null;
}

// Storage keys matching AuthContext
const STORAGE_KEYS = {
  ACCESS_TOKEN: 'jwst_auth_token',
  REFRESH_TOKEN: 'jwst_refresh_token',
  USER: 'jwst_user',
  EXPIRES_AT: 'jwst_expires_at',
};

/** Retry delays for fallback refresh (keeps apiClient decoupled from AuthContext) */
const FALLBACK_RETRY_DELAYS = [1000, 3000];

/**
 * Fallback token refresh that reads directly from localStorage.
 * Used when AuthContext hasn't registered its callback yet (timing issue).
 * Retries up to 3 times (initial + 2 retries) with backoff before clearing auth.
 */
async function fallbackTokenRefresh(): Promise<boolean> {
  const refreshToken = localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
  authLog('Fallback refresh: checking localStorage', { hasToken: !!refreshToken });

  if (!refreshToken) {
    return false;
  }

  const doRefresh = async (): Promise<boolean> => {
    const { authService } = await import('./authService');
    const response = await authService.refreshToken({ refreshToken });

    localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, response.accessToken);
    localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, response.refreshToken);
    localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(response.user));
    localStorage.setItem(STORAGE_KEYS.EXPIRES_AT, response.expiresAt);

    authLog('Fallback refresh succeeded');
    return true;
  };

  // Attempt 1 (initial)
  try {
    return await doRefresh();
  } catch {
    authLog('Fallback refresh attempt 1 failed, will retry');
  }

  // Retry attempts
  for (let i = 0; i < FALLBACK_RETRY_DELAYS.length; i++) {
    authLog(`Fallback refresh: waiting ${FALLBACK_RETRY_DELAYS[i]}ms before retry ${i + 2}/3`);
    await new Promise((resolve) => setTimeout(resolve, FALLBACK_RETRY_DELAYS[i]));
    try {
      return await doRefresh();
    } catch (err) {
      authLog(
        `Fallback refresh attempt ${i + 2} failed:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  // All retries exhausted — clear auth
  authLog('Fallback refresh: all retries exhausted, clearing auth');
  localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
  localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
  localStorage.removeItem(STORAGE_KEYS.USER);
  localStorage.removeItem(STORAGE_KEYS.EXPIRES_AT);
  return false;
}

/**
 * Attempt to refresh the token, preventing concurrent refresh calls.
 * Uses a shared promise to ensure only one refresh happens at a time.
 * Falls back to direct localStorage refresh if callback not registered.
 */
export async function attemptTokenRefresh(): Promise<boolean> {
  // If refresh already in progress, wait for it
  if (refreshPromise) {
    authLog('Token refresh already in progress, waiting...');
    return refreshPromise;
  }

  // Use callback if available, otherwise fallback to direct localStorage refresh
  const refreshFn = refreshTokenCallback || fallbackTokenRefresh;
  authLog('Attempting token refresh...', { usingCallback: !!refreshTokenCallback });

  refreshPromise = refreshFn();
  try {
    const result = await refreshPromise;
    authLog('Token refresh result:', result ? 'success' : 'failed');
    return result;
  } catch (err) {
    authLog('Token refresh threw error:', err instanceof Error ? err.message : String(err));
    return false;
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
   * Get authorization headers if a token is available.
   * Falls back to localStorage if callback not registered.
   */
  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    // Try callback first, then fallback to localStorage
    const token = getAccessToken?.() || localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
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
    if (response.status === 401) {
      authLog('Received 401', {
        url: response.url,
        hasRefreshCallback: !!refreshTokenCallback,
        skipAuthRetry: !!skipAuthRetry,
      });
      if (refreshTokenCallback && !skipAuthRetry) {
        const refreshed = await attemptTokenRefresh();
        if (refreshed) {
          authLog('Retrying request after successful refresh');
          // Retry the original request with new token
          const retryResponse = await retryFn();
          return this.handleResponse<T>(retryResponse);
        }
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

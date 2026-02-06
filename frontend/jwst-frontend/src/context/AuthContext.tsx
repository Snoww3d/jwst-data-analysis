/**
 * Authentication context provider
 *
 * Provides global auth state and methods:
 * - Persistent login via localStorage
 * - Automatic token refresh before expiry
 * - Login, register, logout methods
 */

import { createContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import {
  authService,
  setTokenGetter,
  clearTokenGetter,
  setTokenRefresher,
  clearTokenRefresher,
  setCompositeTokenGetter,
  setMosaicTokenGetter,
} from '../services';
import type {
  AuthContextType,
  AuthState,
  LoginRequest,
  RegisterRequest,
  TokenResponse,
  UserInfo,
} from '../types/AuthTypes';
import { AuthToast, type AuthToastHandle } from '../components/AuthToast';

/**
 * Retry delays in ms for token refresh attempts (initial call + 2 retries).
 */
const RETRY_DELAYS = [1000, 3000];
const LOGOUT_DELAY_MS = 1500;

/**
 * Retry a token-refresh function up to 3 times with backoff.
 * Pure async — callers handle toasts and logout.
 */
async function retryRefreshToken<T>(
  refreshFn: () => Promise<T>,
  onRetrying?: (attempt: number) => void
): Promise<T> {
  // Attempt 1 (initial)
  try {
    return await refreshFn();
  } catch (firstErr) {
    // Retry attempts
    for (let i = 0; i < RETRY_DELAYS.length; i++) {
      onRetrying?.(i + 2);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[i]));
      try {
        return await refreshFn();
      } catch {
        // continue to next retry
      }
    }
    // All retries exhausted — rethrow original error
    throw firstErr;
  }
}

// localStorage keys
const STORAGE_KEYS = {
  ACCESS_TOKEN: 'jwst_auth_token',
  REFRESH_TOKEN: 'jwst_refresh_token',
  USER: 'jwst_user',
  EXPIRES_AT: 'jwst_expires_at',
};

// Initial auth state
const initialState: AuthState = {
  user: null,
  accessToken: null,
  refreshToken: null,
  expiresAt: null,
  isAuthenticated: false,
  isLoading: true,
};

// Create context with undefined default - exported for useAuth hook
export const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Load auth state from localStorage
 */
function loadStoredAuth(): AuthState {
  try {
    const accessToken = localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
    const refreshToken = localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
    const userJson = localStorage.getItem(STORAGE_KEYS.USER);
    const expiresAtStr = localStorage.getItem(STORAGE_KEYS.EXPIRES_AT);

    if (accessToken && refreshToken && userJson && expiresAtStr) {
      const user = JSON.parse(userJson) as UserInfo;
      const expiresAt = new Date(expiresAtStr);

      // Check if token is still valid (with 60s buffer)
      const now = new Date();
      const bufferMs = 60 * 1000;
      if (expiresAt.getTime() - bufferMs > now.getTime()) {
        return {
          user,
          accessToken,
          refreshToken,
          expiresAt,
          isAuthenticated: true,
          isLoading: false,
        };
      }
    }
  } catch {
    // Clear corrupted data
    clearStoredAuth();
  }

  return { ...initialState, isLoading: false };
}

/**
 * Save auth state to localStorage
 */
function saveAuth(response: TokenResponse): void {
  localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, response.accessToken);
  localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, response.refreshToken);
  localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(response.user));
  localStorage.setItem(STORAGE_KEYS.EXPIRES_AT, response.expiresAt);
}

/**
 * Clear auth state from localStorage
 */
function clearStoredAuth(): void {
  localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
  localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
  localStorage.removeItem(STORAGE_KEYS.USER);
  localStorage.removeItem(STORAGE_KEYS.EXPIRES_AT);
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>(initialState);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastRef = useRef<AuthToastHandle>(null);

  /**
   * Update state from token response
   */
  const updateStateFromResponse = useCallback((response: TokenResponse): void => {
    saveAuth(response);
    setState({
      user: response.user,
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      expiresAt: new Date(response.expiresAt),
      isAuthenticated: true,
      isLoading: false,
    });
  }, []);

  /**
   * Clear state on logout
   */
  const clearState = useCallback((): void => {
    clearStoredAuth();
    clearTokenGetter();
    clearTokenRefresher();
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    setState({
      user: null,
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      isAuthenticated: false,
      isLoading: false,
    });
  }, []);

  /**
   * Refresh the access token with retry logic.
   * Shows a warning toast during retries and an error toast before logout.
   */
  const refreshAuth = useCallback(async (): Promise<boolean> => {
    const currentRefreshToken = state.refreshToken;
    if (!currentRefreshToken) {
      clearState();
      return false;
    }

    try {
      const response = await retryRefreshToken(
        () => authService.refreshToken({ refreshToken: currentRefreshToken }),
        (attempt) => {
          toastRef.current?.show(`Connection lost — retrying (${attempt}/3)...`, 'warning');
        }
      );
      toastRef.current?.hide();
      updateStateFromResponse(response);
      return true;
    } catch {
      toastRef.current?.show('Session expired — please log in again.', 'error');
      await new Promise((resolve) => setTimeout(resolve, LOGOUT_DELAY_MS));
      clearState();
      return false;
    }
  }, [state.refreshToken, updateStateFromResponse, clearState]);

  /**
   * Schedule token refresh before expiry
   */
  const scheduleRefresh = useCallback(
    (expiresAt: Date): void => {
      // Clear existing timer
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }

      // Calculate time until refresh (60 seconds before expiry)
      const now = Date.now();
      const expiresAtMs = expiresAt.getTime();
      const refreshBufferMs = 60 * 1000;
      const timeUntilRefresh = expiresAtMs - now - refreshBufferMs;

      if (timeUntilRefresh > 0) {
        refreshTimerRef.current = setTimeout(() => {
          refreshAuth();
        }, timeUntilRefresh);
      } else {
        // Token already expired or about to, refresh now
        refreshAuth();
      }
    },
    [refreshAuth]
  );

  /**
   * Login with username/password
   */
  const login = useCallback(
    async (request: LoginRequest): Promise<void> => {
      setState((prev) => ({ ...prev, isLoading: true }));
      try {
        const response = await authService.login(request);
        updateStateFromResponse(response);
      } catch (error) {
        setState((prev) => ({ ...prev, isLoading: false }));
        throw error;
      }
    },
    [updateStateFromResponse]
  );

  /**
   * Register a new account
   */
  const register = useCallback(
    async (request: RegisterRequest): Promise<void> => {
      setState((prev) => ({ ...prev, isLoading: true }));
      try {
        const response = await authService.register(request);
        updateStateFromResponse(response);
      } catch (error) {
        setState((prev) => ({ ...prev, isLoading: false }));
        throw error;
      }
    },
    [updateStateFromResponse]
  );

  /**
   * Logout the current user
   */
  const logout = useCallback(async (): Promise<void> => {
    try {
      // Try to revoke token on server (ignore errors)
      await authService.logout().catch(() => {});
    } finally {
      clearState();
    }
  }, [clearState]);

  // Initialize: load stored auth and set up token getter/refresher
  useEffect(() => {
    const stored = loadStoredAuth();
    setState(stored);

    // Set up token getter for API client
    setTokenGetter(() => {
      const token = localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
      return token;
    });

    // Set up token getter for composite service
    setCompositeTokenGetter(() => {
      const token = localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
      return token;
    });

    // Set up token getter for mosaic service
    setMosaicTokenGetter(() => {
      const token = localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
      return token;
    });

    // Set up token refresher for API client 401 handling.
    // This function is called by apiClient when a 401 is received.
    // It reads from localStorage to avoid stale closure issues.
    // toastRef is a stable ref, safe to capture in this closure.
    setTokenRefresher(async () => {
      const refreshToken = localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
      console.warn('[AuthContext] Refresh callback invoked, hasRefreshToken:', !!refreshToken);
      if (!refreshToken) {
        console.warn('[AuthContext] No refresh token in localStorage');
        return false;
      }

      try {
        const response = await retryRefreshToken(
          () => {
            console.warn('[AuthContext] Calling authService.refreshToken...');
            return authService.refreshToken({ refreshToken });
          },
          (attempt) => {
            console.warn(`[AuthContext] Retry attempt ${attempt}/3`);
            toastRef.current?.show(`Connection lost — retrying (${attempt}/3)...`, 'warning');
          }
        );
        console.warn('[AuthContext] Refresh succeeded, saving new tokens');
        toastRef.current?.hide();
        saveAuth(response);
        setState({
          user: response.user,
          accessToken: response.accessToken,
          refreshToken: response.refreshToken,
          expiresAt: new Date(response.expiresAt),
          isAuthenticated: true,
          isLoading: false,
        });
        return true;
      } catch (err) {
        console.warn(
          '[AuthContext] Refresh failed after retries:',
          err instanceof Error ? err.message : String(err)
        );
        toastRef.current?.show('Session expired — please log in again.', 'error');
        await new Promise((resolve) => setTimeout(resolve, LOGOUT_DELAY_MS));
        clearStoredAuth();
        setState({
          user: null,
          accessToken: null,
          refreshToken: null,
          expiresAt: null,
          isAuthenticated: false,
          isLoading: false,
        });
        return false;
      }
    });

    // Clean up on unmount
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
      clearTokenRefresher();
    };
  }, []);

  // Schedule refresh when token changes
  useEffect(() => {
    if (state.isAuthenticated && state.expiresAt) {
      scheduleRefresh(state.expiresAt);
    }
  }, [state.isAuthenticated, state.expiresAt, scheduleRefresh]);

  const value: AuthContextType = {
    ...state,
    login,
    register,
    logout,
    refreshAuth,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
      <AuthToast ref={toastRef} />
    </AuthContext.Provider>
  );
}

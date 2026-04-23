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
} from '../services';
import type {
  AuthContextType,
  AuthState,
  LoginRequest,
  RegisterRequest,
  TokenResponse,
  UserInfo,
} from '../types/AuthTypes';
import { toast } from '../components/ui/toast';

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
// eslint-disable-next-line react-refresh/only-export-components -- context must be exported for useAuth hook
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

      // Access token expired but refresh token exists — signal "needs refresh".
      // Keep isLoading: true so the app shows a spinner instead of the login page.
      return {
        user,
        accessToken: null,
        refreshToken,
        expiresAt: null,
        isAuthenticated: false,
        isLoading: true,
      };
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
  const logoutDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionIdRef = useRef<number>(0);

  /**
   * Update state from token response
   */
  const updateStateFromResponse = useCallback((response: TokenResponse): void => {
    saveAuth(response);
    // Re-register token getter — may have been cleared by clearState on session expiry.
    // The mount useEffect only runs once, so this ensures re-login works within the same lifecycle.
    setTokenGetter(() => localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN));
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
   * Clear state on logout. Increments sessionId to invalidate in-flight
   * async operations that capture it before calling setState.
   */
  const clearState = useCallback((): void => {
    sessionIdRef.current++;
    clearStoredAuth();
    clearTokenGetter();
    clearTokenRefresher();
    if (logoutDelayRef.current) {
      clearTimeout(logoutDelayRef.current);
      logoutDelayRef.current = null;
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
   * Refresh the access token.
   * Reads refresh token from localStorage to avoid stale closure issues.
   * Retries once after 1s, then immediately deauths on failure.
   */
  const refreshAuth = useCallback(async (): Promise<boolean> => {
    const currentRefreshToken = localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
    if (!currentRefreshToken) {
      clearState();
      return false;
    }

    const sessionId = sessionIdRef.current;
    const doRefresh = () => authService.refreshToken({ refreshToken: currentRefreshToken });

    try {
      let response: TokenResponse;
      try {
        response = await doRefresh();
      } catch {
        await new Promise((resolve) => {
          logoutDelayRef.current = setTimeout(resolve, 1000);
        });
        logoutDelayRef.current = null;
        if (sessionIdRef.current !== sessionId) return false;
        response = await doRefresh();
      }
      if (sessionIdRef.current !== sessionId) return false;
      updateStateFromResponse(response);
      return true;
    } catch {
      if (sessionIdRef.current !== sessionId) return false;
      clearState();
      toast.error('Session expired — please log in again.');
      return false;
    }
  }, [updateStateFromResponse, clearState]);

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

    // If access token expired but refresh token exists, attempt refresh
    if (!stored.isAuthenticated && stored.refreshToken) {
      const sessionId = sessionIdRef.current;
      const doRefresh = () =>
        authService.refreshToken({ refreshToken: stored.refreshToken as string });

      (async () => {
        try {
          let response: TokenResponse;
          try {
            response = await doRefresh();
          } catch {
            await new Promise((resolve) => {
              logoutDelayRef.current = setTimeout(resolve, 1000);
            });
            logoutDelayRef.current = null;
            if (sessionIdRef.current !== sessionId) return;
            response = await doRefresh();
          }
          if (sessionIdRef.current !== sessionId) return;
          console.warn('[AuthContext] Init refresh succeeded');
          saveAuth(response);
          setState({
            user: response.user,
            accessToken: response.accessToken,
            refreshToken: response.refreshToken,
            expiresAt: new Date(response.expiresAt),
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (err) {
          console.warn(
            '[AuthContext] Init refresh failed:',
            err instanceof Error ? err.message : String(err)
          );
          if (sessionIdRef.current !== sessionId) return;
          clearStoredAuth();
          setState({
            user: null,
            accessToken: null,
            refreshToken: null,
            expiresAt: null,
            isAuthenticated: false,
            isLoading: false,
          });
        }
      })();
    }

    // Set up token getter for API client (composite/mosaic services
    // now route through apiClient, so this single getter covers all)
    setTokenGetter(() => {
      const token = localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
      return token;
    });

    // Set up token refresher for API client 401 handling.
    // This function is called by apiClient when a 401 is received.
    // It reads from localStorage to avoid stale closure issues.
    // sessionIdRef is a stable ref, safe to capture.
    setTokenRefresher(async () => {
      const refreshToken = localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
      console.warn('[AuthContext] Refresh callback invoked, hasRefreshToken:', !!refreshToken);
      if (!refreshToken) {
        console.warn('[AuthContext] No refresh token in localStorage');
        return false;
      }

      const sessionId = sessionIdRef.current;
      const doRefresh = () => {
        console.warn('[AuthContext] Calling authService.refreshToken...');
        return authService.refreshToken({ refreshToken });
      };

      try {
        let response: TokenResponse;
        try {
          response = await doRefresh();
        } catch {
          await new Promise((resolve) => {
            logoutDelayRef.current = setTimeout(resolve, 1000);
          });
          logoutDelayRef.current = null;
          if (sessionIdRef.current !== sessionId) return false;
          response = await doRefresh();
        }
        if (sessionIdRef.current !== sessionId) return false;
        console.warn('[AuthContext] Refresh succeeded, saving new tokens');
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
          '[AuthContext] Refresh failed:',
          err instanceof Error ? err.message : String(err)
        );
        if (sessionIdRef.current !== sessionId) return false;
        // Clear stored tokens and state but keep getter/refresher registered —
        // they read from localStorage and must survive for re-login within the same lifecycle.
        // clearState (used by logout) handles full cleanup including getter/refresher.
        clearStoredAuth();
        setState({
          user: null,
          accessToken: null,
          refreshToken: null,
          expiresAt: null,
          isAuthenticated: false,
          isLoading: false,
        });
        toast.error('Session expired — please log in again.');
        return false;
      }
    });

    // Clean up on unmount
    return () => {
      sessionIdRef.current++; // eslint-disable-line react-hooks/exhaustive-deps -- writing (not reading) ref to invalidate in-flight async; false positive
      if (logoutDelayRef.current) {
        clearTimeout(logoutDelayRef.current);
      }
      clearTokenRefresher();
    };
  }, []);

  const value: AuthContextType = {
    ...state,
    login,
    register,
    logout,
    refreshAuth,
  };

  return <AuthContext value={value}>{children}</AuthContext>;
}

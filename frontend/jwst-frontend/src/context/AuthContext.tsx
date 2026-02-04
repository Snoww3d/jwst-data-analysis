/**
 * Authentication context provider
 *
 * Provides global auth state and methods:
 * - Persistent login via localStorage
 * - Automatic token refresh before expiry
 * - Login, register, logout methods
 */

import { createContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { authService, setTokenGetter, clearTokenGetter } from '../services';
import type {
  AuthContextType,
  AuthState,
  LoginRequest,
  RegisterRequest,
  TokenResponse,
  UserInfo,
} from '../types/AuthTypes';

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
   * Refresh the access token
   */
  const refreshAuth = useCallback(async (): Promise<boolean> => {
    const currentRefreshToken = state.refreshToken;
    if (!currentRefreshToken) {
      clearState();
      return false;
    }

    try {
      const response = await authService.refreshToken({
        refreshToken: currentRefreshToken,
      });
      updateStateFromResponse(response);
      return true;
    } catch {
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

  // Initialize: load stored auth and set up token getter
  useEffect(() => {
    const stored = loadStoredAuth();
    setState(stored);

    // Set up token getter for API client
    setTokenGetter(() => {
      const token = localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
      return token;
    });

    // Clean up on unmount
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
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

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

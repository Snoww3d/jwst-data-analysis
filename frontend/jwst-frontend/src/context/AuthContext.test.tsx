/**
 * Unit tests for AuthContext and useAuth hook
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from './AuthContext';
import { useAuth } from './useAuth';

// Mock the services index which AuthContext imports from
// Note: vi.mock is hoisted to top of file, so we can't reference external variables
vi.mock('../services', () => ({
  authService: {
    login: vi.fn(),
    register: vi.fn(),
    refreshToken: vi.fn(),
    logout: vi.fn(),
    getCurrentUser: vi.fn(),
  },
  setTokenGetter: vi.fn(),
  clearTokenGetter: vi.fn(),
  setTokenRefresher: vi.fn(),
  clearTokenRefresher: vi.fn(),
  attemptTokenRefresh: vi.fn().mockResolvedValue(true),
  setCompositeTokenGetter: vi.fn(),
  setMosaicTokenGetter: vi.fn(),
}));

// Import the mocked module to access and configure mocks
import {
  authService,
  setTokenGetter,
  clearTokenGetter,
  setTokenRefresher,
  clearTokenRefresher,
} from '../services';

// Test component that uses the auth context
function TestComponent() {
  const { user, isAuthenticated, isLoading, login, logout, register } = useAuth();

  return (
    <div>
      <div data-testid="loading">{isLoading ? 'loading' : 'not-loading'}</div>
      <div data-testid="authenticated">
        {isAuthenticated ? 'authenticated' : 'not-authenticated'}
      </div>
      <div data-testid="username">{user?.username || 'no-user'}</div>
      <button onClick={() => login({ username: 'testuser', password: 'testpass' })}>Login</button>
      <button
        onClick={() =>
          register({
            username: 'newuser',
            email: 'new@example.com',
            password: 'newpass',
          })
        }
      >
        Register
      </button>
      <button onClick={() => logout()}>Logout</button>
    </div>
  );
}

describe('AuthContext', () => {
  const mockTokenResponse = {
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    expiresAt: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
    tokenType: 'Bearer',
    user: {
      id: '123',
      username: 'testuser',
      email: 'test@example.com',
      role: 'User',
      createdAt: '2026-02-03T00:00:00Z',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Clear localStorage before each test
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe('initial state', () => {
    it('should start with loading state', async () => {
      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      // After initial render and useEffect, loading should be false
      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('not-loading');
      });
    });

    it('should start as not authenticated when no stored auth', async () => {
      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('authenticated')).toHaveTextContent('not-authenticated');
      });
    });

    it('should set up token getter on mount', async () => {
      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(setTokenGetter).toHaveBeenCalled();
      });
    });

    it('should set up token refresher on mount', async () => {
      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(setTokenRefresher).toHaveBeenCalled();
      });
    });
  });

  describe('login', () => {
    it('should update state after successful login', async () => {
      vi.mocked(authService.login).mockResolvedValue(mockTokenResponse);

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      const user = userEvent.setup();
      await user.click(screen.getByText('Login'));

      await waitFor(() => {
        expect(screen.getByTestId('authenticated')).toHaveTextContent('authenticated');
        expect(screen.getByTestId('username')).toHaveTextContent('testuser');
      });
    });

    it('should store auth data in localStorage after login', async () => {
      vi.mocked(authService.login).mockResolvedValue(mockTokenResponse);

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      const user = userEvent.setup();
      await user.click(screen.getByText('Login'));

      await waitFor(() => {
        expect(localStorage.getItem('jwst_auth_token')).toBe('test-access-token');
        expect(localStorage.getItem('jwst_refresh_token')).toBe('test-refresh-token');
        expect(localStorage.getItem('jwst_user')).toContain('testuser');
      });
    });

    it('should call authService.login with correct credentials', async () => {
      vi.mocked(authService.login).mockResolvedValue(mockTokenResponse);

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      const user = userEvent.setup();
      await user.click(screen.getByText('Login'));

      expect(authService.login).toHaveBeenCalledWith({
        username: 'testuser',
        password: 'testpass',
      });
    });
  });

  describe('register', () => {
    it('should update state after successful registration', async () => {
      const registerResponse = {
        ...mockTokenResponse,
        user: {
          ...mockTokenResponse.user,
          username: 'newuser',
          email: 'new@example.com',
        },
      };
      vi.mocked(authService.register).mockResolvedValue(registerResponse);

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      const user = userEvent.setup();
      await user.click(screen.getByText('Register'));

      await waitFor(() => {
        expect(screen.getByTestId('authenticated')).toHaveTextContent('authenticated');
        expect(screen.getByTestId('username')).toHaveTextContent('newuser');
      });
    });

    it('should call authService.register with correct data', async () => {
      vi.mocked(authService.register).mockResolvedValue(mockTokenResponse);

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      const user = userEvent.setup();
      await user.click(screen.getByText('Register'));

      expect(authService.register).toHaveBeenCalledWith({
        username: 'newuser',
        email: 'new@example.com',
        password: 'newpass',
      });
    });
  });

  describe('logout', () => {
    it('should clear auth state after logout', async () => {
      // First login
      vi.mocked(authService.login).mockResolvedValue(mockTokenResponse);
      vi.mocked(authService.logout).mockResolvedValue(undefined);

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      const user = userEvent.setup();

      // Login first
      await user.click(screen.getByText('Login'));
      await waitFor(() => {
        expect(screen.getByTestId('authenticated')).toHaveTextContent('authenticated');
      });

      // Then logout
      await user.click(screen.getByText('Logout'));
      await waitFor(() => {
        expect(screen.getByTestId('authenticated')).toHaveTextContent('not-authenticated');
        expect(screen.getByTestId('username')).toHaveTextContent('no-user');
      });
    });

    it('should clear localStorage after logout', async () => {
      vi.mocked(authService.login).mockResolvedValue(mockTokenResponse);
      vi.mocked(authService.logout).mockResolvedValue(undefined);

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      const user = userEvent.setup();

      // Login first
      await user.click(screen.getByText('Login'));
      await waitFor(() => {
        expect(localStorage.getItem('jwst_auth_token')).toBe('test-access-token');
      });

      // Then logout
      await user.click(screen.getByText('Logout'));
      await waitFor(() => {
        expect(localStorage.getItem('jwst_auth_token')).toBeNull();
        expect(localStorage.getItem('jwst_refresh_token')).toBeNull();
        expect(localStorage.getItem('jwst_user')).toBeNull();
      });
    });

    it('should call clearTokenGetter and clearTokenRefresher after logout', async () => {
      vi.mocked(authService.login).mockResolvedValue(mockTokenResponse);
      vi.mocked(authService.logout).mockResolvedValue(undefined);

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      const user = userEvent.setup();

      await user.click(screen.getByText('Login'));
      await waitFor(() => {
        expect(screen.getByTestId('authenticated')).toHaveTextContent('authenticated');
      });

      await user.click(screen.getByText('Logout'));
      await waitFor(() => {
        expect(clearTokenGetter).toHaveBeenCalled();
        expect(clearTokenRefresher).toHaveBeenCalled();
      });
    });
  });

  describe('useAuth hook', () => {
    it('should throw error when used outside AuthProvider', () => {
      // Suppress console.error for this test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        render(<TestComponent />);
      }).toThrow('useAuth must be used within an AuthProvider');

      consoleSpy.mockRestore();
    });
  });

  describe('token refresh retry', () => {
    it('should retry on transient failure then succeed', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      // Pre-populate localStorage so AuthProvider starts authenticated
      const futureExpiry = new Date(Date.now() + 3600000).toISOString();
      localStorage.setItem('jwst_auth_token', 'stored-token');
      localStorage.setItem('jwst_refresh_token', 'stored-refresh');
      localStorage.setItem(
        'jwst_user',
        JSON.stringify({
          id: '456',
          username: 'storeduser',
          email: 'stored@example.com',
          role: 'User',
          createdAt: '2026-02-03T00:00:00Z',
        })
      );
      localStorage.setItem('jwst_expires_at', futureExpiry);

      // First call fails, second succeeds
      vi.mocked(authService.refreshToken)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(mockTokenResponse);

      // Capture the refresher callback when setTokenRefresher is called
      let capturedRefresher: (() => Promise<boolean>) | null = null;
      vi.mocked(setTokenRefresher).mockImplementation((fn) => {
        capturedRefresher = fn;
      });

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('authenticated')).toHaveTextContent('authenticated');
        expect(capturedRefresher).not.toBeNull();
      });

      // Invoke the captured refresher (simulates 401 path)
      if (!capturedRefresher) throw new Error('refresher not captured');
      const doRefresh: () => Promise<boolean> = capturedRefresher;
      let refreshPromise: Promise<boolean> | undefined;
      await act(async () => {
        refreshPromise = doRefresh();
        // Advance past the 1s retry delay
        await vi.advanceTimersByTimeAsync(1100);
      });

      const result = await refreshPromise;
      expect(result).toBe(true);
      expect(authService.refreshToken).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('should log out after all retries exhausted', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      // Pre-populate localStorage so AuthProvider starts authenticated
      const futureExpiry = new Date(Date.now() + 3600000).toISOString();
      localStorage.setItem('jwst_auth_token', 'stored-token');
      localStorage.setItem('jwst_refresh_token', 'stored-refresh');
      localStorage.setItem(
        'jwst_user',
        JSON.stringify({
          id: '456',
          username: 'storeduser',
          email: 'stored@example.com',
          role: 'User',
          createdAt: '2026-02-03T00:00:00Z',
        })
      );
      localStorage.setItem('jwst_expires_at', futureExpiry);

      // All calls fail
      vi.mocked(authService.refreshToken).mockRejectedValue(new Error('Server down'));

      let capturedRefresher: (() => Promise<boolean>) | null = null;
      vi.mocked(setTokenRefresher).mockImplementation((fn) => {
        capturedRefresher = fn;
      });

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('authenticated')).toHaveTextContent('authenticated');
        expect(capturedRefresher).not.toBeNull();
      });

      // Invoke the captured refresher and advance through all delays
      if (!capturedRefresher) throw new Error('refresher not captured');
      const doRefresh: () => Promise<boolean> = capturedRefresher;
      let refreshPromise: Promise<boolean> | undefined;
      await act(async () => {
        refreshPromise = doRefresh();
        // Advance past retry delays: 1s + 3s
        await vi.advanceTimersByTimeAsync(1100);
        await vi.advanceTimersByTimeAsync(3100);
        // Advance past the 1.5s logout delay
        await vi.advanceTimersByTimeAsync(1600);
      });

      const result = await refreshPromise;
      expect(result).toBe(false);
      expect(authService.refreshToken).toHaveBeenCalledTimes(3);

      // Auth should be cleared
      await waitFor(() => {
        expect(localStorage.getItem('jwst_auth_token')).toBeNull();
      });

      vi.useRealTimers();
    });
  });

  describe('stored auth restoration', () => {
    it('should restore auth state from localStorage on mount', async () => {
      // Pre-populate localStorage
      const futureExpiry = new Date(Date.now() + 3600000).toISOString();
      localStorage.setItem('jwst_auth_token', 'stored-token');
      localStorage.setItem('jwst_refresh_token', 'stored-refresh');
      localStorage.setItem(
        'jwst_user',
        JSON.stringify({
          id: '456',
          username: 'storeduser',
          email: 'stored@example.com',
          role: 'User',
          createdAt: '2026-02-03T00:00:00Z',
        })
      );
      localStorage.setItem('jwst_expires_at', futureExpiry);

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('authenticated')).toHaveTextContent('authenticated');
        expect(screen.getByTestId('username')).toHaveTextContent('storeduser');
      });
    });

    it('should not restore expired auth state', async () => {
      // Pre-populate localStorage with expired token
      const pastExpiry = new Date(Date.now() - 3600000).toISOString();
      localStorage.setItem('jwst_auth_token', 'expired-token');
      localStorage.setItem('jwst_refresh_token', 'expired-refresh');
      localStorage.setItem(
        'jwst_user',
        JSON.stringify({
          id: '456',
          username: 'expireduser',
          email: 'expired@example.com',
          role: 'User',
          createdAt: '2026-02-03T00:00:00Z',
        })
      );
      localStorage.setItem('jwst_expires_at', pastExpiry);

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('authenticated')).toHaveTextContent('not-authenticated');
      });
    });
  });
});

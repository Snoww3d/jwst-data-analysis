/**
 * Unit tests for authService
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authService } from './authService';
import { apiClient } from './apiClient';

// Mock the apiClient
vi.mock('./apiClient', () => ({
  apiClient: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));

describe('authService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('login', () => {
    it('should call apiClient.post with correct endpoint and data', async () => {
      const mockResponse = {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: '2026-02-04T00:00:00Z',
        tokenType: 'Bearer',
        user: {
          id: '123',
          username: 'testuser',
          email: 'test@example.com',
          role: 'User',
          createdAt: '2026-02-03T00:00:00Z',
        },
      };

      vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

      const result = await authService.login({
        username: 'testuser',
        password: 'testpass',
      });

      expect(apiClient.post).toHaveBeenCalledWith('/api/auth/login', {
        username: 'testuser',
        password: 'testpass',
      });
      expect(result).toEqual(mockResponse);
    });

    it('should propagate errors from apiClient', async () => {
      const error = new Error('Invalid credentials');
      vi.mocked(apiClient.post).mockRejectedValue(error);

      await expect(authService.login({ username: 'bad', password: 'bad' })).rejects.toThrow(
        'Invalid credentials'
      );
    });
  });

  describe('register', () => {
    it('should call apiClient.post with correct endpoint and data', async () => {
      const mockResponse = {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: '2026-02-04T00:00:00Z',
        tokenType: 'Bearer',
        user: {
          id: '123',
          username: 'newuser',
          email: 'new@example.com',
          role: 'User',
          createdAt: '2026-02-03T00:00:00Z',
        },
      };

      vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

      const result = await authService.register({
        username: 'newuser',
        email: 'new@example.com',
        password: 'newpass123',
        displayName: 'New User',
        organization: 'Test Org',
      });

      expect(apiClient.post).toHaveBeenCalledWith('/api/auth/register', {
        username: 'newuser',
        email: 'new@example.com',
        password: 'newpass123',
        displayName: 'New User',
        organization: 'Test Org',
      });
      expect(result).toEqual(mockResponse);
    });

    it('should handle registration without optional fields', async () => {
      const mockResponse = {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: '2026-02-04T00:00:00Z',
        tokenType: 'Bearer',
        user: {
          id: '123',
          username: 'newuser',
          email: 'new@example.com',
          role: 'User',
          createdAt: '2026-02-03T00:00:00Z',
        },
      };

      vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

      await authService.register({
        username: 'newuser',
        email: 'new@example.com',
        password: 'newpass123',
      });

      expect(apiClient.post).toHaveBeenCalledWith('/api/auth/register', {
        username: 'newuser',
        email: 'new@example.com',
        password: 'newpass123',
      });
    });
  });

  describe('refreshToken', () => {
    it('should call apiClient.post with correct endpoint and refresh token', async () => {
      const mockResponse = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresAt: '2026-02-04T00:00:00Z',
        tokenType: 'Bearer',
        user: {
          id: '123',
          username: 'testuser',
          email: 'test@example.com',
          role: 'User',
          createdAt: '2026-02-03T00:00:00Z',
        },
      };

      vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

      const result = await authService.refreshToken({
        refreshToken: 'old-refresh-token',
      });

      expect(apiClient.post).toHaveBeenCalledWith('/api/auth/refresh', {
        refreshToken: 'old-refresh-token',
      });
      expect(result).toEqual(mockResponse);
    });
  });

  describe('logout', () => {
    it('should call apiClient.post with correct endpoint', async () => {
      vi.mocked(apiClient.post).mockResolvedValue(undefined);

      await authService.logout();

      expect(apiClient.post).toHaveBeenCalledWith('/api/auth/logout');
    });
  });

  describe('getCurrentUser', () => {
    it('should call apiClient.get with correct endpoint', async () => {
      const mockUser = {
        id: '123',
        username: 'testuser',
        email: 'test@example.com',
        role: 'User',
        createdAt: '2026-02-03T00:00:00Z',
      };

      vi.mocked(apiClient.get).mockResolvedValue(mockUser);

      const result = await authService.getCurrentUser();

      expect(apiClient.get).toHaveBeenCalledWith('/api/auth/me');
      expect(result).toEqual(mockUser);
    });
  });
});

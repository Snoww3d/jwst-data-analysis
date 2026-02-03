/**
 * Authentication service for JWT-based auth
 *
 * Provides methods for:
 * - User login and registration
 * - Token refresh
 * - Logout
 * - Current user retrieval
 */

import { apiClient } from './apiClient';
import type {
  LoginRequest,
  RegisterRequest,
  RefreshTokenRequest,
  TokenResponse,
  UserInfo,
} from '../types/AuthTypes';

class AuthService {
  /**
   * Login with username and password
   * Returns tokens and user info on success
   */
  async login(request: LoginRequest): Promise<TokenResponse> {
    return apiClient.post<TokenResponse>('/api/auth/login', request);
  }

  /**
   * Register a new user account
   * Returns tokens and user info on success
   */
  async register(request: RegisterRequest): Promise<TokenResponse> {
    return apiClient.post<TokenResponse>('/api/auth/register', request);
  }

  /**
   * Refresh the access token using a refresh token
   * Returns new tokens on success
   */
  async refreshToken(request: RefreshTokenRequest): Promise<TokenResponse> {
    return apiClient.post<TokenResponse>('/api/auth/refresh', request);
  }

  /**
   * Logout the current user (revokes refresh token)
   * Requires authentication
   */
  async logout(): Promise<void> {
    return apiClient.post<void>('/api/auth/logout');
  }

  /**
   * Get the current authenticated user's info
   * Requires authentication
   */
  async getCurrentUser(): Promise<UserInfo> {
    return apiClient.get<UserInfo>('/api/auth/me');
  }
}

// Export singleton instance
export const authService = new AuthService();

// Export class for testing
export { AuthService };

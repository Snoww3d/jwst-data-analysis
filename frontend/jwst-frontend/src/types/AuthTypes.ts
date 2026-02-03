/**
 * Authentication-related TypeScript types
 *
 * These types mirror the backend JWT authentication models.
 */

export interface LoginRequest {
  username: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
  displayName?: string;
  organization?: string;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  tokenType: string;
  user: UserInfo;
}

export interface UserInfo {
  id: string;
  username: string;
  email: string;
  role: string;
  displayName?: string;
  organization?: string;
  createdAt: string;
  lastLoginAt?: string;
}

export interface AuthState {
  user: UserInfo | null;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface AuthContextType extends AuthState {
  login: (request: LoginRequest) => Promise<void>;
  register: (request: RegisterRequest) => Promise<void>;
  logout: () => Promise<void>;
  refreshAuth: () => Promise<boolean>;
}

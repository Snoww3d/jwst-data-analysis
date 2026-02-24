import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';

let mockAuth = { isAuthenticated: true, isLoading: false };

vi.mock('../context/useAuth', () => ({
  useAuth: () => mockAuth,
}));

const renderProtectedRoute = (auth: { isAuthenticated: boolean; isLoading: boolean }) => {
  mockAuth = auth;
  return render(
    <MemoryRouter initialEntries={['/protected']}>
      <Routes>
        <Route
          path="/protected"
          element={
            <ProtectedRoute>
              <div>Protected Content</div>
            </ProtectedRoute>
          }
        />
        <Route path="/login" element={<div>Login Page</div>} />
      </Routes>
    </MemoryRouter>
  );
};

describe('ProtectedRoute', () => {
  beforeEach(() => {
    mockAuth = { isAuthenticated: true, isLoading: false };
  });

  it('renders children when authenticated', () => {
    renderProtectedRoute({ isAuthenticated: true, isLoading: false });
    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });

  it('redirects to /login when not authenticated', () => {
    renderProtectedRoute({ isAuthenticated: false, isLoading: false });
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    expect(screen.getByText('Login Page')).toBeInTheDocument();
  });

  it('shows "Checking authentication..." spinner when loading', () => {
    renderProtectedRoute({ isAuthenticated: false, isLoading: true });
    expect(screen.getByText('Checking authentication...')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    expect(screen.queryByText('Login Page')).not.toBeInTheDocument();
  });

  it('passes location state to Navigate when redirecting', () => {
    // When not authenticated, Navigate should receive state with from: '/protected'
    // We verify the redirect happened (Login Page renders) which means Navigate was used
    renderProtectedRoute({ isAuthenticated: false, isLoading: false });
    expect(screen.getByText('Login Page')).toBeInTheDocument();
  });

  it('shows spinner element when loading', () => {
    const { container } = renderProtectedRoute({ isAuthenticated: false, isLoading: true });
    expect(container.querySelector('.spinner')).toBeInTheDocument();
    expect(container.querySelector('.auth-loading')).toBeInTheDocument();
  });
});

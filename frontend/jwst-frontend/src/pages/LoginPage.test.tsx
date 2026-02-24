import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockLogin = vi.fn();
const mockNavigate = vi.fn();

vi.mock('../context/useAuth', () => ({
  useAuth: () => ({
    login: mockLogin,
    isAuthenticated: false,
    isLoading: false,
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../services', () => ({
  ApiError: { isApiError: (err: unknown) => err && typeof err === 'object' && 'status' in err },
}));

import { LoginPage } from './LoginPage';

const renderLoginPage = () =>
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>
  );

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders login form with username and password fields', () => {
    renderLoginPage();

    expect(screen.getByLabelText('Username or Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
  });

  it('shows "Sign in to your account" text', () => {
    renderLoginPage();

    expect(screen.getByText('Sign in to your account')).toBeInTheDocument();
  });

  it('shows "Create one" link to register', () => {
    renderLoginPage();

    const link = screen.getByText('Create one');
    expect(link).toBeInTheDocument();
    expect(link.closest('a')).toHaveAttribute('href', '/register');
  });

  it('submit with empty username shows validation error', async () => {
    renderLoginPage();

    // Leave username empty, type a password
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(screen.getByText('Username or email is required')).toBeInTheDocument();
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('submit with empty password shows validation error', async () => {
    renderLoginPage();

    fireEvent.change(screen.getByLabelText('Username or Email'), { target: { value: 'testuser' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('successful login calls login and navigates', async () => {
    mockLogin.mockResolvedValue(undefined);
    renderLoginPage();

    fireEvent.change(screen.getByLabelText('Username or Email'), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith({ username: 'testuser', password: 'password123' });
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
    });
  });

  it('failed login with 401 shows "Invalid username or password"', async () => {
    mockLogin.mockRejectedValue({ status: 401, message: 'Unauthorized' });
    renderLoginPage();

    fireEvent.change(screen.getByLabelText('Username or Email'), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrongpass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(screen.getByText('Invalid username or password')).toBeInTheDocument();
    });
  });

  it('failed login with other API error shows error message', async () => {
    mockLogin.mockRejectedValue({ status: 500, message: 'Server error occurred' });
    renderLoginPage();

    fireEvent.change(screen.getByLabelText('Username or Email'), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(screen.getByText('Server error occurred')).toBeInTheDocument();
    });
  });

  it('non-API error shows generic message', async () => {
    mockLogin.mockRejectedValue(new Error('Network error'));
    renderLoginPage();

    fireEvent.change(screen.getByLabelText('Username or Email'), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(screen.getByText('An error occurred. Please try again.')).toBeInTheDocument();
    });
  });
});

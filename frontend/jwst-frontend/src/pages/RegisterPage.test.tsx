import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockRegister = vi.fn();
const mockNavigate = vi.fn();

vi.mock('../context/useAuth', () => ({
  useAuth: () => ({
    register: mockRegister,
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

import { RegisterPage } from './RegisterPage';

const renderRegisterPage = () =>
  render(
    <MemoryRouter>
      <RegisterPage />
    </MemoryRouter>
  );

const fillValidForm = () => {
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'testuser' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'test@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
  fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'password123' } });
};

describe('RegisterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all form fields', () => {
    renderRegisterPage();

    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Display Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Organization')).toBeInTheDocument();
  });

  it('shows "Create your account" text', () => {
    renderRegisterPage();

    expect(screen.getByText('Create your account')).toBeInTheDocument();
  });

  it('shows "Sign in" link to login', () => {
    renderRegisterPage();

    const link = screen.getByText('Sign in');
    expect(link).toBeInTheDocument();
    expect(link.closest('a')).toHaveAttribute('href', '/login');
  });

  it('validation: empty username', () => {
    renderRegisterPage();

    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(screen.getByText('Username is required')).toBeInTheDocument();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('validation: short username (<3 characters)', () => {
    renderRegisterPage();

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'ab' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(screen.getByText('Username must be at least 3 characters')).toBeInTheDocument();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('validation: empty email', () => {
    renderRegisterPage();

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'testuser' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(screen.getByText('Email is required')).toBeInTheDocument();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('validation: invalid email (no @)', () => {
    renderRegisterPage();

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'invalidemail' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(screen.getByText('Please enter a valid email address')).toBeInTheDocument();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('validation: empty password', () => {
    renderRegisterPage();

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'test@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('validation: short password (<8 characters)', () => {
    renderRegisterPage();

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(screen.getByText('Password must be at least 8 characters')).toBeInTheDocument();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('validation: mismatched passwords', () => {
    renderRegisterPage();

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'different' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('successful registration navigates', async () => {
    mockRegister.mockResolvedValue(undefined);
    renderRegisterPage();

    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith({
        username: 'testuser',
        email: 'test@example.com',
        password: 'password123',
        displayName: undefined,
        organization: undefined,
      });
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
    });
  });

  it('409 error shows "already exists"', async () => {
    mockRegister.mockRejectedValue({ status: 409, message: 'Conflict' });
    renderRegisterPage();

    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => {
      expect(screen.getByText('Username or email already exists')).toBeInTheDocument();
    });
  });

  it('other API error shows message', async () => {
    mockRegister.mockRejectedValue({ status: 500, message: 'Internal server error' });
    renderRegisterPage();

    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => {
      expect(screen.getByText('Internal server error')).toBeInTheDocument();
    });
  });

  it('non-API error shows generic message', async () => {
    mockRegister.mockRejectedValue(new Error('Network error'));
    renderRegisterPage();

    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => {
      expect(screen.getByText('An error occurred. Please try again.')).toBeInTheDocument();
    });
  });
});

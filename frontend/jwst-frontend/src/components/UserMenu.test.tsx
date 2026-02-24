import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockLogout = vi.fn();

let mockUser: {
  username: string;
  displayName: string;
  email: string;
  organization: string;
} | null = {
  username: 'testuser',
  displayName: 'Test User',
  email: 'test@example.com',
  organization: 'Test Org',
};

vi.mock('../context/useAuth', () => ({
  useAuth: () => ({
    user: mockUser,
    logout: mockLogout,
  }),
}));

import { UserMenu } from './UserMenu';

describe('UserMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = {
      username: 'testuser',
      displayName: 'Test User',
      email: 'test@example.com',
      organization: 'Test Org',
    };
  });

  it('renders user avatar with initials "TU" from "Test User"', () => {
    render(<UserMenu />);

    // The trigger avatar shows initials
    const avatars = screen.getAllByText('TU');
    expect(avatars.length).toBeGreaterThanOrEqual(1);
  });

  it('shows user display name', () => {
    render(<UserMenu />);

    expect(screen.getByText('Test User')).toBeInTheDocument();
  });

  it('clicking trigger opens dropdown', () => {
    render(<UserMenu />);

    // Dropdown should not be visible initially
    expect(screen.queryByText('test@example.com')).not.toBeInTheDocument();

    // Click the trigger button
    const trigger = screen.getByRole('button', { expanded: false });
    fireEvent.click(trigger);

    // Dropdown should now be visible with email
    expect(screen.getByText('test@example.com')).toBeInTheDocument();
  });

  it('dropdown shows email and organization', () => {
    render(<UserMenu />);

    // Open dropdown
    const trigger = screen.getByRole('button', { expanded: false });
    fireEvent.click(trigger);

    expect(screen.getByText('test@example.com')).toBeInTheDocument();
    expect(screen.getByText('Test Org')).toBeInTheDocument();
  });

  it('clicking Sign Out calls logout', () => {
    render(<UserMenu />);

    // Open dropdown
    const trigger = screen.getByRole('button', { expanded: false });
    fireEvent.click(trigger);

    // Click sign out
    fireEvent.click(screen.getByText('Sign Out'));
    expect(mockLogout).toHaveBeenCalledOnce();
  });

  it('escape key closes dropdown', () => {
    render(<UserMenu />);

    // Open dropdown
    const trigger = screen.getByRole('button', { expanded: false });
    fireEvent.click(trigger);

    // Verify it's open
    expect(screen.getByText('test@example.com')).toBeInTheDocument();

    // Press Escape
    fireEvent.keyDown(document, { key: 'Escape' });

    // Dropdown should be closed
    expect(screen.queryByText('test@example.com')).not.toBeInTheDocument();
  });

  it('returns null when user is null', () => {
    mockUser = null;

    const { container } = render(<UserMenu />);
    expect(container.innerHTML).toBe('');
  });
});

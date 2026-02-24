import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthToast } from './AuthToast';

describe('AuthToast', () => {
  it('renders without crashing', () => {
    const { container } = render(<AuthToast />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it('is not visible initially (no auth-toast--visible class)', () => {
    const { container } = render(<AuthToast />);
    const toast = container.firstChild as HTMLElement;
    expect(toast.className).toContain('auth-toast');
    expect(toast.className).not.toContain('auth-toast--visible');
  });

  it('has role="alert" attribute', () => {
    render(<AuthToast />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('has correct base CSS class', () => {
    const { container } = render(<AuthToast />);
    const toast = container.firstChild as HTMLElement;
    expect(toast.classList.contains('auth-toast')).toBe(true);
  });

  it('has aria-live="assertive" for accessibility', () => {
    render(<AuthToast />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
  });

  it('does not show dismiss button when not visible', () => {
    const { container } = render(<AuthToast />);
    expect(container.querySelector('.auth-toast__dismiss')).not.toBeInTheDocument();
  });

  it('has default warning variant class', () => {
    const { container } = render(<AuthToast />);
    const toast = container.firstChild as HTMLElement;
    expect(toast.className).toContain('auth-toast--warning');
  });
});

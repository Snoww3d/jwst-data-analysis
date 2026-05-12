import type { ReactElement } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

function Boom(): never {
  throw new Error('test boom');
}

function Safe(): ReactElement {
  return <div data-testid="safe-child">safe</div>;
}

describe('ErrorBoundary', () => {
  // React logs caught errors to console.error by design; silence for tests.
  let originalError: typeof console.error;
  beforeEach(() => {
    originalError = console.error;
    console.error = vi.fn();
  });
  afterEach(() => {
    console.error = originalError;
  });

  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <Safe />
      </ErrorBoundary>
    );
    expect(screen.getByTestId('safe-child')).toBeInTheDocument();
  });

  it('renders the default fallback when a child throws', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload page/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('resets when the "Try again" button is clicked', () => {
    let shouldThrow = true;
    function Toggle(): ReactElement {
      if (shouldThrow) throw new Error('one-time error');
      return <div data-testid="recovered">recovered</div>;
    }
    render(
      <ErrorBoundary>
        <Toggle />
      </ErrorBoundary>
    );
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(screen.getByTestId('recovered')).toBeInTheDocument();
  });

  it('honors a custom fallback when provided', () => {
    render(
      <ErrorBoundary
        fallback={(err, reset) => (
          <div>
            <span data-testid="custom-msg">caught: {err.message}</span>
            <button onClick={reset}>custom-reset</button>
          </div>
        )}
      >
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByTestId('custom-msg')).toHaveTextContent('caught: test boom');
  });
});

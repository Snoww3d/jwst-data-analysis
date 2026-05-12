import { Component, type ErrorInfo, type ReactNode } from 'react';
import './ErrorBoundary.css';

/**
 * Top-level error boundary for the JWST frontend.
 *
 * Without this, any uncaught exception thrown during render unmounts the
 * entire tree and the user sees a blank white screen with no recovery
 * affordance. The boundary catches the throw, logs it, and renders a
 * minimal fallback UI with a reload button. (#1366)
 *
 * React error boundaries must be class components — there's no hook
 * equivalent for `componentDidCatch` / `getDerivedStateFromError`.
 */

interface Props {
  children: ReactNode;
  /** Optional custom fallback. Receives the captured error and a reset callback. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Surface to whatever console / monitoring is wired up — `console.error`
    // is the lowest-common-denominator and shows up in dev tools, browser
    // diagnostics, and any wrapping logger.
    // eslint-disable-next-line no-console -- error boundary fallback diagnostic
    console.error('[ErrorBoundary] Uncaught render error:', error, errorInfo);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) {
      return this.props.children;
    }
    if (this.props.fallback) {
      return this.props.fallback(error, this.reset);
    }
    return (
      <div role="alert" className="error-boundary">
        <div className="error-boundary__panel">
          <h1 className="error-boundary__title">Something went wrong</h1>
          <p className="error-boundary__message">
            The application encountered an unexpected error and couldn't render this view.
          </p>
          {import.meta.env.DEV && <pre className="error-boundary__detail">{error.message}</pre>}
          <div className="error-boundary__actions">
            <button
              type="button"
              className="error-boundary__button"
              onClick={() => window.location.reload()}
            >
              Reload page
            </button>
            <button
              type="button"
              className="error-boundary__button error-boundary__button--secondary"
              onClick={this.reset}
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;

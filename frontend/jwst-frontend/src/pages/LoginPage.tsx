/**
 * Login page component
 *
 * Provides username/password login form with:
 * - Form validation
 * - Error display
 * - Link to registration
 * - Redirect to intended destination after login
 */

import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../services';
import './AuthPages.css';

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Get redirect destination from state or default to home
  const from = (location.state as { from?: string })?.from || '/';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    // Basic validation
    if (!username.trim()) {
      setError('Username is required');
      return;
    }
    if (!password) {
      setError('Password is required');
      return;
    }

    setIsSubmitting(true);
    try {
      await login({ username: username.trim(), password });
      navigate(from, { replace: true });
    } catch (err) {
      if (ApiError.isApiError(err)) {
        if (err.status === 401) {
          setError('Invalid username or password');
        } else {
          setError(err.message);
        }
      } else {
        setError('An error occurred. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-header">
          <h1>JWST Data Analysis</h1>
          <p>Sign in to your account</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {error && <div className="auth-error">{error}</div>}

          <div className="form-group">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your username"
              autoComplete="username"
              autoFocus
              disabled={isSubmitting}
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
              disabled={isSubmitting}
            />
          </div>

          <button
            type="submit"
            className="auth-submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            {"Don't have an account? "}
            <Link to="/register" state={{ from }}>
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

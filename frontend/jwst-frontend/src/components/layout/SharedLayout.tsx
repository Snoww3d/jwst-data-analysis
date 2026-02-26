import { NavLink, Outlet } from 'react-router-dom';
import { UserMenu } from '../UserMenu';
import './SharedLayout.css';

/**
 * Shared layout shell with persistent header + navigation across all authenticated pages.
 * Wraps page content via React Router's <Outlet />.
 */
export function SharedLayout() {
  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-to-content">
        Skip to main content
      </a>
      <header className="app-header">
        <div className="header-content">
          <div className="header-left">
            <NavLink to="/" className="header-brand" end>
              <span className="brand-text">
                JWST <span className="brand-accent">Discovery</span>
              </span>
            </NavLink>
            <nav className="header-nav" aria-label="Main navigation">
              <NavLink to="/" className="nav-link" end>
                Discover
              </NavLink>
              <NavLink to="/library" className="nav-link">
                My Library
              </NavLink>
            </nav>
          </div>
          <UserMenu />
        </div>
      </header>
      <main id="main-content" className="app-main">
        <Outlet />
      </main>
    </div>
  );
}

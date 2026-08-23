import type React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import App from './App';

/**
 * Full-build routing contract for the MAST Search v2 IA (Phase 1):
 * /search serves the MAST search page and /archive redirects there,
 * preserving the query string. Pages are stubbed — this tests the route
 * table, not the pages.
 */
function LocationProbe() {
  const { pathname, search } = useLocation();
  return <div data-testid="location">{pathname + search}</div>;
}

vi.mock('./pages/SearchPage', () => ({
  SearchPage: () => <div data-testid="page-search" />,
}));
vi.mock('./pages/DiscoveryHome', () => ({
  DiscoveryHome: () => <div data-testid="page-discover" />,
}));
vi.mock('./components/layout/SharedLayout', async () => {
  const { Outlet } = await import('react-router-dom');
  return {
    SharedLayout: () => (
      <>
        <LocationProbe />
        <Outlet />
      </>
    ),
  };
});
vi.mock('./context/ActiveImportsContext', () => ({
  ActiveImportsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('./components/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

async function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  );
  // lazy routes resolve async even when mocked
  return screen.findByTestId(/page-/);
}

describe('App routing (full build)', () => {
  it('routes /search to the MAST search page', async () => {
    expect((await renderAt('/search')).dataset.testid).toBe('page-search');
    expect(screen.getByTestId('location')).toHaveTextContent('/search');
  });

  it('redirects /archive to /search, preserving the query string', async () => {
    expect((await renderAt('/archive?q=ngc%203324&r=0.2')).dataset.testid).toBe('page-search');
    expect(screen.getByTestId('location')).toHaveTextContent('/search?q=ngc%203324&r=0.2');
  });

  it('redirects a bare /archive to /search', async () => {
    await renderAt('/archive');
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/search$/);
  });
});

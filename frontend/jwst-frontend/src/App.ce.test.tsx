import type React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

/**
 * CE routing contract: auth pages, wizard pages, and semantic search are not
 * routed at all (unknown paths fall through to Discover); /library is public.
 * Pages are stubbed — this tests the route table, not the pages.
 */
vi.mock('./config/ce', () => ({ CE_MODE: true }));

vi.mock('./pages/LoginPage', () => ({ LoginPage: () => <div data-testid="page-login" /> }));
vi.mock('./pages/RegisterPage', () => ({
  RegisterPage: () => <div data-testid="page-register" />,
}));
vi.mock('./pages/DiscoveryHome', () => ({
  DiscoveryHome: () => <div data-testid="page-discover" />,
}));
vi.mock('./pages/MyLibrary', () => ({ MyLibrary: () => <div data-testid="page-library" /> }));
vi.mock('./pages/TargetDetail', () => ({ TargetDetail: () => <div data-testid="page-target" /> }));
vi.mock('./pages/GuidedCreate', () => ({ GuidedCreate: () => <div data-testid="page-create" /> }));
vi.mock('./pages/CompositePage', () => ({
  CompositePage: () => <div data-testid="page-composite" />,
}));
vi.mock('./pages/MosaicPage', () => ({ MosaicPage: () => <div data-testid="page-mosaic" /> }));
vi.mock('./pages/SearchPage', () => ({ SearchPage: () => <div data-testid="page-search" /> }));
vi.mock('./pages/ArchivePage', () => ({ ArchivePage: () => <div data-testid="page-archive" /> }));
vi.mock('./components/layout/SharedLayout', async () => {
  const { Outlet } = await import('react-router-dom');
  return { SharedLayout: () => <Outlet /> };
});
vi.mock('./context/ActiveImportsContext', () => ({
  ActiveImportsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('./components/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="protected">{children}</div>
  ),
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

describe('App routing in CE mode', () => {
  it('serves the golden path + archive + library publicly', async () => {
    expect((await renderAt('/')).dataset.testid).toBe('page-discover');
  });

  it('routes /library without ProtectedRoute', async () => {
    const page = await renderAt('/library');
    expect(page.dataset.testid).toBe('page-library');
    expect(screen.queryByTestId('protected')).not.toBeInTheDocument();
  });

  it.each([
    ['/login', 'page-discover'],
    ['/register', 'page-discover'],
    ['/search', 'page-discover'],
    ['/composite', 'page-discover'],
    ['/mosaic', 'page-discover'],
  ])('%s falls through to Discover (route not registered)', async (path, expected) => {
    expect((await renderAt(path)).dataset.testid).toBe(expected);
  });
});

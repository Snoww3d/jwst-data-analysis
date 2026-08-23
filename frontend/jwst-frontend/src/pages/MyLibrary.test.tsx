import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { MyLibrary } from './MyLibrary';

// Full build: the library gets a Library / Search library tab strip (#1618),
// with the active tab kept in `?tab=`.
vi.mock('../components/JwstDataDashboard', () => ({
  default: () => <div data-testid="dashboard" />,
}));
vi.mock('../components/library/SemanticSearchPanel', () => ({
  SemanticSearchPanel: () => <div data-testid="semantic-panel" />,
}));
vi.mock('../services', () => ({
  jwstDataService: { getAll: vi.fn().mockResolvedValue([]) },
  ApiError: { isApiError: () => false },
}));

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <div data-testid="location">{pathname + search}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <MyLibrary />
    </MemoryRouter>
  );
}

describe('MyLibrary tabs (full build)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows both tabs with Library active by default and renders the dashboard', async () => {
    renderAt('/library');
    expect(await screen.findByTestId('dashboard')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Library' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Search library' })).toHaveAttribute(
      'aria-selected',
      'false'
    );
    expect(screen.queryByTestId('semantic-panel')).not.toBeInTheDocument();
  });

  it('deep-links to the semantic search tab via ?tab=search', () => {
    renderAt('/library?tab=search');
    expect(screen.getByTestId('semantic-panel')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Search library' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.queryByTestId('dashboard')).not.toBeInTheDocument();
  });

  it('clicking a tab updates the URL and switches the panel', async () => {
    renderAt('/library');
    await screen.findByTestId('dashboard');

    fireEvent.click(screen.getByRole('tab', { name: 'Search library' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/library?tab=search');
    expect(screen.getByTestId('semantic-panel')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Library' }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/library$/);
    expect(await screen.findByTestId('dashboard')).toBeInTheDocument();
  });
});

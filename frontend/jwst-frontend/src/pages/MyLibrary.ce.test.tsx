import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MyLibrary } from './MyLibrary';

// CE build: no semantic search (its API never mounts) — no tab strip at all,
// and `?tab=search` is ignored.
vi.mock('../config/ce', () => ({ CE_MODE: true }));
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

describe('MyLibrary in CE mode', () => {
  it('renders no tab strip and ignores ?tab=search', async () => {
    render(
      <MemoryRouter initialEntries={['/library?tab=search']}>
        <MyLibrary />
      </MemoryRouter>
    );
    expect(await screen.findByTestId('dashboard')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByTestId('semantic-panel')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Library' })).toBeInTheDocument();
  });
});

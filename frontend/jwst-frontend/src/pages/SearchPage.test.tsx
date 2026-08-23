import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SearchPage } from './SearchPage';

vi.mock('../components/mast/MastSearch', () => ({
  default: () => <div data-testid="mast-search" />,
}));

vi.mock('../components/WhatsNewPanel', () => ({
  default: () => <div data-testid="whats-new-panel" />,
}));

describe('SearchPage', () => {
  it('renders the page header and MAST search', () => {
    render(
      <MemoryRouter>
        <SearchPage />
      </MemoryRouter>
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Search' })).toBeInTheDocument();
    expect(screen.getByTestId('mast-search')).toBeInTheDocument();
  });

  it("no longer renders What's New at page level — it is MastSearch's empty state (Phase 5)", () => {
    render(
      <MemoryRouter>
        <SearchPage />
      </MemoryRouter>
    );
    expect(screen.queryByTestId('whats-new-panel')).toBeNull();
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SharedLayout } from './SharedLayout';

// CE build: no accounts, no imports, no semantic search
vi.mock('../../config/ce', () => ({ CE_MODE: true }));
vi.mock('../UserMenu', () => ({ UserMenu: () => <div data-testid="user-menu" /> }));
vi.mock('./MastStatusPill', () => ({ MastStatusPill: () => <div data-testid="mast-pill" /> }));
vi.mock('./ImportProgressPill', () => ({
  ImportProgressPill: () => <div data-testid="import-pill" />,
}));

describe('SharedLayout in CE mode', () => {
  function renderLayout() {
    return render(
      <MemoryRouter>
        <SharedLayout />
      </MemoryRouter>
    );
  }

  it('hides the UserMenu and ImportProgressPill', () => {
    renderLayout();
    expect(screen.queryByTestId('user-menu')).not.toBeInTheDocument();
    expect(screen.queryByTestId('import-pill')).not.toBeInTheDocument();
  });

  it('keeps the MAST status pill', () => {
    renderLayout();
    expect(screen.getByTestId('mast-pill')).toBeInTheDocument();
  });

  it('hides the semantic Search nav link and de-personalizes Library', () => {
    renderLayout();
    expect(screen.queryByRole('link', { name: 'Search' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Library' })).toHaveAttribute('href', '/library');
    expect(screen.queryByRole('link', { name: 'My Library' })).not.toBeInTheDocument();
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SharedLayout } from './SharedLayout';

// Regression guard: with CE off (the default build), the full chrome renders.
vi.mock('../UserMenu', () => ({ UserMenu: () => <div data-testid="user-menu" /> }));
vi.mock('./MastStatusPill', () => ({ MastStatusPill: () => <div data-testid="mast-pill" /> }));
vi.mock('./ImportProgressPill', () => ({
  ImportProgressPill: () => <div data-testid="import-pill" />,
}));

describe('SharedLayout (full build)', () => {
  it('renders UserMenu, ImportProgressPill, Search link, and My Library', () => {
    render(
      <MemoryRouter>
        <SharedLayout />
      </MemoryRouter>
    );
    expect(screen.getByTestId('user-menu')).toBeInTheDocument();
    expect(screen.getByTestId('import-pill')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Search' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My Library' })).toBeInTheDocument();
  });
});

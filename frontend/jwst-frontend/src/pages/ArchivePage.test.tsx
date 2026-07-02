import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ArchivePage } from './ArchivePage';

vi.mock('../components/mast/MastSearch', () => ({
  default: () => <div data-testid="mast-search" />,
}));

vi.mock('../components/WhatsNewPanel', () => ({
  default: () => <div data-testid="whats-new-panel" />,
}));

describe('ArchivePage', () => {
  it("renders the page header, MAST search, and What's New panel", () => {
    render(
      <MemoryRouter>
        <ArchivePage />
      </MemoryRouter>
    );
    expect(screen.getByText('Archive search')).toBeInTheDocument();
    expect(screen.getByTestId('mast-search')).toBeInTheDocument();
    expect(screen.getByTestId('whats-new-panel')).toBeInTheDocument();
  });
});

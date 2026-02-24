import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import WhatsNewPanel from './WhatsNewPanel';

vi.mock('../services', () => ({
  mastService: {
    getRecentReleases: vi.fn(() => Promise.resolve({ results: [] })),
    startImport: vi.fn(),
    getImportProgress: vi.fn(),
    cancelImport: vi.fn(),
  },
  ApiError: {
    isApiError: vi.fn(() => false),
  },
}));

describe('WhatsNewPanel', () => {
  it('renders the panel header', () => {
    render(<WhatsNewPanel onImportComplete={vi.fn()} />);
    expect(screen.getByText("What's New on MAST")).toBeInTheDocument();
  });

  it('renders filter controls', () => {
    render(<WhatsNewPanel onImportComplete={vi.fn()} />);
    expect(screen.getByText('Last 7 days')).toBeInTheDocument();
    expect(screen.getByText('Last 30 days')).toBeInTheDocument();
    expect(screen.getByText('Last 90 days')).toBeInTheDocument();
  });

  it('renders instrument filter', () => {
    render(<WhatsNewPanel onImportComplete={vi.fn()} />);
    expect(screen.getByText('All Instruments')).toBeInTheDocument();
  });

  it('renders refresh button (may show Loading... initially)', () => {
    render(<WhatsNewPanel onImportComplete={vi.fn()} />);
    // The button shows "Loading..." during initial fetch, or "Refresh" once loaded
    const button = screen.getByRole('button', { name: /Refresh|Loading/i });
    expect(button).toBeInTheDocument();
  });
});

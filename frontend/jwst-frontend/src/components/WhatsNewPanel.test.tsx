import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import WhatsNewPanel from './WhatsNewPanel';

interface SampleResult {
  obs_id: string;
  target_name: string;
  instrument_name: string;
  t_exptime: number;
  t_obs_release: number;
}

const hoisted = vi.hoisted(() => ({
  useAuthMock: vi.fn(() => ({ isAuthenticated: false, isLoading: false })),
  getRecentReleasesMock: vi.fn(() => Promise.resolve({ results: [] as SampleResult[] })),
}));

vi.mock('../services', () => ({
  mastService: {
    getRecentReleases: hoisted.getRecentReleasesMock,
    startImport: vi.fn(),
    getImportProgress: vi.fn(),
    cancelImport: vi.fn(),
  },
  ApiError: {
    isApiError: vi.fn(() => false),
  },
}));

vi.mock('../context/useActiveImportsContext', () => ({
  useActiveImportsContext: vi.fn(() => ({
    jobs: [],
    aggregatePercent: 0,
    activeCount: 0,
    registerJob: vi.fn(),
  })),
}));

vi.mock('../context/useAuth', () => ({
  useAuth: hoisted.useAuthMock,
}));

function renderPanel() {
  return render(
    <MemoryRouter>
      <WhatsNewPanel />
    </MemoryRouter>
  );
}

describe('WhatsNewPanel', () => {
  beforeEach(() => {
    hoisted.useAuthMock.mockReturnValue({ isAuthenticated: false, isLoading: false });
    hoisted.getRecentReleasesMock.mockClear();
    hoisted.getRecentReleasesMock.mockResolvedValue({ results: [] });
  });

  it('renders the panel header', () => {
    renderPanel();
    expect(screen.getByText("What's New on MAST")).toBeInTheDocument();
  });

  it('renders filter controls', () => {
    renderPanel();
    expect(screen.getByText('Last 7 days')).toBeInTheDocument();
    expect(screen.getByText('Last 30 days')).toBeInTheDocument();
    expect(screen.getByText('Last 90 days')).toBeInTheDocument();
  });

  it('renders instrument filter', () => {
    renderPanel();
    expect(screen.getByText('All Instruments')).toBeInTheDocument();
  });

  it('renders refresh button (may show Loading... initially)', () => {
    renderPanel();
    // The button shows "Loading..." during initial fetch, or "Refresh" once loaded
    const button = screen.getByRole('button', { name: /Refresh|Loading/i });
    expect(button).toBeInTheDocument();
  });

  describe('import login gating', () => {
    const sampleResult = {
      obs_id: 'obs-1',
      target_name: 'Test Target',
      instrument_name: 'NIRCAM',
      t_exptime: 100,
      t_obs_release: 60000,
    };

    it('shows "Log in to import" (not an Import button) for anonymous users', async () => {
      hoisted.getRecentReleasesMock.mockResolvedValue({ results: [sampleResult] });
      renderPanel();

      const loginLink = await screen.findByRole('link', { name: /Log in to import/i });
      expect(loginLink).toHaveAttribute('href', '/login');
      expect(screen.queryByRole('button', { name: /^Import$/i })).not.toBeInTheDocument();
    });

    it('shows the Import button for authenticated users', async () => {
      hoisted.useAuthMock.mockReturnValue({ isAuthenticated: true, isLoading: false });
      hoisted.getRecentReleasesMock.mockResolvedValue({ results: [sampleResult] });
      renderPanel();

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /^Import$/i })).toBeInTheDocument()
      );
      expect(screen.queryByRole('link', { name: /Log in to import/i })).not.toBeInTheDocument();
    });
  });
});

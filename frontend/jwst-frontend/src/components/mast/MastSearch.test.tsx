import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MastSearch from './MastSearch';
import { mastService } from '../../services';

interface ResumableJob {
  jobId: string;
  obsId: string;
  totalBytes: number;
  downloadedBytes: number;
  progressPercent: number;
  status: string;
  totalFiles: number;
  completedFiles: number;
}

const hoisted = vi.hoisted(() => ({
  useAuthMock: vi.fn(() => ({ isAuthenticated: false, isLoading: false })),
  getResumableImportsMock: vi.fn(() => Promise.resolve({ jobs: [] as ResumableJob[] })),
}));

vi.mock('../../services', () => ({
  mastService: {
    searchByTarget: vi.fn(() => Promise.resolve({ results: [] })),
    searchByCoordinates: vi.fn(() => Promise.resolve({ results: [] })),
    searchByObservation: vi.fn(() => Promise.resolve({ results: [] })),
    searchByProgram: vi.fn(() => Promise.resolve({ results: [] })),
    startImport: vi.fn(),
    getImportProgress: vi.fn(),
    cancelImport: vi.fn(),
    resumeImport: vi.fn(),
    importFromExisting: vi.fn(),
    getResumableImports: hoisted.getResumableImportsMock,
    dismissResumableImport: vi.fn(),
  },
  jwstDataService: {
    checkDataAvailability: vi.fn(() => Promise.resolve({ results: {} })),
  },
  ApiError: {
    isApiError: vi.fn(() => false),
  },
}));

vi.mock('../../context/useAuth', () => ({
  useAuth: hoisted.useAuthMock,
}));

vi.mock('../../context/useActiveImportsContext', () => ({
  useActiveImportsContext: vi.fn(() => ({
    jobs: [],
    aggregatePercent: 0,
    activeCount: 0,
    registerJob: vi.fn(),
  })),
}));

describe('MastSearch', () => {
  beforeEach(() => {
    hoisted.useAuthMock.mockReturnValue({ isAuthenticated: false, isLoading: false });
    hoisted.getResumableImportsMock.mockClear();
    hoisted.getResumableImportsMock.mockResolvedValue({ jobs: [] });
  });

  const renderMastSearch = () =>
    render(
      <MemoryRouter>
        <MastSearch />
      </MemoryRouter>
    );

  it('renders the heading', () => {
    renderMastSearch();
    expect(screen.getByText('MAST Portal Search')).toBeInTheDocument();
  });

  it('renders search type options', () => {
    renderMastSearch();
    expect(screen.getByText('Target Name')).toBeInTheDocument();
    expect(screen.getByText('Coordinates')).toBeInTheDocument();
  });

  it('anonymous: does not fetch resumable imports (GET /api/mast/import/resumable requires auth)', async () => {
    renderMastSearch();
    // Give any stray effects a tick to fire, then assert the call never happened.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(hoisted.getResumableImportsMock).not.toHaveBeenCalled();
  });

  it('authenticated: fetches resumable imports on mount', async () => {
    hoisted.useAuthMock.mockReturnValue({ isAuthenticated: true, isLoading: false });
    renderMastSearch();
    await waitFor(() => expect(hoisted.getResumableImportsMock).toHaveBeenCalled());
  });

  it('does not render the Incomplete Downloads panel for anonymous users even if jobs exist', async () => {
    hoisted.getResumableImportsMock.mockResolvedValue({
      jobs: [
        {
          jobId: 'job-1',
          obsId: 'obs-1',
          totalBytes: 100,
          downloadedBytes: 50,
          progressPercent: 50,
          status: 'downloading',
          totalFiles: 2,
          completedFiles: 1,
        },
      ],
    });
    renderMastSearch();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText(/Incomplete Downloads/)).not.toBeInTheDocument();
  });

  describe('raw-data fallback (#1760)', () => {
    beforeEach(() => {
      vi.mocked(mastService.searchByTarget).mockResolvedValue({ results: [] } as never);
      vi.mocked(mastService.searchByObservation).mockResolvedValue({ results: [] } as never);
    });

    const searchTarget = async (name = 'M16') => {
      renderMastSearch();
      fireEvent.change(screen.getByPlaceholderText(/Target name/i), {
        target: { value: name },
      });
      fireEvent.click(screen.getByText('Search MAST'));
    };

    it('says nothing before a search has run', () => {
      renderMastSearch();
      expect(screen.queryByText(/No finished images/)).not.toBeInTheDocument();
    });

    it('offers raw data when a Level 3 search comes back empty', async () => {
      await searchTarget();
      expect(await screen.findByText('No finished images for this target')).toBeInTheDocument();
    });

    it('re-runs the search including every level when the offer is taken', async () => {
      await searchTarget();
      fireEvent.click(await screen.findByRole('button', { name: /Search including raw data/ }));
      await waitFor(() =>
        expect(vi.mocked(mastService.searchByTarget).mock.lastCall?.[0]).toMatchObject({
          calibLevel: [1, 2, 3],
        })
      );
      // ...and the offer goes away, because the results ARE the raw data now.
      await waitFor(() =>
        expect(screen.queryByText('No finished images for this target')).not.toBeInTheDocument()
      );
    });

    it('stays quiet on an observation-ID search, which always returns every level', async () => {
      renderMastSearch();
      fireEvent.click(screen.getByLabelText(/Observation ID/i));
      fireEvent.change(screen.getByPlaceholderText(/Observation ID/i), {
        target: { value: 'jw02733-o001' },
      });
      fireEvent.click(screen.getByText('Search MAST'));
      await waitFor(() => expect(mastService.searchByObservation).toHaveBeenCalled());
      // Offering raw data here would re-run the identical query.
      expect(screen.queryByText(/No finished images/)).not.toBeInTheDocument();
    });

    it('says nothing when the search fails — an error is not evidence', async () => {
      vi.mocked(mastService.searchByTarget).mockRejectedValue(new Error('boom'));
      await searchTarget();
      await waitFor(() => expect(mastService.searchByTarget).toHaveBeenCalled());
      expect(screen.queryByText(/No finished images/)).not.toBeInTheDocument();
    });

    it('says nothing when the search was abandoned on a blank input', async () => {
      renderMastSearch();
      fireEvent.click(screen.getByText('Search MAST'));
      await waitFor(() =>
        expect(screen.getByText(/Please enter a target name/)).toBeInTheDocument()
      );
      expect(screen.queryByText(/No finished images/)).not.toBeInTheDocument();
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import MastSearch from './MastSearch';
import { mastService } from '../../services';
import { clearSearchHistoryCache } from './hooks/useMastSearch';
import { clearAvailabilityCache } from './hooks/useLibraryAvailability';

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
    clearSearchHistoryCache();
    clearAvailabilityCache();
    vi.mocked(mastService.searchByTarget).mockReset();
    vi.mocked(mastService.searchByTarget).mockResolvedValue({ results: [] } as never);
    vi.mocked(mastService.searchByCoordinates).mockReset();
    vi.mocked(mastService.searchByCoordinates).mockResolvedValue({ results: [] } as never);
    vi.mocked(mastService.searchByObservation).mockReset();
    vi.mocked(mastService.searchByObservation).mockResolvedValue({ results: [] } as never);
    vi.mocked(mastService.searchByProgram).mockReset();
    vi.mocked(mastService.searchByProgram).mockResolvedValue({ results: [] } as never);
  });

  const renderMastSearch = (initialEntries: string[] = ['/search']) =>
    render(
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/search" element={<MastSearch />} />
        </Routes>
      </MemoryRouter>
    );

  const queryBox = () => screen.getByRole('textbox', { name: 'Search MAST' });
  const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Search MAST' }));

  it('renders the heading', () => {
    renderMastSearch();
    expect(screen.getByText('MAST Portal Search')).toBeInTheDocument();
  });

  it('renders one smart input instead of mode radios', () => {
    renderMastSearch();
    expect(queryBox()).toBeInTheDocument();
    expect(screen.queryByText('Target Name')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  describe('URL-driven search (MAST Search v2, Phase 2)', () => {
    beforeEach(() => {
      vi.mocked(mastService.searchByTarget).mockClear();
      vi.mocked(mastService.searchByCoordinates).mockClear();
      vi.mocked(mastService.searchByProgram).mockClear();
      localStorage.clear();
    });

    it('runs the search once on mount when ?q= is present', async () => {
      renderMastSearch(['/search?q=NGC+3324&r=0.5']);
      await waitFor(() => expect(mastService.searchByTarget).toHaveBeenCalledTimes(1));
      expect(vi.mocked(mastService.searchByTarget).mock.lastCall?.[0]).toMatchObject({
        targetName: 'NGC 3324',
        radius: 0.5,
        calibLevel: [3],
      });
      expect(queryBox()).toHaveValue('NGC 3324');
    });

    it('routes each parsed kind to its endpoint', async () => {
      renderMastSearch();
      fireEvent.change(queryBox(), { target: { value: '10h 37m -58°' } });
      submit();
      await waitFor(() => expect(mastService.searchByCoordinates).toHaveBeenCalled());
      expect(vi.mocked(mastService.searchByCoordinates).mock.lastCall?.[0]).toMatchObject({
        ra: 159.25,
        dec: -58,
        radius: 0.2,
      });

      fireEvent.change(queryBox(), { target: { value: 'PID 2739' } });
      submit();
      await waitFor(() =>
        expect(vi.mocked(mastService.searchByProgram).mock.lastCall?.[0]).toMatchObject({
          programId: '2739',
        })
      );
    });

    it('Back restores the earlier search and its results from the history cache', async () => {
      function Back() {
        const navigate = useNavigate();
        return <button onClick={() => navigate(-1)}>back</button>;
      }
      vi.mocked(mastService.searchByTarget).mockImplementation(async ({ targetName }) =>
        targetName === 'M16'
          ? ({ results: [{ obs_id: 'jw-m16' }] } as never)
          : ({ results: [{ obs_id: 'jw-ngc' }, { obs_id: 'jw-ngc-2' }] } as never)
      );
      render(
        <MemoryRouter initialEntries={['/search']}>
          <Back />
          <Routes>
            <Route path="/search" element={<MastSearch />} />
          </Routes>
        </MemoryRouter>
      );
      fireEvent.change(queryBox(), { target: { value: 'M16' } });
      submit();
      await waitFor(() => expect(mastService.searchByTarget).toHaveBeenCalledTimes(1));
      expect(await screen.findByText('Search Results (1)')).toBeInTheDocument();
      fireEvent.change(queryBox(), { target: { value: 'NGC 3324' } });
      submit();
      await waitFor(() => expect(mastService.searchByTarget).toHaveBeenCalledTimes(2));
      expect(await screen.findByText('Search Results (2)')).toBeInTheDocument();

      fireEvent.click(screen.getByText('back'));
      expect(await screen.findByText('Search Results (1)')).toBeInTheDocument();
      expect(queryBox()).toHaveValue('M16');
      // Phase 3: the result set came back from the per-search history cache —
      // MAST was not asked again.
      expect(mastService.searchByTarget).toHaveBeenCalledTimes(2);
    });

    it('changing the sort rewrites the URL without re-querying', async () => {
      vi.mocked(mastService.searchByTarget).mockResolvedValue({
        results: [
          { obs_id: 'b', t_exptime: 1 },
          { obs_id: 'a', t_exptime: 2 },
        ],
      } as never);
      let search = '';
      function Spy() {
        search = useLocation().search;
        return null;
      }
      render(
        <MemoryRouter initialEntries={['/search?q=M16']}>
          <Spy />
          <Routes>
            <Route path="/search" element={<MastSearch />} />
          </Routes>
        </MemoryRouter>
      );
      expect(await screen.findByText('Search Results (2)')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /^Exp Time$/ }));
      await waitFor(() => expect(search).toBe('?q=M16&sort=t_exptime%3Aasc'));
      expect(screen.getByRole('columnheader', { name: /Exp Time/ })).toHaveAttribute(
        'aria-sort',
        'ascending'
      );
      expect(mastService.searchByTarget).toHaveBeenCalledTimes(1);
    });

    it('refuses an unusable radius before touching the URL', async () => {
      renderMastSearch();
      fireEvent.change(queryBox(), { target: { value: 'M16' } });
      fireEvent.change(screen.getByRole('spinbutton', { name: /Search radius/ }), {
        target: { value: '50' },
      });
      submit();
      expect(await screen.findByText(/Radius must be between/)).toBeInTheDocument();
      expect(mastService.searchByTarget).not.toHaveBeenCalled();
    });

    it('records recent searches and offers them as chips', async () => {
      renderMastSearch();
      fireEvent.change(queryBox(), { target: { value: 'M16' } });
      submit();
      await waitFor(() => expect(mastService.searchByTarget).toHaveBeenCalled());
      expect(screen.getByRole('button', { name: 'M16' })).toBeInTheDocument();
      expect(localStorage.getItem('mast_recent_searches')).toContain('"M16"');
    });
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
      fireEvent.change(queryBox(), { target: { value: name } });
      submit();
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

    it('does not carry the raw-data level into a different search mode', async () => {
      // #1766: the offer flips the calibration-level toggle on the user's
      // behalf. Switching search type resets every other piece of search
      // state, so leaving this one set silently returns L1/L2 results where
      // the UI implies L3-only.
      await searchTarget();
      fireEvent.click(await screen.findByRole('button', { name: /Search including raw data/ }));
      await waitFor(() =>
        expect(vi.mocked(mastService.searchByTarget).mock.lastCall?.[0]).toMatchObject({
          calibLevel: [1, 2, 3],
        })
      );

      fireEvent.change(queryBox(), { target: { value: '2733' } });
      submit();
      await waitFor(() =>
        expect(vi.mocked(mastService.searchByProgram).mock.lastCall?.[0]).toMatchObject({
          calibLevel: [3],
        })
      );
    });

    it('stays quiet on an observation-ID search, which always returns every level', async () => {
      renderMastSearch();
      fireEvent.change(queryBox(), { target: { value: 'jw02733-o001' } });
      submit();
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
      submit();
      await waitFor(() =>
        expect(screen.getByText(/Enter a target name, coordinates/)).toBeInTheDocument()
      );
      expect(screen.queryByText(/No finished images/)).not.toBeInTheDocument();
    });
  });
});

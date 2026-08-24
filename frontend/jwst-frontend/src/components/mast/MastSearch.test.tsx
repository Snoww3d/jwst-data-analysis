import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StrictMode } from 'react';
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
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
  getCoverageMock: vi.fn(() =>
    Promise.resolve({
      shape: 'grid',
      nside: 64,
      cells: [[3, 2]] as [number, number][],
      total: 2,
      generated_at: '2026-08-23T00:00:00+00:00',
      stale: false,
    })
  ),
  getRecentReleasesMock: vi.fn(() => Promise.resolve({ results: [] as Record<string, unknown>[] })),
  // The lazy SkyMap is stubbed: record the latest props so tests can drive
  // onHover/onClick and inspect what the page passes down.
  skyMapProps: { current: null as Record<string, unknown> | null },
  toastWarningMock: vi.fn(),
}));

vi.mock('./map/SkyMap', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  const SkyMapStub = forwardRef((props: Record<string, unknown>, ref) => {
    hoisted.skyMapProps.current = props;
    useImperativeHandle(ref, () => ({
      setFootprints: vi.fn(),
      highlight: vi.fn(),
      select: vi.fn(),
      fitToResults: vi.fn(),
      goto: vi.fn(),
      setCoverage: vi.fn(),
      getView: () => ({ ra: 0, dec: 0, fov: 180 }),
    }));
    return <div data-testid="sky-map-stub" />;
  });
  return { default: SkyMapStub };
});

vi.mock('../../services', () => ({
  mastService: {
    searchByTarget: vi.fn(() => Promise.resolve({ results: [] })),
    searchByCoordinates: vi.fn(() => Promise.resolve({ results: [] })),
    searchByObservation: vi.fn(() => Promise.resolve({ results: [] })),
    searchByProgram: vi.fn(() => Promise.resolve({ results: [] })),
    searchByFacets: vi.fn(() => Promise.resolve({ results: [] })),
    startImport: vi.fn(),
    getImportProgress: vi.fn(),
    cancelImport: vi.fn(),
    resumeImport: vi.fn(),
    importFromExisting: vi.fn(),
    getResumableImports: hoisted.getResumableImportsMock,
    dismissResumableImport: vi.fn(),
    getCoverage: hoisted.getCoverageMock,
    getRecentReleases: hoisted.getRecentReleasesMock,
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

vi.mock('../ui/toast', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    warning: hoisted.toastWarningMock,
    error: vi.fn(),
  }),
  ToastProvider: () => null,
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
    vi.mocked(mastService.searchByFacets).mockReset();
    vi.mocked(mastService.searchByFacets).mockResolvedValue({ results: [] } as never);
    hoisted.getCoverageMock.mockClear();
    hoisted.getRecentReleasesMock.mockClear();
    hoisted.getRecentReleasesMock.mockResolvedValue({ results: [] });
    hoisted.skyMapProps.current = null;
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

  describe('filter rail + query-less faceting (MAST Search v2, Phase 4)', () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ obs_id: `jw${i}` }));
    let search = '';
    function Spy() {
      search = useLocation().search;
      return null;
    }
    const renderWithSpy = (entry: string) =>
      render(
        <MemoryRouter initialEntries={[entry]}>
          <Spy />
          <Routes>
            <Route path="/search" element={<MastSearch />} />
          </Routes>
        </MemoryRouter>
      );

    it('renders the rail with Apply enabled for an empty input once the draft changes', () => {
      renderMastSearch();
      const apply = screen.getByRole('button', { name: 'Apply filters' });
      expect(apply).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: 'MIRI' }));
      expect(apply).toBeEnabled();
      expect(queryBox()).toHaveValue('');
    });

    it('a URL with facets and no query auto-runs a facet-only search', async () => {
      vi.mocked(mastService.searchByFacets).mockResolvedValue({
        results: rows(2),
        default_window_applied: true,
      } as never);
      renderMastSearch(['/search?inst=MIRI&dpt=cube']);
      await waitFor(() => expect(mastService.searchByFacets).toHaveBeenCalledTimes(1));
      expect(vi.mocked(mastService.searchByFacets).mock.lastCall?.[0]).toEqual({
        filters: {
          instrument_name: ['MIRI*'],
          dataproduct_type: ['cube'],
          intentType: ['science'],
        },
        calibLevel: [3],
        daysBack: undefined,
      });
      expect(mastService.searchByTarget).not.toHaveBeenCalled();
      expect(await screen.findByText('Search Results (2)')).toBeInTheDocument();
      // applied facets as chips, plus the server's default window
      const chips = screen.getByRole('list', { name: 'Active filters' });
      expect(chips).toHaveTextContent('MIRI');
      expect(chips).toHaveTextContent('CUBE');
      expect(chips).toHaveTextContent('LAST 90 DAYS');
    });

    it('removing the default-window chip widens to 365 days and re-runs', async () => {
      vi.mocked(mastService.searchByFacets).mockResolvedValue({
        results: rows(1),
        default_window_applied: true,
      } as never);
      renderWithSpy('/search?inst=MIRI');
      await screen.findByRole('button', { name: 'Remove filter LAST 90 DAYS' });
      vi.mocked(mastService.searchByFacets).mockResolvedValue({ results: rows(3) } as never);
      fireEvent.click(screen.getByRole('button', { name: 'Remove filter LAST 90 DAYS' }));
      await waitFor(() => expect(search).toBe('?inst=MIRI&days=365'));
      await waitFor(() => expect(mastService.searchByFacets).toHaveBeenCalledTimes(2));
      expect(vi.mocked(mastService.searchByFacets).mock.lastCall?.[0]).toMatchObject({
        daysBack: 365,
      });
      expect(await screen.findByText('LAST 365 DAYS')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Remove filter LAST 365 DAYS' })
      ).not.toBeInTheDocument();
    });

    it('Apply with an empty input pushes the facets and runs them', async () => {
      renderWithSpy('/search');
      fireEvent.click(screen.getByRole('button', { name: 'NIRCam' }));
      fireEvent.click(screen.getByRole('button', { name: 'F200W' }));
      fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
      await waitFor(() => expect(search).toBe('?inst=NIRCAM&filt=F200W'));
      await waitFor(() => expect(mastService.searchByFacets).toHaveBeenCalledTimes(1));
      expect(vi.mocked(mastService.searchByFacets).mock.lastCall?.[0]).toMatchObject({
        filters: { instrument_name: ['NIRCAM*'], filters: ['F200W'] },
      });
    });

    it('a target search carries the applied facets as `filters`', async () => {
      renderMastSearch(['/search?q=M16&inst=NIRCAM&calib=2,3']);
      await waitFor(() => expect(mastService.searchByTarget).toHaveBeenCalledTimes(1));
      expect(vi.mocked(mastService.searchByTarget).mock.lastCall?.[0]).toEqual({
        targetName: 'M16',
        radius: 0.2,
        calibLevel: [2, 3],
        filters: { instrument_name: ['NIRCAM*'], intentType: ['science'] },
      });
      expect(mastService.searchByFacets).not.toHaveBeenCalled();
    });

    it('a blank input with no narrowing facets is refused, with a hint about filters', async () => {
      renderMastSearch();
      submit();
      expect(await screen.findByText(/pick filters and apply them/)).toBeInTheDocument();
      expect(mastService.searchByFacets).not.toHaveBeenCalled();
    });

    it('removing an applied chip applies at once', async () => {
      vi.mocked(mastService.searchByTarget).mockResolvedValue({ results: rows(1) } as never);
      renderWithSpy('/search?q=M16&inst=MIRI&dpt=cube');
      await waitFor(() => expect(mastService.searchByTarget).toHaveBeenCalledTimes(1));
      fireEvent.click(await screen.findByRole('button', { name: 'Remove filter CUBE' }));
      await waitFor(() => expect(search).toBe('?q=M16&inst=MIRI'));
      await waitFor(() => expect(mastService.searchByTarget).toHaveBeenCalledTimes(2));
      expect(vi.mocked(mastService.searchByTarget).mock.lastCall?.[0]).toMatchObject({
        filters: { instrument_name: ['MIRI*'] },
      });
    });

    it('the raw-data "include raw" toggle and the rail share one set of levels', async () => {
      renderWithSpy('/search');
      fireEvent.click(screen.getByLabelText(/Include raw/));
      expect(screen.getByLabelText(/Level 1/)).toBeChecked();
      expect(screen.getByLabelText(/Level 2/)).toBeChecked();
      fireEvent.change(queryBox(), { target: { value: 'M16' } });
      submit();
      await waitFor(() => expect(search).toBe('?q=M16&calib=all'));
    });

    it('a deep link still shows results under StrictMode (dev double-mount aborts the first run)', async () => {
      vi.mocked(mastService.searchByTarget).mockResolvedValue({ results: rows(2) } as never);
      render(
        <StrictMode>
          <MemoryRouter initialEntries={['/search?q=M16']}>
            <Routes>
              <Route path="/search" element={<MastSearch />} />
            </Routes>
          </MemoryRouter>
        </StrictMode>
      );
      expect(await screen.findByText('Search Results (2)')).toBeInTheDocument();
    });

    it('says filters do not apply while the input holds an ID', () => {
      renderMastSearch();
      fireEvent.change(queryBox(), { target: { value: 'jw02739-o001' } });
      expect(screen.getByRole('note')).toHaveTextContent(/don't apply to ID lookups/);
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

  describe('sky map + browse-first empty state (MAST Search v2, Phase 5)', () => {
    const CARINA_ROW = {
      obs_id: 'jw-carina',
      instrument_name: 'MIRI/IMAGE',
      target_name: 'NGC 3324',
      s_region: 'POLYGON 151.7538 -40.4086 151.7925 -40.4290 151.7524 -40.4729 151.7137 -40.4524',
    };

    it('with no query and no facets, shows the browse empty state with What\u2019s New and the map', async () => {
      renderMastSearch();
      expect(screen.getByText('Explore the JWST sky')).toBeInTheDocument();
      expect(
        screen.getByText('Pan the sky, pick a recent release, or type a target.')
      ).toBeInTheDocument();
      expect(screen.getByText(/What's New on MAST/)).toBeInTheDocument();
      // the coverage grid reaches the (stubbed) map once loaded
      await waitFor(() => expect(hoisted.getCoverageMock).toHaveBeenCalled());
      await waitFor(() =>
        expect(hoisted.skyMapProps.current?.coverage).toMatchObject({ nside: 64 })
      );
      expect(screen.queryByText('No JWST observations found', { exact: false })).toBeNull();
    });

    it('a search leaves the empty state; results render the toolbar instead', async () => {
      vi.mocked(mastService.searchByTarget).mockResolvedValue({
        results: [CARINA_ROW],
      } as never);
      renderMastSearch(['/search?q=NGC+3324']);
      await waitFor(() => expect(screen.getByText('Search Results (1)')).toBeInTheDocument());
      expect(screen.queryByText('Explore the JWST sky')).toBeNull();
    });

    it('?view=split mounts the map next to the table and links hover both ways', async () => {
      vi.mocked(mastService.searchByTarget).mockResolvedValue({
        results: [CARINA_ROW],
      } as never);
      renderMastSearch(['/search?q=NGC+3324&view=split']);
      await waitFor(() => expect(screen.getByTestId('sky-map-stub')).toBeInTheDocument());
      expect(screen.getByRole('button', { name: 'Split' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Fit map to results' })).toBeInTheDocument();

      // map hover → row highlight class
      const props = hoisted.skyMapProps.current!;
      expect(props.rows).toEqual([CARINA_ROW]);
      act(() => (props.onHover as (id: string | null) => void)('jw-carina'));
      const row = document.getElementById('obs-jw-carina')!;
      await waitFor(() => expect(row.className).toContain('highlighted'));
      act(() => (props.onHover as (id: string | null) => void)(null));
      await waitFor(() => expect(row.className).not.toContain('highlighted'));

      // row hover → the map gets hoverId
      fireEvent.mouseEnter(row);
      await waitFor(() => expect(hoisted.skyMapProps.current?.hoverId).toBe('jw-carina'));
      fireEvent.mouseLeave(row);
      await waitFor(() => expect(hoisted.skyMapProps.current?.hoverId).toBeNull());
    });

    it('table view keeps the map unmounted until Split is chosen', async () => {
      vi.mocked(mastService.searchByTarget).mockResolvedValue({
        results: [CARINA_ROW],
      } as never);
      renderMastSearch(['/search?q=NGC+3324']);
      await waitFor(() => expect(screen.getByText('Search Results (1)')).toBeInTheDocument());
      expect(screen.queryByTestId('sky-map-stub')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Split' }));
      await waitFor(() => expect(screen.getByTestId('sky-map-stub')).toBeInTheDocument());
    });

    it('clicking a browse footprint pushes a coordinate search at its centroid', async () => {
      hoisted.getRecentReleasesMock.mockResolvedValue({ results: [CARINA_ROW] });
      renderMastSearch();
      await waitFor(() => expect((hoisted.skyMapProps.current?.rows as unknown[])?.length).toBe(1));
      act(() => (hoisted.skyMapProps.current!.onClick as (id: string) => void)('jw-carina'));
      await waitFor(() => expect(mastService.searchByCoordinates).toHaveBeenCalled());
      expect(vi.mocked(mastService.searchByCoordinates).mock.lastCall?.[0]).toMatchObject({
        ra: expect.closeTo(151.753, 2) as number,
        dec: expect.closeTo(-40.44, 2) as number,
        radius: 0.2,
      });
    });

    it('recent-search chips sit above the input only in the empty state', async () => {
      vi.mocked(mastService.searchByTarget).mockResolvedValue({ results: [] } as never);
      renderMastSearch(['/search?q=M16']);
      await waitFor(() => expect(mastService.searchByTarget).toHaveBeenCalled());
      // during a search the chips render below
      expect(document.querySelector('.smart-search-recents-below')).not.toBeNull();
    });
  });

  describe('draw-to-search (MAST Search v2, Phase 6)', () => {
    const REGION = {
      kind: 'polygon' as const,
      vertices: [
        { ra: 99, dec: -31 },
        { ra: 101, dec: -31 },
        { ra: 101, dec: -29 },
        { ra: 99, dec: -29 },
      ],
    };
    const IN_ROW = {
      obs_id: 'in-region',
      s_region: 'POLYGON 99.9 -30.1 100.1 -30.1 100.1 -29.9 99.9 -29.9',
    };
    const OUT_ROW = {
      obs_id: 'out-of-region',
      s_region: 'POLYGON 119.9 -30.1 120.1 -30.1 120.1 -29.9 119.9 -29.9',
    };
    const BLIND_ROW = { obs_id: 'no-footprint' };

    beforeEach(() => {
      hoisted.toastWarningMock.mockClear();
    });

    it('drawing on the browse map runs a mode:box search and shows the clipped rows + chip', async () => {
      vi.mocked(mastService.searchByCoordinates).mockResolvedValue({
        results: [IN_ROW, OUT_ROW, BLIND_ROW],
      } as never);
      renderMastSearch();
      await waitFor(() => expect(hoisted.skyMapProps.current?.onRegionDrawn).toBeTruthy());
      act(() => (hoisted.skyMapProps.current!.onRegionDrawn as (r: unknown) => void)(REGION));
      await waitFor(() => expect(mastService.searchByCoordinates).toHaveBeenCalledTimes(1));
      const call = vi.mocked(mastService.searchByCoordinates).mock.lastCall?.[0];
      expect(call?.mode).toBe('box');
      expect(call?.ra).toBeCloseTo(100, 1);
      expect(call?.dec).toBeCloseTo(-30, 1);
      // clipped: the out-of-region row is gone, the footprint-less row kept
      await waitFor(() => expect(screen.getByText('Search Results (2)')).toBeInTheDocument());
      expect(screen.getByText(/REGION: POLYGON · 4 VTX/)).toBeInTheDocument();
      expect(screen.getByText('1 without a readable footprint kept.')).toBeInTheDocument();
    });

    it('a region deep link auto-runs and the truncation banner speaks region', async () => {
      vi.mocked(mastService.searchByCoordinates).mockResolvedValue({
        results: [IN_ROW, OUT_ROW],
        truncated: true,
        page_size: 2,
      } as never);
      renderMastSearch(['/search?region=poly:99,-31;101,-31;101,-29;99,-29']);
      await waitFor(() => expect(mastService.searchByCoordinates).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.getByText('Search Results (1)')).toBeInTheDocument());
      expect(screen.getByText(/region query hit the 2 cap/)).toBeInTheDocument();
    });

    it('rejects an oversize drawn region with a toast and runs nothing', async () => {
      renderMastSearch();
      await waitFor(() => expect(hoisted.skyMapProps.current?.onRegionDrawn).toBeTruthy());
      act(() =>
        (hoisted.skyMapProps.current!.onRegionDrawn as (r: unknown) => void)({
          kind: 'circle',
          ra: 100,
          dec: -30,
          r: 15,
        })
      );
      expect(hoisted.toastWarningMock).toHaveBeenCalledWith(
        'Draw a smaller region',
        expect.any(Object)
      );
      expect(mastService.searchByCoordinates).not.toHaveBeenCalled();
      // still browsing
      expect(screen.getByText('Explore the JWST sky')).toBeInTheDocument();
    });

    it('removing the region chip clears the region and runs nothing new', async () => {
      vi.mocked(mastService.searchByCoordinates).mockResolvedValue({
        results: [IN_ROW],
      } as never);
      renderMastSearch(['/search?region=circle:100,-30,1.5']);
      await waitFor(() => expect(screen.getByText(/REGION: CIRCLE · R 1.50°/)).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: 'Remove the drawn region' }));
      // back to the browse empty state, with no second query
      await waitFor(() => expect(screen.getByText('Explore the JWST sky')).toBeInTheDocument());
      expect(mastService.searchByCoordinates).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(/REGION:/)).toBeNull();
    });
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

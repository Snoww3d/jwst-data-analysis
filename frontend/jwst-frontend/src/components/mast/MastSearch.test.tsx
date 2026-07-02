import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MastSearch from './MastSearch';

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
});

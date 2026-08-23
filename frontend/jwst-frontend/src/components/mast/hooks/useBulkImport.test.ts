import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { mastService } from '../../../services';
import { subscribeToJobProgress } from '../../../hooks/useJobProgress';
import { useBulkImport, MAX_CONCURRENT_IMPORTS } from './useBulkImport';
import type { JobProgressCallbacks } from '../../../hooks/useJobProgress';
import type { ImportJobStatus } from '../../../types/MastTypes';

const hoisted = vi.hoisted(() => ({
  registerJob: vi.fn(),
  subscriptions: new Map<string, JobProgressCallbacks>(),
}));

vi.mock('../../../services', () => ({
  mastService: {
    startImport: vi.fn(),
    cancelImport: vi.fn(),
    resumeImport: vi.fn(),
    importFromExisting: vi.fn(),
    getResumableImports: vi.fn(() => Promise.resolve({ jobs: [] })),
    dismissResumableImport: vi.fn(),
  },
  ApiError: { isApiError: vi.fn(() => false) },
}));
vi.mock('../../../hooks/useJobProgress', () => ({
  useJobProgress: vi.fn(() => ({ progress: null, isComplete: false, error: null, messages: [] })),
  subscribeToJobProgress: vi.fn((jobId: string, callbacks: JobProgressCallbacks) => {
    hoisted.subscriptions.set(jobId, callbacks);
    return { unsubscribe: vi.fn() };
  }),
}));
vi.mock('../../../context/useActiveImportsContext', () => ({
  useActiveImportsContext: () => ({
    jobs: [],
    aggregatePercent: 0,
    activeCount: 0,
    registerJob: hoisted.registerJob,
  }),
}));
vi.mock('../../ui/toast', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

const startImport = vi.mocked(mastService.startImport);

const sub = (jobId: string): Required<JobProgressCallbacks> =>
  hoisted.subscriptions.get(jobId) as Required<JobProgressCallbacks>;

const done = (jobId: string, obsId: string): ImportJobStatus => ({
  jobId,
  obsId,
  progress: 100,
  stage: 'Complete',
  message: 'done',
  isComplete: true,
  startedAt: '',
});

describe('useBulkImport', () => {
  beforeEach(() => {
    startImport.mockReset();
    hoisted.registerJob.mockClear();
    hoisted.subscriptions.clear();
    vi.mocked(subscribeToJobProgress).mockClear();
    vi.mocked(mastService.getResumableImports).mockClear();
  });

  const render = (isAuthenticated = true) =>
    renderHook(() => useBulkImport({ isAuthenticated, calibLevel: [3] }));

  it('single import: starts the job with the chosen options and registers it', async () => {
    startImport.mockResolvedValue({ jobId: 'job-1', obsId: 'a', message: '' });
    const { result } = render();
    act(() => result.current.setDownloadSource('s3'));
    await act(() => result.current.handleImport('a'));
    expect(startImport).toHaveBeenCalledWith({
      obsId: 'a',
      productType: 'SCIENCE',
      tags: ['mast-import'],
      calibLevel: [3],
      downloadSource: 's3',
    });
    expect(hoisted.registerJob).toHaveBeenCalledWith('job-1', 'a');
    expect(result.current.importing).toBe('a');
    expect(result.current.importProgress?.obsId).toBe('a');
  });

  it('single import failure marks the progress failed and clears importing', async () => {
    startImport.mockRejectedValue(new Error('nope'));
    const { result } = render();
    await act(() => result.current.handleImport('a'));
    expect(result.current.importing).toBeNull();
    expect(result.current.importProgress).toMatchObject({ stage: 'Failed', error: 'nope' });
  });

  it('bulk import of one id takes the single-import path', async () => {
    startImport.mockResolvedValue({ jobId: 'job-1', obsId: 'a', message: '' });
    const { result } = render();
    await act(() => result.current.handleBulkImport(['a']));
    expect(result.current.bulkImportStatus).toBeNull();
    expect(result.current.importing).toBe('a');
  });

  it('does nothing for anonymous users (#1648)', async () => {
    const { result } = render(false);
    await act(() => result.current.handleBulkImport(['a', 'b']));
    expect(startImport).not.toHaveBeenCalled();
  });

  it('bulk import runs at most MAX_CONCURRENT_IMPORTS jobs at once and tracks counts', async () => {
    let n = 0;
    startImport.mockImplementation(async ({ obsId }) => ({
      jobId: `job-${++n}`,
      obsId,
      message: '',
    }));
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const { result } = render();

    let finished = false;
    act(() => {
      void result.current.handleBulkImport(ids).then(() => {
        finished = true;
      });
    });

    // Only the first three start; the rest wait for a slot.
    await waitFor(() => expect(startImport).toHaveBeenCalledTimes(MAX_CONCURRENT_IMPORTS));
    await new Promise((r) => setTimeout(r, 250));
    expect(startImport).toHaveBeenCalledTimes(MAX_CONCURRENT_IMPORTS);
    expect(result.current.bulkImportStatus?.isActive).toBe(true);
    expect(result.current.bulkImportStatus?.pendingObsIds).toEqual(['d', 'e']);

    // Complete one → one more starts.
    await act(async () => {
      sub('job-1').onCompleted(done('job-1', 'a'));
    });
    await waitFor(() => expect(startImport).toHaveBeenCalledTimes(MAX_CONCURRENT_IMPORTS + 1));
    expect(result.current.bulkImportStatus?.completedCount).toBe(1);

    // Fail one, complete the rest.
    await act(async () => {
      sub('job-2').onFailed({ ...done('job-2', 'b'), stage: 'Failed' });
    });
    await waitFor(() => expect(startImport).toHaveBeenCalledTimes(ids.length));
    await act(async () => {
      for (const j of ['job-3', 'job-4', 'job-5']) {
        sub(j).onCompleted(done(j, j));
      }
    });

    await waitFor(() => expect(finished).toBe(true));
    expect(result.current.bulkImportStatus).toMatchObject({
      isActive: false,
      totalCount: 5,
      completedCount: 4,
      failedCount: 1,
    });
    expect(hoisted.registerJob).toHaveBeenCalledTimes(5);
  });

  it('fetches resumable imports only when authenticated', async () => {
    render(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(mastService.getResumableImports).not.toHaveBeenCalled();
    render(true);
    await waitFor(() => expect(mastService.getResumableImports).toHaveBeenCalled());
  });
});

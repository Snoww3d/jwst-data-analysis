/**
 * Tests for useActiveImports — the global MAST import-tracking hook backing
 * the header progress pill (#mast-archive-extraction).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ImportJobStatus } from '../types/MastTypes';

// vi.hoisted lets the mock factories below capture these refs without
// hitting "cannot access before initialization" — bare `vi.mock` factories
// hoist to the top of the module ahead of regular `const`s.
const hoisted = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  getResumableImportsMock: vi.fn(),
  subscribeToJobProgressMock: vi.fn(),
  navigateMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('../context/useAuth', () => ({
  useAuth: hoisted.useAuthMock,
}));

vi.mock('../services/mastService', () => ({
  mastService: { getResumableImports: hoisted.getResumableImportsMock },
}));

vi.mock('./useJobProgress', () => ({
  subscribeToJobProgress: hoisted.subscribeToJobProgressMock,
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => hoisted.navigateMock,
}));

vi.mock('../components/ui/toast', () => ({
  toast: { success: hoisted.toastSuccessMock, error: hoisted.toastErrorMock },
}));

import { useActiveImports } from './useActiveImports';

interface JobCallbacks {
  onProgress?: (status: ImportJobStatus) => void;
  onCompleted?: (status: ImportJobStatus) => void;
  onFailed?: (status: ImportJobStatus) => void;
}

describe('useActiveImports', () => {
  let capturedCallbacks: Record<string, JobCallbacks>;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedCallbacks = {};
    hoisted.getResumableImportsMock.mockResolvedValue({ jobs: [], count: 0 });
    hoisted.subscribeToJobProgressMock.mockImplementation(
      (jobId: string, callbacks: JobCallbacks) => {
        capturedCallbacks[jobId] = callbacks;
        return { unsubscribe: vi.fn() };
      }
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('anonymous users: no fetch, empty state', () => {
    hoisted.useAuthMock.mockReturnValue({ isAuthenticated: false });

    const { result } = renderHook(() => useActiveImports());

    expect(result.current.jobs).toEqual([]);
    expect(result.current.activeCount).toBe(0);
    expect(hoisted.getResumableImportsMock).not.toHaveBeenCalled();
  });

  it('authenticated users: fetches resumable jobs and exposes them', async () => {
    hoisted.useAuthMock.mockReturnValue({ isAuthenticated: true });
    hoisted.getResumableImportsMock.mockResolvedValue({
      jobs: [
        {
          jobId: 'job-1',
          obsId: 'obs-1',
          progressPercent: 30,
          status: 'downloading',
          totalBytes: 100,
          downloadedBytes: 30,
          totalFiles: 2,
          completedFiles: 0,
        },
      ],
      count: 1,
    });

    const { result } = renderHook(() => useActiveImports());

    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    expect(result.current.jobs[0]).toMatchObject({ jobId: 'job-1', obsId: 'obs-1' });
    expect(hoisted.subscribeToJobProgressMock).toHaveBeenCalledWith('job-1', expect.any(Object));
  });

  it('excludes terminal resumable jobs (already complete/failed/cancelled)', async () => {
    hoisted.useAuthMock.mockReturnValue({ isAuthenticated: true });
    hoisted.getResumableImportsMock.mockResolvedValue({
      jobs: [
        {
          jobId: 'job-done',
          obsId: 'obs-done',
          progressPercent: 100,
          status: 'complete',
          totalBytes: 0,
          downloadedBytes: 0,
          totalFiles: 0,
          completedFiles: 0,
        },
      ],
      count: 1,
    });

    const { result } = renderHook(() => useActiveImports());

    await waitFor(() => expect(hoisted.getResumableImportsMock).toHaveBeenCalled());
    expect(result.current.jobs).toEqual([]);
  });

  it('swallows fetch failures and stays empty', async () => {
    hoisted.useAuthMock.mockReturnValue({ isAuthenticated: true });
    hoisted.getResumableImportsMock.mockRejectedValue(new Error('network error'));

    const { result } = renderHook(() => useActiveImports());

    await waitFor(() => expect(hoisted.getResumableImportsMock).toHaveBeenCalled());
    expect(result.current.jobs).toEqual([]);
  });

  it('registerJob adds a job immediately with starting state', () => {
    hoisted.useAuthMock.mockReturnValue({ isAuthenticated: true });

    const { result } = renderHook(() => useActiveImports());

    act(() => {
      result.current.registerJob('new-job', 'obs-42');
    });

    expect(result.current.jobs).toHaveLength(1);
    expect(result.current.jobs[0]).toMatchObject({
      jobId: 'new-job',
      obsId: 'obs-42',
      percent: 0,
      status: 'starting',
    });
  });

  it('registerJob is a no-op if the job is already tracked', () => {
    hoisted.useAuthMock.mockReturnValue({ isAuthenticated: true });

    const { result } = renderHook(() => useActiveImports());

    act(() => {
      result.current.registerJob('dup-job');
      result.current.registerJob('dup-job');
    });

    expect(result.current.jobs).toHaveLength(1);
    expect(hoisted.subscribeToJobProgressMock).toHaveBeenCalledTimes(1);
  });

  it('updates percent/status on progress events', () => {
    hoisted.useAuthMock.mockReturnValue({ isAuthenticated: true });

    const { result } = renderHook(() => useActiveImports());

    act(() => {
      result.current.registerJob('job-1');
    });

    act(() => {
      capturedCallbacks['job-1'].onProgress?.({
        jobId: 'job-1',
        obsId: 'obs-1',
        progress: 55,
        stage: 'Downloading',
        message: '',
        isComplete: false,
        startedAt: new Date().toISOString(),
      });
    });

    expect(result.current.jobs[0]).toMatchObject({ percent: 55, status: 'running' });
  });

  it('on completion: fires a success toast and eventually removes the job', () => {
    vi.useFakeTimers();
    hoisted.useAuthMock.mockReturnValue({ isAuthenticated: true });

    const { result } = renderHook(() => useActiveImports());

    act(() => {
      result.current.registerJob('job-1');
    });

    act(() => {
      capturedCallbacks['job-1'].onCompleted?.({
        jobId: 'job-1',
        obsId: 'obs-1',
        progress: 100,
        stage: 'Complete',
        message: 'Done',
        isComplete: true,
        startedAt: new Date().toISOString(),
      });
    });

    expect(hoisted.toastSuccessMock).toHaveBeenCalledTimes(1);
    expect(hoisted.toastSuccessMock).toHaveBeenCalledWith('Import complete', expect.any(Object));
    expect(result.current.jobs[0]).toMatchObject({ status: 'complete', percent: 100 });

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(result.current.jobs).toEqual([]);
  });

  it('bulk imports: no toast fires while other jobs in the batch are still active', () => {
    hoisted.useAuthMock.mockReturnValue({ isAuthenticated: true });

    const { result } = renderHook(() => useActiveImports());

    act(() => {
      result.current.registerJob('job-1');
      result.current.registerJob('job-2');
    });

    act(() => {
      capturedCallbacks['job-1'].onCompleted?.({
        jobId: 'job-1',
        obsId: 'obs-1',
        progress: 100,
        stage: 'Complete',
        message: 'Done',
        isComplete: true,
        startedAt: new Date().toISOString(),
      });
    });

    // job-2 is still active (starting/running) — the pill keeps showing,
    // but no toast fires yet.
    expect(hoisted.toastSuccessMock).not.toHaveBeenCalled();
  });

  it('when all jobs registered together settle, fires exactly one aggregated toast on the last one (best-effort — see doc comment re: MAX_CONCURRENT_IMPORTS waves)', () => {
    hoisted.useAuthMock.mockReturnValue({ isAuthenticated: true });

    const { result } = renderHook(() => useActiveImports());

    act(() => {
      result.current.registerJob('job-1');
      result.current.registerJob('job-2');
      result.current.registerJob('job-3');
    });

    act(() => {
      capturedCallbacks['job-1'].onCompleted?.({
        jobId: 'job-1',
        obsId: 'obs-1',
        progress: 100,
        stage: 'Complete',
        message: 'Done',
        isComplete: true,
        startedAt: new Date().toISOString(),
      });
    });
    expect(hoisted.toastSuccessMock).not.toHaveBeenCalled();

    act(() => {
      capturedCallbacks['job-2'].onFailed?.({
        jobId: 'job-2',
        obsId: 'obs-2',
        progress: 40,
        stage: 'Failed',
        message: 'boom',
        error: 'boom',
        isComplete: true,
        startedAt: new Date().toISOString(),
      });
    });
    // A failure in the batch fires its own error toast and drops out of the
    // active set, but does not trigger the aggregated success toast.
    expect(hoisted.toastErrorMock).toHaveBeenCalledTimes(1);
    expect(hoisted.toastSuccessMock).not.toHaveBeenCalled();

    act(() => {
      capturedCallbacks['job-3'].onCompleted?.({
        jobId: 'job-3',
        obsId: 'obs-3',
        progress: 100,
        stage: 'Complete',
        message: 'Done',
        isComplete: true,
        startedAt: new Date().toISOString(),
      });
    });

    // job-3 was the last active job — exactly one aggregated toast fires,
    // summarizing every completion since the active set was last empty
    // (job-1 and job-3 both succeeded — 2 completions — even though job-2
    // failed in between).
    expect(hoisted.toastSuccessMock).toHaveBeenCalledTimes(1);
    expect(hoisted.toastSuccessMock).toHaveBeenCalledWith('Imports complete', expect.any(Object));
  });

  it('flushes the batch toast for already-completed jobs when a FAILURE empties the active set (regression: leaked count)', () => {
    hoisted.useAuthMock.mockReturnValue({ isAuthenticated: true });

    const { result } = renderHook(() => useActiveImports());

    // Bulk A+B: A completes silently (batch count = 1, set still has B
    // active so no toast yet), then B fails and is the one that empties
    // the active set.
    act(() => {
      result.current.registerJob('job-a');
      result.current.registerJob('job-b');
    });

    act(() => {
      capturedCallbacks['job-a'].onCompleted?.({
        jobId: 'job-a',
        obsId: 'obs-a',
        progress: 100,
        stage: 'Complete',
        message: 'Done',
        isComplete: true,
        startedAt: new Date().toISOString(),
      });
    });
    expect(hoisted.toastSuccessMock).not.toHaveBeenCalled();

    act(() => {
      capturedCallbacks['job-b'].onFailed?.({
        jobId: 'job-b',
        obsId: 'obs-b',
        progress: 40,
        stage: 'Failed',
        message: 'boom',
        error: 'boom',
        isComplete: true,
        startedAt: new Date().toISOString(),
      });
    });

    // (a) B failing (the last active job) flushes the count — A's success
    // is acknowledged with exactly one toast, not silently dropped.
    expect(hoisted.toastErrorMock).toHaveBeenCalledTimes(1);
    expect(hoisted.toastSuccessMock).toHaveBeenCalledTimes(1);
    expect(hoisted.toastSuccessMock).toHaveBeenCalledWith('Import complete', expect.any(Object));

    hoisted.toastSuccessMock.mockClear();

    // (b) A later, unrelated single import must not inherit any leftover
    // count from the earlier batch — regression would show "Imports
    // complete" (plural) here instead of the correct singular.
    act(() => {
      result.current.registerJob('job-c');
    });
    act(() => {
      capturedCallbacks['job-c'].onCompleted?.({
        jobId: 'job-c',
        obsId: 'obs-c',
        progress: 100,
        stage: 'Complete',
        message: 'Done',
        isComplete: true,
        startedAt: new Date().toISOString(),
      });
    });

    expect(hoisted.toastSuccessMock).toHaveBeenCalledTimes(1);
    expect(hoisted.toastSuccessMock).toHaveBeenCalledWith('Import complete', expect.any(Object));
  });

  it('on failure: fires an error toast and drops the job immediately', () => {
    hoisted.useAuthMock.mockReturnValue({ isAuthenticated: true });

    const { result } = renderHook(() => useActiveImports());

    act(() => {
      result.current.registerJob('job-1');
    });

    act(() => {
      capturedCallbacks['job-1'].onFailed?.({
        jobId: 'job-1',
        obsId: 'obs-1',
        progress: 40,
        stage: 'Failed',
        message: 'boom',
        error: 'boom',
        isComplete: true,
        startedAt: new Date().toISOString(),
      });
    });

    expect(hoisted.toastErrorMock).toHaveBeenCalledWith('boom');
    expect(result.current.jobs).toEqual([]);
  });
});

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCalibrationJob } from './useCalibrationJob';
import type { CalibrationJob } from '../types/CalibrationTypes';

vi.mock('../services/calibrationService', () => ({
  getJob: vi.fn(),
}));

import { getJob } from '../services/calibrationService';

function makeJob(status: CalibrationJob['status']): CalibrationJob {
  return {
    jobId: 'j1',
    type: 'calibration',
    status,
    cancelRequested: false,
    createdAt: '2026-07-24T00:00:00Z',
    startedAt: null,
    finishedAt: null,
    progress: { stages: [], currentStage: null, message: null, downloadPct: null },
    logTail: [],
    result: null,
    error: null,
    request: {},
  };
}

describe('useCalibrationJob', () => {
  beforeEach(() => {
    vi.mocked(getJob).mockReset();
  });

  it('does nothing without a job id', () => {
    const { result } = renderHook(() => useCalibrationJob(null));
    expect(result.current.job).toBeNull();
    expect(getJob).not.toHaveBeenCalled();
  });

  it('polls until the job is terminal, then stops', async () => {
    vi.mocked(getJob)
      .mockResolvedValueOnce(makeJob('running'))
      .mockResolvedValueOnce(makeJob('succeeded'));
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useCalibrationJob('j1'));
      // First poll resolves with running.
      await vi.waitFor(() => expect(result.current.job?.status).toBe('running'));
      // Advance to the second poll → terminal.
      await vi.advanceTimersByTimeAsync(1600);
      await vi.waitFor(() => expect(result.current.job?.status).toBe('succeeded'));
      expect(result.current.isTerminal).toBe(true);
      const callsAtTerminal = vi.mocked(getJob).mock.calls.length;
      await vi.advanceTimersByTimeAsync(5000);
      expect(vi.mocked(getJob).mock.calls.length).toBe(callsAtTerminal);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps polling through transient errors and surfaces the message', async () => {
    vi.mocked(getJob)
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValueOnce(makeJob('succeeded'));
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useCalibrationJob('j1'));
      await vi.waitFor(() => expect(result.current.error).toBe('blip'));
      await vi.advanceTimersByTimeAsync(1600);
      await vi.waitFor(() => expect(result.current.job?.status).toBe('succeeded'));
      expect(result.current.error).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

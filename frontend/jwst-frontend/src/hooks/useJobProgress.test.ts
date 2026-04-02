/**
 * TDD tests for job progress timeout behavior — written BEFORE implementation.
 * Issue #659: SignalR-only jobs have hardcoded 10-minute timeout causing false failures
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock signalRService — capture the callbacks so tests can simulate events
let signalRCallbacks: Record<string, (...args: unknown[]) => void> = {};
const mockUnsubscribe = vi.fn();
vi.mock('../services/signalRService', () => ({
  subscribeToJob: vi.fn((_jobId: string, cbs: Record<string, unknown>) => {
    signalRCallbacks = cbs as Record<string, (...args: unknown[]) => void>;
    return globalThis.Promise.resolve(mockUnsubscribe);
  }),
}));

// Mock mastService (polling endpoint)
vi.mock('../services/mastService', () => ({
  getImportProgress: vi.fn(),
}));

import { subscribeToJobProgress } from './useJobProgress';

describe('subscribeToJobProgress — timeout behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    signalRCallbacks = {};
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --- Initial timeout (signalROnly mode) ---

  describe('initial timeout (signalROnly)', () => {
    it('should fire onFailed after default initialTimeoutMs (2 min) when no events arrive', async () => {
      const onFailed = vi.fn();
      subscribeToJobProgress('job-1', { onFailed }, { signalROnly: true });

      // Flush the subscribeToJob promise
      await vi.advanceTimersByTimeAsync(0);

      // Advance to just before 2 minutes — should NOT fire
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000 - 1);
      expect(onFailed).not.toHaveBeenCalled();

      // Advance past 2 minutes — should fire
      await vi.advanceTimersByTimeAsync(1);
      expect(onFailed).toHaveBeenCalledTimes(1);
      expect(onFailed.mock.calls[0][0].error).toMatch(/SignalR timeout/i);
    });

    it('should use custom initialTimeoutMs when provided', async () => {
      const onFailed = vi.fn();
      subscribeToJobProgress(
        'job-1',
        { onFailed },
        { signalROnly: true, initialTimeoutMs: 30_000 }
      );

      await vi.advanceTimersByTimeAsync(0);

      await vi.advanceTimersByTimeAsync(29_999);
      expect(onFailed).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(onFailed).toHaveBeenCalledTimes(1);
    });

    it('should NOT fire initial timeout after a progress event arrives', async () => {
      const onFailed = vi.fn();
      const onProgress = vi.fn();
      subscribeToJobProgress('job-1', { onFailed, onProgress }, { signalROnly: true });

      await vi.advanceTimersByTimeAsync(0);

      // Simulate a progress event at 1 minute
      await vi.advanceTimersByTimeAsync(60_000);
      signalRCallbacks.onProgress?.({
        jobId: 'job-1',
        progressPercent: 10,
        stage: 'Processing',
        message: 'Working...',
      });
      expect(onProgress).toHaveBeenCalled();

      // Advance past the initial timeout (2 min total) — should NOT fire
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
      expect(onFailed).not.toHaveBeenCalled();
    });
  });

  // --- Stale progress timeout (signalROnly mode) ---

  describe('stale progress timeout (signalROnly)', () => {
    it('should fire onFailed after default staleProgressTimeoutMs (5 min) of silence following progress', async () => {
      const onFailed = vi.fn();
      const onProgress = vi.fn();
      subscribeToJobProgress('job-1', { onFailed, onProgress }, { signalROnly: true });

      await vi.advanceTimersByTimeAsync(0);

      // First progress event at 30s
      await vi.advanceTimersByTimeAsync(30_000);
      signalRCallbacks.onProgress?.({
        jobId: 'job-1',
        progressPercent: 10,
        stage: 'Processing',
        message: 'Step 1',
      });

      // Advance 5 min of silence — should fire stale timeout
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(onFailed).toHaveBeenCalledTimes(1);
      expect(onFailed.mock.calls[0][0].error).toMatch(/stale|no progress/i);
    });

    it('should reset stale timeout on each progress event', async () => {
      const onFailed = vi.fn();
      subscribeToJobProgress('job-1', { onFailed, onProgress: vi.fn() }, { signalROnly: true });

      await vi.advanceTimersByTimeAsync(0);

      // Progress at 30s
      await vi.advanceTimersByTimeAsync(30_000);
      signalRCallbacks.onProgress?.({
        jobId: 'job-1',
        progressPercent: 10,
        stage: 'Processing',
        message: 'Step 1',
      });

      // Progress again at 4 min (before 5 min stale timeout)
      await vi.advanceTimersByTimeAsync(3.5 * 60 * 1000);
      signalRCallbacks.onProgress?.({
        jobId: 'job-1',
        progressPercent: 50,
        stage: 'Processing',
        message: 'Step 2',
      });

      // Wait another 4 min (still within 5 min of last progress)
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
      expect(onFailed).not.toHaveBeenCalled();

      // Wait past 5 min from last progress — NOW it should fire
      await vi.advanceTimersByTimeAsync(1.5 * 60 * 1000);
      expect(onFailed).toHaveBeenCalledTimes(1);
    });

    it('should use custom staleProgressTimeoutMs when provided', async () => {
      const onFailed = vi.fn();
      subscribeToJobProgress(
        'job-1',
        { onFailed, onProgress: vi.fn() },
        { signalROnly: true, staleProgressTimeoutMs: 60_000 }
      );

      await vi.advanceTimersByTimeAsync(0);

      // Progress event
      signalRCallbacks.onProgress?.({
        jobId: 'job-1',
        progressPercent: 10,
        stage: 'Processing',
        message: 'Working...',
      });

      // 59s — should NOT fire
      await vi.advanceTimersByTimeAsync(59_000);
      expect(onFailed).not.toHaveBeenCalled();

      // 1 more second — should fire
      await vi.advanceTimersByTimeAsync(1_000);
      expect(onFailed).toHaveBeenCalledTimes(1);
    });

    it('should NOT fire stale timeout when job completes normally', async () => {
      const onFailed = vi.fn();
      const onCompleted = vi.fn();
      subscribeToJobProgress(
        'job-1',
        { onFailed, onCompleted, onProgress: vi.fn() },
        { signalROnly: true }
      );

      await vi.advanceTimersByTimeAsync(0);

      // Progress event
      signalRCallbacks.onProgress?.({
        jobId: 'job-1',
        progressPercent: 50,
        stage: 'Processing',
        message: 'Half done',
      });

      // Completion event at 2 min
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
      signalRCallbacks.onCompleted?.({
        jobId: 'job-1',
        message: 'Done',
        completedAt: new Date().toISOString(),
      });
      expect(onCompleted).toHaveBeenCalled();

      // Wait past stale timeout — should NOT fire since job completed
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(onFailed).not.toHaveBeenCalled();
    });
  });

  // --- Ghost callback prevention ---

  describe('no ghost callbacks after timeout', () => {
    it('should ignore SignalR events after initial timeout fires', async () => {
      const onFailed = vi.fn();
      const onProgress = vi.fn();
      subscribeToJobProgress('job-1', { onFailed, onProgress }, { signalROnly: true });

      await vi.advanceTimersByTimeAsync(0);

      // Let initial timeout fire (2 min)
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
      expect(onFailed).toHaveBeenCalledTimes(1);

      // Late SignalR progress arrives — should be ignored
      signalRCallbacks.onProgress?.({
        jobId: 'job-1',
        progressPercent: 50,
        stage: 'Processing',
        message: 'Late event',
      });
      expect(onProgress).not.toHaveBeenCalled();
      expect(onFailed).toHaveBeenCalledTimes(1); // No second call
    });
  });

  // --- Polling timeout ---

  describe('polling timeout', () => {
    it('should use configured pollingTimeoutMs instead of hardcoded 10 min', async () => {
      const { getImportProgress } = await import('../services/mastService');
      const mockGetProgress = vi.mocked(getImportProgress);
      // Return in-progress status forever
      mockGetProgress.mockResolvedValue({
        jobId: 'job-1',
        obsId: 'obs-1',
        progress: 50,
        stage: 'Running',
        message: 'Still going',
        isComplete: false,
        startedAt: new Date().toISOString(),
      });

      const onFailed = vi.fn();
      subscribeToJobProgress(
        'job-1',
        { onFailed, onProgress: vi.fn() },
        { pollingTimeoutMs: 5 * 60 * 1000, pollIntervalMs: 1000 }
      );

      await vi.advanceTimersByTimeAsync(0);

      // Advance to just before 5 min
      for (let i = 0; i < 299; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }
      expect(onFailed).not.toHaveBeenCalled();

      // Advance past 5 min
      await vi.advanceTimersByTimeAsync(2000);
      expect(onFailed).toHaveBeenCalledTimes(1);
      expect(onFailed.mock.calls[0][0].error).toMatch(/timed out/i);
    });

    it('should default pollingTimeoutMs to 30 minutes', async () => {
      const { getImportProgress } = await import('../services/mastService');
      const mockGetProgress = vi.mocked(getImportProgress);
      mockGetProgress.mockResolvedValue({
        jobId: 'job-1',
        obsId: 'obs-1',
        progress: 50,
        stage: 'Running',
        message: 'Still going',
        isComplete: false,
        startedAt: new Date().toISOString(),
      });

      const onFailed = vi.fn();
      subscribeToJobProgress(
        'job-1',
        { onFailed, onProgress: vi.fn() },
        { pollIntervalMs: 10_000 }
      );

      await vi.advanceTimersByTimeAsync(0);

      // At 10 min (old hardcoded timeout) — should NOT fire
      for (let i = 0; i < 60; i++) {
        await vi.advanceTimersByTimeAsync(10_000);
      }
      expect(onFailed).not.toHaveBeenCalled();

      // Continue to 30 min + buffer
      for (let i = 0; i < 121; i++) {
        await vi.advanceTimersByTimeAsync(10_000);
      }
      expect(onFailed).toHaveBeenCalledTimes(1);
    });
  });

  // --- Cleanup ---

  describe('cleanup', () => {
    it('should not fire any timeout after unsubscribe', async () => {
      const onFailed = vi.fn();
      const sub = subscribeToJobProgress('job-1', { onFailed }, { signalROnly: true });

      await vi.advanceTimersByTimeAsync(0);

      // Unsubscribe before timeout
      sub.unsubscribe();

      // Advance past all timeouts
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
      expect(onFailed).not.toHaveBeenCalled();
    });
  });
});

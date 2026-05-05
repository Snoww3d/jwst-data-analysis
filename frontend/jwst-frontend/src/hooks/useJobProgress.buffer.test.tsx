/**
 * Tests for the rolling messages buffer added to useJobProgress in #1471.
 *
 * Kept in a separate file from useJobProgress.test.ts because these render
 * the hook itself (via @testing-library/react's renderHook), while the
 * sibling file only exercises the imperative `subscribeToJobProgress` layer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// vi.hoisted lets the mock factories below capture these refs without
// hitting "cannot access before initialization" — the bare `vi.mock`
// factory hoists to the top of the module ahead of regular `const`s.
type SignalRCb = Record<string, (...args: unknown[]) => void>;
const hoisted = vi.hoisted(() => ({
  signalRCallbacks: {} as Record<string, (...args: unknown[]) => void>,
  connStateListener: null as ((state: string) => void) | null,
  apiGetMock: vi.fn(),
  mockUnsubscribe: vi.fn(),
}));

vi.mock('../services/signalRService', () => ({
  subscribeToJob: vi.fn((_jobId: string, cbs: Record<string, unknown>) => {
    hoisted.signalRCallbacks = cbs as SignalRCb;
    return globalThis.Promise.resolve(hoisted.mockUnsubscribe);
  }),
  onConnectionStateChange: vi.fn((listener: (s: string) => void) => {
    hoisted.connStateListener = listener;
    return () => {
      hoisted.connStateListener = null;
    };
  }),
}));

vi.mock('../services/mastService', () => ({
  getImportProgress: vi.fn(),
}));

vi.mock('../services/apiClient', () => ({
  apiClient: {
    get: hoisted.apiGetMock,
  },
}));

import { useJobProgress } from './useJobProgress';

describe('useJobProgress — messages buffer (#1471)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.signalRCallbacks = {};
    hoisted.connStateListener = null;
    hoisted.apiGetMock.mockResolvedValue({ messages: [] });
  });

  it('seeds the buffer from GET /api/jobs/{id} on mount', async () => {
    hoisted.apiGetMock.mockResolvedValue({
      messages: ['Reprojecting R (1 of 3)', 'Reprojecting G (2 of 3)'],
    });

    const { result } = renderHook(() => useJobProgress('job-A'));

    // Flush the seed promise.
    await waitFor(() => expect(hoisted.apiGetMock).toHaveBeenCalledWith('/api/jobs/job-A'));
    await waitFor(() => expect(result.current.messages.length).toBeGreaterThan(0));

    expect(result.current.messages).toEqual(['Reprojecting R (1 of 3)', 'Reprojecting G (2 of 3)']);
  });

  it('appends progress messages on each event', async () => {
    const { result } = renderHook(() => useJobProgress('job-B'));
    await waitFor(() => expect(typeof hoisted.signalRCallbacks.onProgress).toBe('function'));

    act(() => {
      hoisted.signalRCallbacks.onProgress({
        progress: 10,
        stage: 'reproject',
        message: 'Reprojecting R (1 of 3)',
      });
    });
    act(() => {
      hoisted.signalRCallbacks.onProgress({
        progress: 20,
        stage: 'reproject',
        message: 'Reprojecting G (2 of 3)',
      });
    });

    expect(result.current.messages).toEqual(['Reprojecting R (1 of 3)', 'Reprojecting G (2 of 3)']);
  });

  it('dedupes consecutive duplicate progress messages', async () => {
    const { result } = renderHook(() => useJobProgress('job-C'));
    await waitFor(() => expect(typeof hoisted.signalRCallbacks.onProgress).toBe('function'));

    act(() => {
      hoisted.signalRCallbacks.onProgress({
        progress: 10,
        stage: 'reproject',
        message: 'Reprojecting R (1 of 3)',
      });
      hoisted.signalRCallbacks.onProgress({
        progress: 11,
        stage: 'reproject',
        message: 'Reprojecting R (1 of 3)',
      });
      hoisted.signalRCallbacks.onProgress({
        progress: 12,
        stage: 'reproject',
        message: 'Reprojecting R (1 of 3)',
      });
      hoisted.signalRCallbacks.onProgress({
        progress: 20,
        stage: 'reproject',
        message: 'Reprojecting G (2 of 3)',
      });
    });

    expect(result.current.messages).toEqual(['Reprojecting R (1 of 3)', 'Reprojecting G (2 of 3)']);
  });

  it('caps the buffer at 50 entries', async () => {
    const { result } = renderHook(() => useJobProgress('job-D'));
    await waitFor(() => expect(typeof hoisted.signalRCallbacks.onProgress).toBe('function'));

    act(() => {
      for (let i = 0; i < 60; i++) {
        hoisted.signalRCallbacks.onProgress({
          progress: i % 100,
          stage: 'stretch',
          message: `step ${i}`,
        });
      }
    });

    expect(result.current.messages).toHaveLength(50);
    // Oldest 10 dropped; first remaining is "step 10".
    expect(result.current.messages[0]).toBe('step 10');
    expect(result.current.messages[49]).toBe('step 59');
  });

  it('refetches buffer on SignalR reconnect', async () => {
    hoisted.apiGetMock.mockResolvedValueOnce({ messages: ['initial'] });
    hoisted.apiGetMock.mockResolvedValueOnce({
      messages: ['initial', 'after-reconnect-1', 'after-reconnect-2'],
    });

    const { result } = renderHook(() => useJobProgress('job-E'));

    await waitFor(() => expect(result.current.messages).toEqual(['initial']));
    expect(hoisted.connStateListener).not.toBeNull();

    // Simulate a reconnect: state goes from connected → reconnecting → connected.
    // The hook should refetch on the second 'connected'.
    act(() => {
      hoisted.connStateListener!('connected');
    });
    act(() => {
      hoisted.connStateListener!('reconnecting');
    });
    act(() => {
      hoisted.connStateListener!('connected');
    });

    // Initial mount: 1 fetch. Reconnect (single transition INTO 'connected'
    // after the initial seed completed): 1 fetch. The first 'connected'
    // transition (before reconnect) is suppressed by the initialSeedDone
    // guard so we don't double-fetch on first connect.
    await waitFor(() => expect(hoisted.apiGetMock.mock.calls.length).toBe(2));
    await waitFor(() =>
      expect(result.current.messages).toEqual(['initial', 'after-reconnect-1', 'after-reconnect-2'])
    );
  });

  it('resets buffer when jobId becomes null', async () => {
    hoisted.apiGetMock.mockResolvedValue({ messages: ['hello'] });
    const { result, rerender } = renderHook(
      ({ jobId }: { jobId: string | null }) => useJobProgress(jobId),
      {
        initialProps: { jobId: 'job-F' },
      }
    );

    await waitFor(() => expect(result.current.messages).toEqual(['hello']));

    rerender({ jobId: null as unknown as string });

    expect(result.current.messages).toEqual([]);
  });

  // Regression test for round 2 of the self-review: a non-null → non-null
  // jobId switch must reset state so the new job's server seed isn't merged
  // against the prior job's stale buffer.
  it('resets buffer when jobId switches non-null → non-null', async () => {
    hoisted.apiGetMock.mockImplementation(async (path: string) => {
      if (path.includes('job-old')) {
        return { messages: ['old-msg-A', 'old-msg-B'] };
      }
      return { messages: ['new-msg-only'] };
    });

    const { result, rerender } = renderHook(
      ({ jobId }: { jobId: string }) => useJobProgress(jobId),
      {
        initialProps: { jobId: 'job-old' },
      }
    );

    await waitFor(() => expect(result.current.messages).toEqual(['old-msg-A', 'old-msg-B']));

    rerender({ jobId: 'job-new' });

    // Old buffer must be cleared synchronously on the rerender; the new
    // server seed then populates it without merging the old entries in.
    await waitFor(() => expect(result.current.messages).toEqual(['new-msg-only']));
    expect(result.current.messages).not.toContain('old-msg-A');
    expect(result.current.messages).not.toContain('old-msg-B');
  });

  // Regression test for round 2 of the self-review: when the local buffer
  // contains the server's tail message at multiple positions, the merge
  // must anchor on the LATEST occurrence (lastIndexOf), not the first
  // (indexOf would double-count entries between first and last match).
  it('merges using the latest local occurrence of the server tail on reconnect', async () => {
    hoisted.apiGetMock.mockResolvedValueOnce({
      messages: ['snapshot-1', 'snapshot-2'],
    });
    // Round 2 reconnect re-fetches a server snapshot whose tail equals an
    // earlier message ALSO present at a later index in the local buffer.
    hoisted.apiGetMock.mockResolvedValueOnce({
      messages: ['snapshot-1', 'snapshot-2', 'recurring'],
    });

    const { result } = renderHook(() => useJobProgress('job-recur'));

    await waitFor(() => expect(result.current.messages).toEqual(['snapshot-1', 'snapshot-2']));
    expect(hoisted.connStateListener).not.toBeNull();

    // Local buffer accrues live events: ..., recurring, X, recurring, Y.
    // The server snapshot's tail will be `recurring`. lastIndexOf must
    // anchor on the second occurrence so only Y is preserved as tail.
    act(() => {
      hoisted.signalRCallbacks.onProgress({ progress: 30, stage: 'a', message: 'recurring' });
      hoisted.signalRCallbacks.onProgress({ progress: 40, stage: 'b', message: 'X' });
      hoisted.signalRCallbacks.onProgress({ progress: 50, stage: 'c', message: 'recurring' });
      hoisted.signalRCallbacks.onProgress({ progress: 60, stage: 'd', message: 'Y' });
    });

    expect(result.current.messages).toEqual([
      'snapshot-1',
      'snapshot-2',
      'recurring',
      'X',
      'recurring',
      'Y',
    ]);

    // Trigger a reconnect so the merge runs against the duplicate-bearing
    // local buffer.
    act(() => {
      hoisted.connStateListener!('connected');
    });
    act(() => {
      hoisted.connStateListener!('reconnecting');
    });
    act(() => {
      hoisted.connStateListener!('connected');
    });

    // Correct merge with lastIndexOf: server's `recurring` anchors on the
    // second local occurrence (index 4), so the tail kept is just `['Y']`.
    // With the buggy indexOf, the tail would have been `['X','recurring','Y']`
    // and the merged result would have included the duplicates.
    await waitFor(() =>
      expect(result.current.messages).toEqual(['snapshot-1', 'snapshot-2', 'recurring', 'Y'])
    );
  });
});

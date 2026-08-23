import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { mastService } from '../../../services';
import {
  useMastSearch,
  clearSearchHistoryCache,
  SEARCH_TIMEOUT_MS,
  DEFAULT_PAGE_SIZE,
} from './useMastSearch';
import type { MastSearchResponse } from '../../../types/MastTypes';

vi.mock('../../../services', () => ({
  mastService: {
    searchByTarget: vi.fn(),
    searchByCoordinates: vi.fn(),
    searchByObservation: vi.fn(),
    searchByProgram: vi.fn(),
  },
  ApiError: { isApiError: vi.fn(() => false) },
}));

const response = (n: number, extra: Partial<MastSearchResponse> = {}): MastSearchResponse => ({
  search_type: 'target',
  query_params: {},
  results: Array.from({ length: n }, (_, i) => ({ obs_id: `jw${i}` })),
  result_count: n,
  timestamp: '',
  ...extra,
});

/** A promise the test resolves by hand, honouring the abort signal. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function abortable<T>(d: ReturnType<typeof deferred<T>>) {
  return (_params: unknown, signal?: AbortSignal) => {
    signal?.addEventListener('abort', () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      d.reject(err);
    });
    return d.promise;
  };
}

describe('useMastSearch', () => {
  beforeEach(() => {
    clearSearchHistoryCache();
    vi.mocked(mastService.searchByTarget).mockReset();
    vi.mocked(mastService.searchByProgram).mockReset();
  });
  afterEach(() => vi.useRealTimers());

  const target = { kind: 'target' as const, name: 'M16' };
  const opts = { radius: 0.2, includeRaw: false };

  it('runs a target search and reports the outcome', async () => {
    vi.mocked(mastService.searchByTarget).mockResolvedValue(response(3));
    const { result } = renderHook(() => useMastSearch());
    expect(result.current.status).toBe('idle');

    await act(() => result.current.run(target, opts));

    expect(result.current.status).toBe('done');
    expect(result.current.outcome).toMatchObject({
      count: 3,
      truncated: false,
      pageSize: DEFAULT_PAGE_SIZE,
      searchType: 'target',
      level3Only: true,
      query: target,
    });
    expect(vi.mocked(mastService.searchByTarget).mock.lastCall?.[0]).toEqual({
      targetName: 'M16',
      radius: 0.2,
      calibLevel: [3],
    });
  });

  describe('truncation', () => {
    it("uses the server's truncated flag and page_size when present", async () => {
      vi.mocked(mastService.searchByTarget).mockResolvedValue(
        response(10, { truncated: true, page_size: 10 })
      );
      const { result } = renderHook(() => useMastSearch());
      await act(() => result.current.run(target, opts));
      expect(result.current.outcome).toMatchObject({ truncated: true, pageSize: 10 });
    });

    it('falls back to rows >= default page size when the server predates the flag', async () => {
      vi.mocked(mastService.searchByTarget).mockResolvedValue(response(DEFAULT_PAGE_SIZE));
      const { result } = renderHook(() => useMastSearch());
      await act(() => result.current.run(target, opts));
      expect(result.current.outcome?.truncated).toBe(true);
    });
  });

  it('observation-ID searches are never level3Only', async () => {
    vi.mocked(mastService.searchByObservation).mockResolvedValue(response(1));
    const { result } = renderHook(() => useMastSearch());
    await act(() => result.current.run({ kind: 'obsId', obsId: 'jw02733-o001' }, opts));
    expect(result.current.outcome?.level3Only).toBe(false);
    expect(result.current.outcome?.searchType).toBe('observation');
  });

  it('reports errors with status error', async () => {
    vi.mocked(mastService.searchByTarget).mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useMastSearch());
    await act(() => result.current.run(target, opts));
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('boom');
    expect(result.current.outcome).toBeNull();
  });

  it('times out after SEARCH_TIMEOUT_MS with a timeout message', async () => {
    vi.useFakeTimers();
    const d = deferred<MastSearchResponse>();
    vi.mocked(mastService.searchByTarget).mockImplementation(abortable(d));
    const { result } = renderHook(() => useMastSearch());
    let p: Promise<void>;
    act(() => {
      p = result.current.run(target, opts);
    });
    expect(result.current.status).toBe('loading');
    await act(async () => {
      vi.advanceTimersByTime(SEARCH_TIMEOUT_MS + 1);
      await p;
    });
    expect(result.current.status).toBe('error');
    expect(result.current.error).toMatch(/timed out/);
  });

  it('abort() cancels the in-flight request without surfacing an error', async () => {
    const d = deferred<MastSearchResponse>();
    vi.mocked(mastService.searchByTarget).mockImplementation(abortable(d));
    const { result } = renderHook(() => useMastSearch());
    let p: Promise<void>;
    act(() => {
      p = result.current.run(target, opts);
    });
    await act(async () => {
      result.current.abort();
      await p;
    });
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
  });

  it('stale-run guard: only the newest run may set state', async () => {
    const first = deferred<MastSearchResponse>();
    vi.mocked(mastService.searchByTarget).mockImplementationOnce(() => first.promise);
    vi.mocked(mastService.searchByProgram).mockResolvedValue(response(2));
    const { result } = renderHook(() => useMastSearch());

    let p1: Promise<void>;
    act(() => {
      p1 = result.current.run(target, opts);
    });
    await act(() => result.current.run({ kind: 'program', programId: '2733' }, opts));
    expect(result.current.outcome?.searchType).toBe('program');

    // The first search finally answers — it must be ignored.
    await act(async () => {
      first.resolve(response(9));
      await p1;
    });
    expect(result.current.outcome?.searchType).toBe('program');
    expect(result.current.outcome?.count).toBe(2);
  });

  describe('history cache (Back/Forward)', () => {
    it('restores a cached outcome for the same key without querying again', async () => {
      vi.mocked(mastService.searchByTarget).mockResolvedValue(response(4));
      const { result } = renderHook(() => useMastSearch());
      await act(() => result.current.run(target, { ...opts, historyKey: 'q=M16' }));
      const firstOutcome = result.current.outcome;
      expect(mastService.searchByTarget).toHaveBeenCalledTimes(1);

      vi.mocked(mastService.searchByProgram).mockResolvedValue(response(1));
      await act(() =>
        result.current.run(
          { kind: 'program', programId: '2733' },
          { ...opts, historyKey: 'q=2733' }
        )
      );
      expect(result.current.outcome?.count).toBe(1);

      // "Back" to the target search
      await act(() => result.current.run(target, { ...opts, historyKey: 'q=M16' }));
      expect(mastService.searchByTarget).toHaveBeenCalledTimes(1);
      expect(result.current.outcome).toBe(firstOutcome);
      expect(result.current.status).toBe('done');
    });

    it('queries when no key is given', async () => {
      vi.mocked(mastService.searchByTarget).mockResolvedValue(response(4));
      const { result } = renderHook(() => useMastSearch());
      await act(() => result.current.run(target, opts));
      await act(() => result.current.run(target, opts));
      expect(mastService.searchByTarget).toHaveBeenCalledTimes(2);
    });

    it('does not cache failures', async () => {
      vi.mocked(mastService.searchByTarget).mockRejectedValueOnce(new Error('boom'));
      vi.mocked(mastService.searchByTarget).mockResolvedValue(response(1));
      const { result } = renderHook(() => useMastSearch());
      await act(() => result.current.run(target, { ...opts, historyKey: 'k' }));
      expect(result.current.status).toBe('error');
      await act(() => result.current.run(target, { ...opts, historyKey: 'k' }));
      expect(result.current.status).toBe('done');
      expect(mastService.searchByTarget).toHaveBeenCalledTimes(2);
    });

    it('aborts on unmount', async () => {
      const d = deferred<MastSearchResponse>();
      const impl = vi.fn(abortable(d));
      vi.mocked(mastService.searchByTarget).mockImplementation(impl);
      const { result, unmount } = renderHook(() => useMastSearch());
      act(() => {
        void result.current.run(target, opts);
      });
      const signal = impl.mock.calls[0][1] as AbortSignal;
      expect(signal.aborted).toBe(false);
      unmount();
      await waitFor(() => expect(signal.aborted).toBe(true));
    });
  });
});

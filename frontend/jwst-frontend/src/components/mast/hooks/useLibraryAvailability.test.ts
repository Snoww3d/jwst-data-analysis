import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { jwstDataService } from '../../../services';
import { useLibraryAvailability, clearAvailabilityCache } from './useLibraryAvailability';
import type { ActiveImportJob } from '../../../hooks/useActiveImports';

const hoisted = vi.hoisted(() => ({
  useAuthMock: vi.fn(() => ({ isAuthenticated: true, isLoading: false })),
  ceMode: { value: false },
  jobs: [] as ActiveImportJob[],
}));

vi.mock('../../../services', () => ({
  jwstDataService: { checkDataAvailability: vi.fn() },
}));
vi.mock('../../../context/useAuth', () => ({ useAuth: hoisted.useAuthMock }));
vi.mock('../../../context/useActiveImportsContext', () => ({
  useActiveImportsContext: () => ({
    jobs: hoisted.jobs,
    aggregatePercent: 0,
    activeCount: 0,
    registerJob: vi.fn(),
  }),
}));
vi.mock('../../../config/ce', () => ({
  get CE_MODE() {
    return hoisted.ceMode.value;
  },
}));

const check = vi.mocked(jwstDataService.checkDataAvailability);

describe('useLibraryAvailability', () => {
  beforeEach(() => {
    clearAvailabilityCache();
    check.mockReset();
    hoisted.useAuthMock.mockReturnValue({ isAuthenticated: true, isLoading: false });
    hoisted.ceMode.value = false;
    hoisted.jobs = [];
  });

  it('checks once per result set and keys results by obs_id', async () => {
    check.mockResolvedValue({ results: { a: { available: true, dataIds: ['1'] } } });
    const { result } = renderHook(() => useLibraryAvailability(['a', 'b']));
    expect(result.current.status).toBe('checking');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(check).toHaveBeenCalledTimes(1);
    expect(check.mock.calls[0][0]).toEqual(['a', 'b']);
    expect(result.current.byObsId.a.available).toBe(true);
    expect(result.current.byObsId.b.available).toBe(false);
  });

  it('is skipped for anonymous visitors', async () => {
    hoisted.useAuthMock.mockReturnValue({ isAuthenticated: false, isLoading: false });
    const { result } = renderHook(() => useLibraryAvailability(['a']));
    await new Promise((r) => setTimeout(r, 0));
    expect(check).not.toHaveBeenCalled();
    expect(result.current.status).toBe('skipped');
  });

  it('is skipped entirely in CE', async () => {
    hoisted.ceMode.value = true;
    const { result } = renderHook(() => useLibraryAvailability(['a']));
    await new Promise((r) => setTimeout(r, 0));
    expect(check).not.toHaveBeenCalled();
    expect(result.current.status).toBe('skipped');
  });

  it('reports unavailable (not silent) when the check fails', async () => {
    check.mockRejectedValue(new Error('500'));
    const { result } = renderHook(() => useLibraryAvailability(['a']));
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(result.current.byObsId).toEqual({});
  });

  it('serves repeat ids from the session cache and only asks for new ones', async () => {
    check.mockResolvedValue({ results: { a: { available: true, dataIds: ['1'] } } });
    const { result, rerender } = renderHook(({ ids }) => useLibraryAvailability(ids), {
      initialProps: { ids: ['a'] },
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    check.mockResolvedValue({ results: {} });
    rerender({ ids: ['a', 'b'] });
    await waitFor(() => expect(result.current.byObsId.b).toBeDefined());
    expect(check).toHaveBeenCalledTimes(2);
    expect(check.mock.calls[1][0]).toEqual(['b']);
    expect(result.current.byObsId.a.available).toBe(true);
  });

  it('re-checks when a tracked import completes', async () => {
    check.mockResolvedValue({ results: { a: { available: false, dataIds: [] } } });
    const { result, rerender } = renderHook(() => useLibraryAvailability(['a']));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.byObsId.a.available).toBe(false);

    check.mockResolvedValue({ results: { a: { available: true, dataIds: ['1'] } } });
    hoisted.jobs = [{ jobId: 'j1', obsId: 'a', percent: 100, status: 'complete' }];
    rerender();
    await waitFor(() => expect(result.current.byObsId.a.available).toBe(true));
    expect(check).toHaveBeenCalledTimes(2);
  });
});

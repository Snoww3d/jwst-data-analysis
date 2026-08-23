import { useEffect, useMemo, useState } from 'react';
import { jwstDataService } from '../../../services';
import type { DataAvailabilityItem } from '../../../types/JwstDataTypes';
import { CE_MODE } from '../../../config/ce';
import { useAuth } from '../../../context/useAuth';
import { useActiveImportsContext } from '../../../context/useActiveImportsContext';

export type AvailabilityStatus =
  /** Not applicable: CE build or anonymous visitor — no library to check. */
  | 'skipped'
  | 'checking'
  | 'ready'
  /** The check failed; rows may be in the library but we cannot tell. */
  | 'unavailable';

export interface LibraryAvailability {
  status: AvailabilityStatus;
  /** Keyed by MAST obs_id. Partial while checking; empty while skipped. */
  byObsId: Record<string, DataAvailabilityItem>;
}

// Session cache: an obs_id's library status rarely changes while the tab is
// open, and Back/Forward through earlier searches should not re-ask.
const sessionCache = new Map<string, DataAvailabilityItem>();

/** Test hook: forget every cached availability entry. */
export function clearAvailabilityCache(): void {
  sessionCache.clear();
}

const NOT_IN_LIBRARY: DataAvailabilityItem = { available: false, dataIds: [] };

interface FetchResult {
  /** `${idsKey}|${refreshGen}` this result answers. */
  key: string;
  status: 'ready' | 'unavailable';
}

/**
 * "In Library" status for a result set, via POST /api/jwstdata/check-availability.
 *
 * - Skipped entirely in CE and for anonymous visitors (no library to check).
 * - One batched call per result set (the service chunks internally).
 * - Session cache by obs_id; only uncached ids are sent.
 * - Failure → `status: 'unavailable'`, so the UI can say so instead of
 *   silently rendering Import for observations that are already imported.
 * - Re-checks when the shared ActiveImportsContext reports a completed job
 *   (an import just landed — its row should flip to "In Library").
 *
 * Extracted from MastSearch.tsx (MAST Search v2 Phase 3).
 */
export function useLibraryAvailability(obsIds: string[]): LibraryAvailability {
  const { isAuthenticated } = useAuth();
  const { jobs } = useActiveImportsContext();
  const enabled = !CE_MODE && isAuthenticated;

  // Stable identity for the id list so work happens per result SET.
  const idsKey = obsIds.join('\n');
  const ids = useMemo(() => (idsKey ? idsKey.split('\n') : []), [idsKey]);

  // A job reaching `complete` means an import just landed: forget what we
  // knew about the current result set and ask again. Each completed jobId
  // counts once (jobs drop out of the list a moment after completing).
  const [seen, setSeen] = useState<{ jobIds: Set<string>; gen: number }>(() => ({
    jobIds: new Set(),
    gen: 0,
  }));
  const newlyCompleted = jobs.filter((j) => j.status === 'complete' && !seen.jobIds.has(j.jobId));
  if (newlyCompleted.length > 0) {
    for (const id of ids) sessionCache.delete(id);
    setSeen({
      jobIds: new Set([...seen.jobIds, ...newlyCompleted.map((j) => j.jobId)]),
      gen: seen.gen + 1,
    });
  }

  const key = `${idsKey}|${seen.gen}`;
  const [fetched, setFetched] = useState<FetchResult | null>(null);

  // What the cache already answers, and what still needs asking. Recomputed
  // every render on purpose (cheap, ≤ page-cap ids): a completed import
  // empties the cache for these ids and a completed fetch refills it, and
  // both must be picked up even though `ids` is unchanged.
  const fromCache: Record<string, DataAvailabilityItem> = {};
  const missing: string[] = [];
  for (const id of ids) {
    const hit = sessionCache.get(id);
    if (hit) fromCache[id] = hit;
    else missing.push(id);
  }
  const missingKey = missing.join('\n');

  useEffect(() => {
    if (!enabled || !missingKey) return;
    // Already asked for exactly this set and it failed — don't hammer the
    // endpoint; the next result set (or import completion) tries again.
    if (fetched?.key === key && fetched.status === 'unavailable') return;
    const toAsk = missingKey.split('\n');
    const controller = new AbortController();
    jwstDataService
      .checkDataAvailability(toAsk, controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return;
        for (const id of toAsk) sessionCache.set(id, res.results[id] ?? NOT_IN_LIBRARY);
        setFetched({ key, status: 'ready' });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setFetched({ key, status: 'unavailable' });
      });
    return () => controller.abort();
  }, [enabled, key, missingKey, fetched]);

  if (!enabled) return { status: 'skipped', byObsId: {} };
  if (missing.length === 0) return { status: 'ready', byObsId: fromCache };
  const status: AvailabilityStatus =
    fetched?.key === key && fetched.status === 'unavailable' ? 'unavailable' : 'checking';
  return { status, byObsId: fromCache };
}

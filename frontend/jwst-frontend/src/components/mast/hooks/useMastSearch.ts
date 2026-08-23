import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  MastObservationResult,
  MastSearchResponse,
  MastSearchType,
} from '../../../types/MastTypes';
import { mastService, ApiError } from '../../../services';
import type { ParsedQuery } from '../../../utils/searchQueryParser';
import type { MastCriteria } from '../../../utils/mastCriteria';

export const SEARCH_TIMEOUT_MS = 120_000; // 2 minutes
/** Server row cap assumed when the response predates Phase 0's `page_size`. */
export const DEFAULT_PAGE_SIZE = 500;
/** How many past result sets Back/Forward can restore without re-querying. */
const HISTORY_CACHE_MAX = 20;

export const SEARCH_TYPE_FOR_KIND: Record<ParsedQuery['kind'], MastSearchType> = {
  target: 'target',
  coords: 'coordinates',
  obsId: 'observation',
  program: 'program',
};

/** One completed MAST search, as the page consumes it. */
export interface SearchOutcome {
  /** Raw CAOM rows (snake_case — see MastTypes.ts). */
  rows: MastObservationResult[];
  count: number;
  /** The server hit its row cap; more observations exist than `rows` holds. */
  truncated: boolean;
  /** The server's row cap for this query. */
  pageSize: number;
  searchType: MastSearchType;
  /** Epoch ms when the response arrived. */
  ranAt: number;
  /** The parsed query; null for a facet-only search. */
  query: ParsedQuery | null;
  /**
   * True when the results were restricted to calibration level 3. Observation
   * ID searches always return every level, so this is false for them — the
   * raw-data fallback offer keys off it.
   */
  level3Only: boolean;
  /**
   * Facet-only search: the server bounded it to its default release window
   * because neither a date facet nor `daysBack` was sent.
   */
  defaultWindowApplied: boolean;
}

export type SearchStatus = 'idle' | 'loading' | 'done' | 'error';

export interface RunOptions {
  /** Cone radius in degrees; only target / coords searches read it. */
  radius: number;
  /** Include calibration levels 1–2 alongside 3. Ignored when `calibLevels` is given. */
  includeRaw: boolean;
  /** Exact calibration levels (filter rail); overrides `includeRaw`. */
  calibLevels?: number[];
  /**
   * Whitelisted CAOM criteria from the filter rail. Target / coordinate
   * searches send them alongside the position; a facet-only run (parsed ===
   * null) IS them. Observation-ID and program lookups ignore them.
   */
  filters?: MastCriteria;
  /** Facet-only runs: explicit release window in days (absent → server default). */
  daysBack?: number;
  /**
   * Identity of the search for the history cache (the search-defining URL
   * params). A run whose key is already cached restores that outcome
   * synchronously and does not query. Omit to always query.
   */
  historyKey?: string;
}

export interface UseMastSearchResult {
  status: SearchStatus;
  outcome: SearchOutcome | null;
  error: string | null;
  /** Run a parsed query, or — with `parsed === null` — a facet-only search. */
  run: (parsed: ParsedQuery | null, opts: RunOptions) => Promise<void>;
  /** Abort the in-flight search, if any; leaves the last outcome in place. */
  abort: () => void;
  /** Abort and forget the last outcome (the URL no longer describes a search). */
  reset: () => void;
}

// Module-level so it survives navigating away from /search and Back: the
// component remounts but the user's earlier result sets are still here.
const historyCache = new Map<string, SearchOutcome>();

/** Test hook: forget every cached result set. */
export function clearSearchHistoryCache(): void {
  historyCache.clear();
}

function remember(key: string, outcome: SearchOutcome): void {
  historyCache.delete(key);
  historyCache.set(key, outcome);
  if (historyCache.size > HISTORY_CACHE_MAX) {
    const oldest = historyCache.keys().next().value;
    if (oldest !== undefined) historyCache.delete(oldest);
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error && err.name === 'AbortError') {
    return 'Search timed out. MAST queries can take a while for large search areas. Try a smaller radius or more specific search terms.';
  }
  if (ApiError.isApiError(err)) {
    if (err.status === 503) {
      return 'The processing engine is currently unavailable. Please wait a moment and try again — the service may still be starting up.';
    }
    if (err.status === 504) {
      return 'Search timed out. Try a smaller search radius or more specific search terms.';
    }
    return err.message;
  }
  return err instanceof Error ? err.message : 'Search failed';
}

function calibLevelsFor(opts: RunOptions): number[] {
  return opts.calibLevels ?? (opts.includeRaw ? [1, 2, 3] : [3]);
}

function query(
  parsed: ParsedQuery | null,
  opts: RunOptions,
  signal: AbortSignal
): Promise<MastSearchResponse> {
  const calibLevel = calibLevelsFor(opts);
  if (parsed === null) {
    return mastService.searchByFacets(
      { filters: opts.filters, calibLevel, daysBack: opts.daysBack },
      signal
    );
  }
  switch (parsed.kind) {
    case 'target':
      return mastService.searchByTarget(
        {
          targetName: parsed.name.trim(),
          radius: opts.radius,
          calibLevel,
          filters: opts.filters,
        },
        signal
      );
    case 'coords':
      return mastService.searchByCoordinates(
        { ra: parsed.ra, dec: parsed.dec, radius: opts.radius, calibLevel, filters: opts.filters },
        signal
      );
    case 'obsId':
      // Observation ID searches show all calibration levels by default
      return mastService.searchByObservation({ obsId: parsed.obsId.trim() }, signal);
    case 'program':
      return mastService.searchByProgram(
        { programId: parsed.programId.trim(), calibLevel },
        signal
      );
  }
}

/**
 * Runs a parsed MAST search against the four existing endpoints, with the
 * 120 s timeout, a stale-run guard (only the newest run may touch state)
 * and a history cache keyed on the search-defining URL params.
 *
 * Extracted from MastSearch.tsx (MAST Search v2 Phase 3).
 */
export function useMastSearch(): UseMastSearchResult {
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    if (!controllerRef.current) return;
    // Bumping the sequence makes the aborted run stale, so its AbortError is
    // dropped instead of surfacing as a "timed out" message.
    seqRef.current++;
    controllerRef.current.abort();
    controllerRef.current = null;
    setStatus((s) => (s === 'loading' ? 'idle' : s));
  }, []);

  // Abort whatever is in flight on unmount, so a slow MAST query cannot set
  // state on a component that is gone.
  useEffect(() => abort, [abort]);

  const reset = useCallback(() => {
    abort();
    setOutcome(null);
    setError(null);
    setStatus('idle');
  }, [abort]);

  const run = useCallback(async (parsed: ParsedQuery | null, opts: RunOptions) => {
    // Back/Forward can start a new search while the last one is in flight;
    // only the newest run may touch results/error state.
    const seq = ++seqRef.current;
    const isCurrent = () => seq === seqRef.current;

    const cached = opts.historyKey ? historyCache.get(opts.historyKey) : undefined;
    if (cached) {
      controllerRef.current?.abort();
      setOutcome(cached);
      setError(null);
      setStatus('done');
      return;
    }

    setStatus('loading');
    setError(null);
    setOutcome(null);

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

    try {
      const data = await query(parsed, opts, controller.signal);
      clearTimeout(timeoutId);
      if (!isCurrent()) return;

      const rows = Array.isArray(data.results) ? data.results : [];
      const pageSize = data.page_size ?? DEFAULT_PAGE_SIZE;
      const levels = calibLevelsFor(opts);
      const next: SearchOutcome = {
        rows,
        count: rows.length,
        truncated: data.truncated ?? rows.length >= pageSize,
        pageSize,
        searchType: parsed === null ? 'facets' : SEARCH_TYPE_FOR_KIND[parsed.kind],
        ranAt: Date.now(),
        query: parsed,
        level3Only: parsed?.kind !== 'obsId' && levels.length === 1 && levels[0] === 3,
        defaultWindowApplied: parsed === null && data.default_window_applied === true,
      };
      if (opts.historyKey) remember(opts.historyKey, next);
      setOutcome(next);
      setStatus('done');
    } catch (err) {
      clearTimeout(timeoutId);
      if (!isCurrent()) return;
      setError(describeError(err));
      setStatus('error');
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, []);

  return { status, outcome, error, run, abort, reset };
}

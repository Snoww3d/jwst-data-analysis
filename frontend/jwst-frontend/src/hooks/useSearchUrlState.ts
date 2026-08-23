import { useCallback, useMemo } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';

/**
 * URL-backed state for the MAST search page (`/search`).
 *
 * The URL is the source of truth for a search: submitting PUSHES a new
 * history entry so Back/Forward walk through earlier searches, and a page
 * opened with `?q=` runs that search on mount. MastSearch watches `navKey`
 * (changes on every navigation, including a re-submit of identical params)
 * to decide when to run; `useMastSearch` keeps a per-search-string history
 * cache so a navigation that only changes `sort`/`view` (or Back to a
 * search already run) restores results without re-querying.
 *
 * Params:
 *   q      raw query text (parsed client-side into target/coords/obs/program)
 *   r      search radius in degrees (omitted when it equals the default)
 *   calib  `all` → calibration levels 1–3; absent → level 3 only
 *   sort   `col:dir` for the results table (Phase 3); absent → default sort
 *   view   `split` for table + sky map (Phase 5 wires it); absent → table
 *
 * Reserved for later phases — documented here so nobody reuses the names:
 *   inst, filt, dpt, from, to, exp   filter rail (Phase 4): instrument,
 *                                     filters, dataproduct_type, date range
 *                                     (MJD), exposure range
 *   page                              results page (stays local state for now)
 */

export const DEFAULT_SEARCH_RADIUS = '0.2';

export type SearchView = 'table' | 'split';

export interface SearchUrlState {
  q: string;
  r: string;
  /** True when `calib=all` (levels 1–3); false → level 3 only. */
  allLevels: boolean;
  /** Results sort as `col:dir` (e.g. `t_exptime:asc`). Absent → the table default. */
  sort?: string;
  /** Absent → `table`. */
  view?: SearchView;
}

export interface SearchUrlStateApi extends SearchUrlState {
  /** Changes on every navigation to this page, even with identical params. */
  navKey: string;
  /**
   * Only the params that define WHICH search runs (`q`, `r`, `calib`), as a
   * stable string — the key for useMastSearch's history cache. Sort/view
   * changes leave it untouched.
   */
  searchKey: string;
  /** Push a history entry (submit). */
  push: (next: SearchUrlState) => void;
  /** Replace the current entry (adjusting the search in place). */
  replace: (next: SearchUrlState) => void;
  /** Replace just the sort (keeps every other param). */
  setSort: (sort: string | undefined) => void;
}

const SORT_RE = /^[a-z_]+:(asc|desc)$/;

/** Serialise only the non-default values so shared URLs stay short. */
export function toSearchParams(state: SearchUrlState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.q.trim()) params.set('q', state.q.trim());
  if (state.r && state.r !== DEFAULT_SEARCH_RADIUS) params.set('r', state.r);
  if (state.allLevels) params.set('calib', 'all');
  if (state.sort && SORT_RE.test(state.sort)) params.set('sort', state.sort);
  if (state.view === 'split') params.set('view', 'split');
  return params;
}

/** A hand-edited `?r=` that is not a usable radius falls back to the default. */
function sanitizeRadius(raw: string | null): string {
  if (!raw) return DEFAULT_SEARCH_RADIUS;
  const r = parseFloat(raw);
  return Number.isFinite(r) && r >= 0.01 && r <= 10 ? raw : DEFAULT_SEARCH_RADIUS;
}

export function fromSearchParams(params: URLSearchParams): SearchUrlState {
  const state: SearchUrlState = {
    q: params.get('q') ?? '',
    r: sanitizeRadius(params.get('r')),
    allLevels: params.get('calib') === 'all',
  };
  const sort = params.get('sort');
  if (sort && SORT_RE.test(sort)) state.sort = sort;
  if (params.get('view') === 'split') state.view = 'split';
  return state;
}

/** The search-defining subset of the state, serialised. */
export function toSearchKey(state: SearchUrlState): string {
  return toSearchParams({ q: state.q, r: state.r, allLevels: state.allLevels }).toString();
}

export function useSearchUrlState(): SearchUrlStateApi {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();

  const state = useMemo(() => fromSearchParams(searchParams), [searchParams]);
  const searchKey = useMemo(() => toSearchKey(state), [state]);

  const push = useCallback(
    (next: SearchUrlState) => setSearchParams(toSearchParams(next)),
    [setSearchParams]
  );
  const replace = useCallback(
    (next: SearchUrlState) => setSearchParams(toSearchParams(next), { replace: true }),
    [setSearchParams]
  );
  const setSort = useCallback(
    (sort: string | undefined) => {
      setSearchParams(toSearchParams({ ...fromSearchParams(searchParams), sort }), {
        replace: true,
      });
    },
    [searchParams, setSearchParams]
  );

  return { ...state, navKey: location.key, searchKey, push, replace, setSort };
}

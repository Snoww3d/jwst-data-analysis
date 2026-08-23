import { useCallback, useMemo } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import {
  CALIB_LEVELS,
  EMPTY_FACETS,
  calibLevelsToParam,
  facetsToUrl,
  hasNarrowingFacets,
  urlToFacets,
  type FacetState,
} from '../utils/mastCriteria';
import { parseRegionParam, serializeRegion, type SkyRegion } from '../utils/skyGeometry';

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
 *   calib  `all` → calibration levels 1–3; a comma list (`2,3`) for a
 *          subset; absent → level 3 only
 *   sort   `col:dir` for the results table (Phase 3); absent → default sort
 *   view   `split` for table + sky map (Phase 5); absent → table
 *   inst, mode, filt, dpt, from, to, exp, intent, days
 *          the filter rail (Phase 4) — see utils/mastCriteria.ts. A URL
 *          with facets and no `q` is a facet-only search and auto-runs.
 *   region a drawn sky region (Phase 6): `circle:ra,dec,r` or
 *          `poly:ra,dec;ra,dec;…` — replaces `q` as the search subject; a
 *          deep link with `region` auto-runs. Invalid values are ignored.
 *
 * Reserved — documented here so nobody reuses the name:
 *   page   results page (stays local state for now)
 */

export const DEFAULT_SEARCH_RADIUS = '0.2';

export type SearchView = 'table' | 'split';

export interface SearchUrlState {
  q: string;
  r: string;
  /**
   * True when every calibration level (1–3) is included; false → a subset,
   * level 3 by default. Derived from `facets.calibLevels` when `facets` is
   * given; on its own (`facets` absent) it means levels 1–3 vs level 3.
   */
  allLevels: boolean;
  /** Results sort as `col:dir` (e.g. `t_exptime:asc`). Absent → the table default. */
  sort?: string;
  /** Absent → `table`. */
  view?: SearchView;
  /**
   * Filter-rail facets (Phase 4). Always present when read from the URL;
   * callers that build a state by hand may omit it (→ no facets).
   */
  facets?: FacetState;
  /** Drawn sky region (Phase 6); the search subject when there is no `q`. */
  region?: SkyRegion;
}

export interface SearchUrlStateApi extends SearchUrlState {
  /** Changes on every navigation to this page, even with identical params. */
  navKey: string;
  /**
   * Only the params that define WHICH search runs (`q`, `r`, `calib`, the
   * facets), as a stable string — the key for useMastSearch's history
   * cache. Sort/view changes leave it untouched.
   */
  searchKey: string;
  /** True when the URL describes a search: a query, or facets without one. */
  hasSearch: boolean;
  /** Push a history entry (submit). */
  push: (next: SearchUrlState) => void;
  /** Replace the current entry (adjusting the search in place). */
  replace: (next: SearchUrlState) => void;
  /** Replace just the sort (keeps every other param). */
  setSort: (sort: string | undefined) => void;
  /** Replace just the view (keeps every other param). */
  setView: (view: SearchView) => void;
}

const SORT_RE = /^[a-z_]+:(asc|desc)$/;

/** The facets a hand-built state implies: `allLevels` alone means levels 1–3. */
function effectiveFacets(state: SearchUrlState): FacetState {
  if (state.facets) return state.facets;
  return state.allLevels ? { ...EMPTY_FACETS, calibLevels: [...CALIB_LEVELS] } : EMPTY_FACETS;
}

/** Serialise only the non-default values so shared URLs stay short. */
export function toSearchParams(state: SearchUrlState): URLSearchParams {
  const params = new URLSearchParams();
  const q = state.q.trim();
  if (q) params.set('q', q);
  if (state.r && state.r !== DEFAULT_SEARCH_RADIUS) params.set('r', state.r);
  const facets = effectiveFacets(state);
  // `days` only means something for a facet-only search; a query has its
  // own bounds (a position), so the window is not carried along.
  facetsToUrl(q ? { ...facets, daysBack: undefined } : facets, params);
  if (state.region) params.set('region', serializeRegion(state.region));
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
  const facets = urlToFacets(params);
  const state: SearchUrlState = {
    q: params.get('q') ?? '',
    r: sanitizeRadius(params.get('r')),
    allLevels: calibLevelsToParam(facets.calibLevels) === 'all',
    facets,
  };
  const region = parseRegionParam(params.get('region'));
  if (region) state.region = region;
  const sort = params.get('sort');
  if (sort && SORT_RE.test(sort)) state.sort = sort;
  if (params.get('view') === 'split') state.view = 'split';
  return state;
}

/** The search-defining subset of the state, serialised. */
export function toSearchKey(state: SearchUrlState): string {
  return toSearchParams({
    q: state.q,
    r: state.r,
    allLevels: state.allLevels,
    facets: state.facets,
    region: state.region,
  }).toString();
}

/** A query, a drawn region, or narrowing facets — any is a search worth running. */
export function hasSearchIn(state: SearchUrlState): boolean {
  return (
    Boolean(state.q.trim()) || Boolean(state.region) || hasNarrowingFacets(effectiveFacets(state))
  );
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

  const setView = useCallback(
    (view: SearchView) => {
      setSearchParams(toSearchParams({ ...fromSearchParams(searchParams), view }), {
        replace: true,
      });
    },
    [searchParams, setSearchParams]
  );

  return {
    ...state,
    navKey: location.key,
    searchKey,
    hasSearch: hasSearchIn(state),
    push,
    replace,
    setSort,
    setView,
  };
}

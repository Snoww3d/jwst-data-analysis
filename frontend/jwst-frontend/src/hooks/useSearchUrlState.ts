import { useCallback, useMemo } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';

/**
 * URL-backed state for the MAST search page (`/search`).
 *
 * The URL is the source of truth for a search: submitting PUSHES a new
 * history entry so Back/Forward walk through earlier searches, and a page
 * opened with `?q=` runs that search on mount. MastSearch watches `navKey`
 * (changes on every navigation, including a re-submit of identical params)
 * to decide when to run.
 *
 * Params implemented in Phase 2:
 *   q      raw query text (parsed client-side into target/coords/obs/program)
 *   r      search radius in degrees (omitted when it equals the default)
 *   calib  `all` → calibration levels 1–3; absent → level 3 only
 *
 * Reserved for later phases — documented here so nobody reuses the names:
 *   inst, filt, dpt, from, to, exp   filter rail (Phase 4): instrument,
 *                                     filters, dataproduct_type, date range
 *                                     (MJD), exposure range
 *   sort, page                        results v2 (Phase 3): sort key+dir, page
 *   view                              table|split (Phase 5 sky map)
 */

export const DEFAULT_SEARCH_RADIUS = '0.2';

export interface SearchUrlState {
  q: string;
  r: string;
  /** True when `calib=all` (levels 1–3); false → level 3 only. */
  allLevels: boolean;
}

export interface SearchUrlStateApi extends SearchUrlState {
  /** Changes on every navigation to this page, even with identical params. */
  navKey: string;
  /** Push a history entry (submit). */
  push: (next: SearchUrlState) => void;
  /** Replace the current entry (adjusting the search in place). */
  replace: (next: SearchUrlState) => void;
}

/** Serialise only the non-default values so shared URLs stay short. */
export function toSearchParams(state: SearchUrlState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.q.trim()) params.set('q', state.q.trim());
  if (state.r && state.r !== DEFAULT_SEARCH_RADIUS) params.set('r', state.r);
  if (state.allLevels) params.set('calib', 'all');
  return params;
}

/** A hand-edited `?r=` that is not a usable radius falls back to the default. */
function sanitizeRadius(raw: string | null): string {
  if (!raw) return DEFAULT_SEARCH_RADIUS;
  const r = parseFloat(raw);
  return Number.isFinite(r) && r >= 0.01 && r <= 10 ? raw : DEFAULT_SEARCH_RADIUS;
}

export function fromSearchParams(params: URLSearchParams): SearchUrlState {
  return {
    q: params.get('q') ?? '',
    r: sanitizeRadius(params.get('r')),
    allLevels: params.get('calib') === 'all',
  };
}

export function useSearchUrlState(): SearchUrlStateApi {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();

  const state = useMemo(() => fromSearchParams(searchParams), [searchParams]);

  const push = useCallback(
    (next: SearchUrlState) => setSearchParams(toSearchParams(next)),
    [setSearchParams]
  );
  const replace = useCallback(
    (next: SearchUrlState) => setSearchParams(toSearchParams(next), { replace: true }),
    [setSearchParams]
  );

  return { ...state, navKey: location.key, push, replace };
}

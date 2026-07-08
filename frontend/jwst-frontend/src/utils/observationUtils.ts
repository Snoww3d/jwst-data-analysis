import type { MastObservationResult } from '../types/MastTypes';
import type { DataAvailabilityResponse } from '../types/JwstDataTypes';
import type { ObservationInput } from '../types/DiscoveryTypes';

/**
 * Convert MAST observations into the ObservationInput format
 * expected by the recipe engine.
 */
export function toObservationInputs(observations: MastObservationResult[]): ObservationInput[] {
  const inputs: ObservationInput[] = [];
  for (const obs of observations) {
    if (!obs.filters || !obs.instrument_name) continue;
    inputs.push({
      filter: obs.filters,
      instrument: obs.instrument_name,
      observationId: obs.obs_id,
      tObsRelease: obs.t_obs_release,
      dataProductType: obs.dataproduct_type,
      sRa: obs.s_ra,
      sDec: obs.s_dec,
    });
  }
  return inputs;
}

/**
 * The obs_ids backing a set of recipe filters: EVERY observation matching a
 * recipe filter. A filter counts as covered when ANY of its observations has
 * library data — coverage must not depend on MAST row order (the library
 * may hold a filter from obs set B while obs set A happens to sort first).
 * This matches GuidedCreate's needsDownload semantics, which also considers
 * all matching observations. TargetDetail's grouped availability map and
 * RecipeCard's standalone self-check both use this — they MUST agree on
 * what "this recipe" means, so the selection lives in one place.
 */
export function observationIdsForFilters(
  observations: MastObservationResult[],
  filters: string[]
): string[] {
  const filterSet = new Set(filters.map((f) => f.toUpperCase()));
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const obs of observations) {
    const filterKey = obs.filters?.toUpperCase();
    if (filterKey && filterSet.has(filterKey) && obs.obs_id && !seen.has(obs.obs_id)) {
      seen.add(obs.obs_id);
      ids.push(obs.obs_id);
    }
  }
  return ids;
}

/**
 * Build filter → dataIds coverage from a check-availability response over
 * ANY matching observation (entry filter first, observation filter as the
 * nullish fallback — GuidedCreate semantics). A filter is covered when any
 * observation provides data for it, regardless of MAST row order.
 */
export function buildFilterCoverage(
  results: DataAvailabilityResponse['results'],
  observations: MastObservationResult[]
): Map<string, string[]> {
  const coverage = new Map<string, string[]>();
  for (const [obsId, item] of Object.entries(results)) {
    if (!item?.available || !item.dataIds || item.dataIds.length === 0) continue;
    const obs = observations.find((o) => o.obs_id === obsId);
    const filterName = item.filter ?? obs?.filters;
    if (!filterName) continue;
    const key = filterName.toUpperCase();
    // first covering observation wins; any one of them renders the filter
    if (!coverage.has(key)) {
      coverage.set(key, item.dataIds);
    }
  }
  return coverage;
}

/**
 * The two observation sets GuidedCreate needs for a recipe:
 * - availabilityObs: EVERY observation matching the recipe's filters — the
 *   library may hold a filter under any of them (Cas A regression), so
 *   availability/coverage must query them all.
 * - downloadObs: restricted to the recipe's own observationIds when the
 *   engine specified them — downloads honor the engine's vetted selection.
 * Splitting these is the fix for "card says Ready, create says Not in
 * library": readiness and coverage are filter-wise, downloads are not.
 */
export function selectRecipeObservations(
  observations: MastObservationResult[],
  recipeFilters: string[],
  recipeObservationIds: string[] | null | undefined
): { availabilityObs: MastObservationResult[]; downloadObs: MastObservationResult[] } {
  const filterSet = new Set(recipeFilters.map((f) => f.toUpperCase()));
  const availabilityObs = observations.filter(
    (o) => o.filters && filterSet.has(o.filters.toUpperCase())
  );
  const idSet =
    recipeObservationIds && recipeObservationIds.length > 0 ? new Set(recipeObservationIds) : null;
  const downloadObs = idSet
    ? availabilityObs.filter((o) => (o.obs_id ? idSet.has(o.obs_id) : true))
    : availabilityObs;
  return { availabilityObs, downloadObs };
}

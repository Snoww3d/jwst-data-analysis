import type { MastObservationResult } from '../types/MastTypes';
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
 * The obs_ids backing a set of recipe filters: first observation per filter.
 * TargetDetail's grouped availability map and RecipeCard's standalone
 * self-check both use this — they MUST agree on what "this recipe" means,
 * so the selection lives in one place.
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
    if (filterKey && filterSet.has(filterKey) && !seen.has(filterKey) && obs.obs_id) {
      seen.add(filterKey);
      ids.push(obs.obs_id);
    }
  }
  return ids;
}

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

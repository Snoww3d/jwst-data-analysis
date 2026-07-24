/**
 * Calibration Recipes types (#1709).
 *
 * IMPORTANT wire contract: recipe payloads travel VERBATIM snake_case — the
 * field names inside `stages`/`step_overrides` are meaningful jwst pipeline
 * identifiers (e.g. `bkg_subtract`, `maximum_cores`), not DTO field names.
 * Do NOT run camelCase conversion over these objects. Only the small
 * non-recipe payloads (capabilities, run start) are camelCase.
 */

export type ScalarOverride = string | number | boolean | null;

export interface StepOverrides {
  [step: string]: { [param: string]: ScalarOverride | ScalarOverride[] };
}

export interface RecipeStage {
  name: 'detector1' | 'image2' | 'image3' | 'coron3';
  enabled: boolean;
  step_overrides: StepOverrides;
}

export interface MastQueryInput {
  type: 'mast_query';
  proposal_id: string;
  observation: string | null;
  filters: string[];
  calib_level: 1 | 2;
  product_suffixes: string[];
}

export interface LibraryProductsInput {
  type: 'library_products';
  product_suffixes: string[];
}

export interface CalibrationRecipe {
  id: string;
  schema_version: number;
  name: string;
  description: string;
  instrument: 'nircam' | 'niriss' | 'miri';
  mode: 'imaging' | 'coronagraphy';
  source: 'seed' | 'imported' | 'user';
  is_public: boolean;
  provenance: { notebook_name: string | null; jwst_version_authored: string | null };
  input_source: MastQueryInput | LibraryProductsInput;
  stages: RecipeStage[];
  association: { rule: string; product_name: string };
  output_suffixes: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** camelCase payloads (non-recipe wire). */
export interface CalibrationCapabilities {
  calibrationEnabled: boolean;
  jwstVersion: string | null;
}

export interface StartRunRequest {
  recipeId: string;
  /** Storage keys of library `_cal` files; empty for MAST-driven recipes. */
  inputs: string[];
  runOverrides: StepOverrides;
}

export interface StartRunResponse {
  jobId: string;
}

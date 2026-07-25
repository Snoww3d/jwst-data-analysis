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
  /**
   * Library item ids to calibrate; empty for MAST-driven recipes.
   * Ids rather than storage keys (#1751): the library DTO never publishes
   * `filePath`, so the client cannot know a key — the engine resolves it from
   * a document the caller is allowed to read.
   */
  inputDataIds: string[];
  runOverrides: StepOverrides;
  /** Per-run stage toggles, applied to the recipe snapshot server-side. */
  enabledStages: Record<string, boolean>;
}

export interface StartRunResponse {
  jobId: string;
}

/** Job envelope from GET /api/jobs/{id} (camelCase; `request` verbatim). */
export interface CalibrationJobStage {
  name: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
}

export interface CalibrationJobOutput {
  storageKey: string;
  suffix: string;
  sizeBytes: number;
}

export interface CalibrationJob {
  jobId: string;
  type: string;
  status: 'queued' | 'downloading' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  cancelRequested: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  progress: {
    stages: CalibrationJobStage[];
    currentStage: string | null;
    message: string | null;
    downloadPct: number | null;
  };
  logTail: string[];
  result: {
    outputs: CalibrationJobOutput[];
    jwstVersion: string | null;
    crdsContext: string | null;
  } | null;
  error: string | null;
  request: CalibrationJobRequest;
}

/**
 * What a run was started with. The engine embeds a full recipe snapshot per job
 * for reproducibility, and applies the per-run stage toggles to that snapshot
 * BEFORE storing it — so `recipeSnapshot.stages[].enabled` is what actually
 * ran, not the recipe's defaults. That makes the snapshot enough to rebuild the
 * form for a re-run (#1735).
 *
 * Keys inside `request` stay snake_case on the wire: it is opaque, job-type
 * owned data that the jobs facade deliberately does not camelCase.
 */
export interface CalibrationJobRequest {
  recipe_id?: string;
  recipe_snapshot?: CalibrationRecipe;
  inputs?: { path: string; role: string }[];
  /**
   * Library ids the run was started from (#1751). Recorded alongside `inputs`
   * because a storage key cannot be turned back into a library item, so a
   * re-run has nothing to re-select without these.
   */
  input_data_ids?: string[];
  run_overrides?: StepOverrides;
}

export const TERMINAL_JOB_STATUSES = ['succeeded', 'failed', 'cancelled'] as const;

/**
 * Calibration API client (#1709) — talks DIRECTLY to the Python engine
 * (ENGINE_BASE_URL), not the .NET gateway, per ADR-0001. JWT injection and
 * refresh come from the shared ApiClient plumbing.
 */

import { ENGINE_BASE_URL } from '../config/engine';
import { ApiClient } from './apiClient';
import type {
  CalibrationCapabilities,
  CalibrationJob,
  CalibrationRecipe,
  StartRunRequest,
  StartRunResponse,
} from '../types/CalibrationTypes';

const engineClient = new ApiClient(ENGINE_BASE_URL);

export async function getCapabilities(): Promise<CalibrationCapabilities> {
  return engineClient.get<CalibrationCapabilities>('/api/calibration/capabilities');
}

export async function listRecipes(): Promise<CalibrationRecipe[]> {
  const response = await engineClient.get<{ recipes: CalibrationRecipe[] }>(
    '/api/calibration/recipes'
  );
  return response.recipes;
}

export async function getRecipe(recipeId: string): Promise<CalibrationRecipe> {
  return engineClient.get<CalibrationRecipe>(
    `/api/calibration/recipes/${encodeURIComponent(recipeId)}`
  );
}

export async function startRun(request: StartRunRequest): Promise<StartRunResponse> {
  return engineClient.post<StartRunResponse>('/api/calibration/runs', request);
}

/** Generic jobs API lives on the engine too (poll from the run UI, PR 8). */
export async function getJob<T = Record<string, unknown>>(jobId: string): Promise<T> {
  return engineClient.get<T>(`/api/jobs/${encodeURIComponent(jobId)}`);
}

/**
 * Recent calibration runs for the signed-in user, newest first.
 * The engine has exposed this since the jobs slice landed; nothing consumed it
 * until the run-history page (#1734), which is why a run could be orphaned.
 */
/**
 * The caller's runs, or every user's when `allUsers` is set (#1807).
 *
 * Opt-in by design: the engine rejects `all=true` from a non-admin rather than
 * quietly returning their own list, so this must only be set from a control
 * that is itself admin-gated.
 */
export async function listJobs(limit = 50, allUsers = false): Promise<CalibrationJob[]> {
  const query = `limit=${limit}${allUsers ? '&all=true' : ''}`;
  const response = await engineClient.get<{ jobs: CalibrationJob[] }>(`/api/jobs?${query}`);
  return response.jobs;
}

export async function cancelJob(jobId: string): Promise<{ cancelRequested: boolean }> {
  return engineClient.post<{ cancelRequested: boolean }>(
    `/api/jobs/${encodeURIComponent(jobId)}/cancel`,
    {}
  );
}

/**
 * Fetch an on-the-fly PNG preview of a succeeded job's output as a Blob.
 * The engine renders it from the output's storage key server-side (no library
 * record is created), so the caller only needs the jobId and output index.
 * Returned as a Blob (via the auth-aware ApiClient) so the UI can build an
 * object URL — the endpoint requires a bearer token, so a bare <img src> 401s.
 */
export async function getJobOutputPreview(jobId: string, index: number): Promise<Blob> {
  return engineClient.getBlob(`/api/jobs/${encodeURIComponent(jobId)}/outputs/${index}/preview`);
}

export interface SaveOutputResponse {
  /** Mongo id of the library record — what the viewer and compositor are keyed by. */
  dataId: string;
  /** False when this output was already saved; the same record is returned. */
  created: boolean;
}

/**
 * Persist a calibration output as a library record.
 * Saving is explicit (not automatic) so the tweak-and-regenerate loop doesn't
 * flood /library with throwaway versions. Idempotent per output.
 */
export async function saveJobOutputToLibrary(
  jobId: string,
  index: number
): Promise<SaveOutputResponse> {
  return engineClient.post<SaveOutputResponse>(
    `/api/jobs/${encodeURIComponent(jobId)}/outputs/${index}/save`,
    {}
  );
}

/** Raw output bytes (FITS or catalog) as a Blob — the endpoint needs a bearer token. */
export async function downloadJobOutput(jobId: string, index: number): Promise<Blob> {
  return engineClient.getBlob(`/api/jobs/${encodeURIComponent(jobId)}/outputs/${index}/download`);
}

export interface ImportRecipeResponse {
  recipe: CalibrationRecipe;
  warnings: string[];
}

export async function importNotebook(
  filename: string,
  notebookText: string
): Promise<ImportRecipeResponse> {
  return engineClient.post<ImportRecipeResponse>('/api/calibration/recipes/import', {
    filename,
    notebook: notebookText,
  });
}

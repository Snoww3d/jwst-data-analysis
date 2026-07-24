/**
 * Calibration API client (#1709) — talks DIRECTLY to the Python engine
 * (ENGINE_BASE_URL), not the .NET gateway, per ADR-0001. JWT injection and
 * refresh come from the shared ApiClient plumbing.
 */

import { ENGINE_BASE_URL } from '../config/engine';
import { ApiClient } from './apiClient';
import type {
  CalibrationCapabilities,
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

export async function cancelJob(jobId: string): Promise<{ cancelRequested: boolean }> {
  return engineClient.post<{ cancelRequested: boolean }>(
    `/api/jobs/${encodeURIComponent(jobId)}/cancel`,
    {}
  );
}

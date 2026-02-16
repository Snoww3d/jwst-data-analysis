/**
 * Service for checking backend and processing engine health status.
 *
 * Calls the /api/health endpoint which returns component-level health details
 * including the processing engine connectivity check.
 */

import { API_BASE_URL } from '../config/api';

export interface HealthCheckEntry {
  name: string;
  status: string;
  description: string | null;
}

export interface HealthStatus {
  status: string;
  checks: HealthCheckEntry[];
}

/**
 * Check the health of the backend and its dependencies (processing engine).
 * Does NOT use apiClient to avoid auth requirements — /api/health is unauthenticated.
 *
 * @returns Health status with component details, or null if the backend itself is unreachable
 */
export async function checkHealth(): Promise<HealthStatus | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return { status: 'Unhealthy', checks: [] };
    }
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Check if the processing engine is healthy.
 * Returns true if the backend reports the processing engine as healthy.
 */
export async function isProcessingEngineHealthy(): Promise<boolean> {
  const health = await checkHealth();
  if (!health) return false;

  const engineCheck = health.checks.find((c) => c.name === 'processing_engine');
  return engineCheck?.status === 'Healthy';
}

export const healthService = {
  checkHealth,
  isProcessingEngineHealthy,
};

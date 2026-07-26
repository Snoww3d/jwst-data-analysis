import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * ENGINE_BASE_URL is read from import.meta.env at module evaluation, so each
 * case stubs the env and re-imports the module fresh.
 *
 * The empty-string case is load-bearing: the dockerised dev frontend sets
 * VITE_ENGINE_URL= so calibration/jobs calls go to the page's own origin and
 * are forwarded by the Vite dev-server proxy. That is what lets the same
 * bundle work at localhost:3000 and at http://<lan-ip>:3000 from a phone. If
 * an empty value ever fell back to the localhost default, the phone would
 * silently lose calibration again.
 */
describe('ENGINE_BASE_URL', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('falls back to the local engine when VITE_ENGINE_URL is unset', async () => {
    vi.stubEnv('VITE_ENGINE_URL', undefined);
    vi.resetModules();
    expect((await import('./engine')).ENGINE_BASE_URL).toBe('http://localhost:8000');
  });

  it('stays same-origin for an explicit empty string rather than falling back', async () => {
    vi.stubEnv('VITE_ENGINE_URL', '');
    vi.resetModules();
    expect((await import('./engine')).ENGINE_BASE_URL).toBe('');
  });

  it('uses an explicit absolute URL as-is', async () => {
    vi.stubEnv('VITE_ENGINE_URL', 'http://192.168.86.31:8000');
    vi.resetModules();
    expect((await import('./engine')).ENGINE_BASE_URL).toBe('http://192.168.86.31:8000');
  });
});

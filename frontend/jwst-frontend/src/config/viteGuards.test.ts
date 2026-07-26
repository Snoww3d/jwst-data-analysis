import { describe, it, expect } from 'vitest';
import { jobsRouteCollisionError } from './viteGuards';

/**
 * The dev server proxies /api/jobs to the Python engine while the .NET gateway
 * serves /api/jobs on identical paths. The guard must fire only for the one
 * combination that actually misroutes, because a false positive refuses to
 * start the dev server.
 */
describe('jobsRouteCollisionError', () => {
  it('flags an empty engine URL combined with an empty (same-origin) API URL', () => {
    expect(jobsRouteCollisionError({ VITE_ENGINE_URL: '', VITE_API_URL: '' })).toMatch(/misrouted/);
  });

  it('allows an unset API URL — api.ts falls back to an absolute localhost URL', () => {
    expect(jobsRouteCollisionError({ VITE_ENGINE_URL: '' })).toBeNull();
  });

  it('allows the normal docker dev combination', () => {
    expect(
      jobsRouteCollisionError({ VITE_ENGINE_URL: '', VITE_API_URL: 'http://localhost:5001' })
    ).toBeNull();
  });

  it('allows a same-origin API URL when the engine proxy is not in use', () => {
    // Production/CE shape: nginx serves the API same-origin and there is no proxy.
    expect(jobsRouteCollisionError({ VITE_API_URL: '' })).toBeNull();
  });

  it('allows an absolute engine URL with a same-origin API URL', () => {
    expect(
      jobsRouteCollisionError({ VITE_ENGINE_URL: 'http://localhost:8000', VITE_API_URL: '' })
    ).toBeNull();
  });
});

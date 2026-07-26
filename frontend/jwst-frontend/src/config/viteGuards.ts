/**
 * Dev-server config guards, kept in their own module so they are pure and
 * unit-testable (vite.config.ts itself is awkward to import from a test).
 */

/**
 * The dev server proxies /api/jobs to the Python engine, but the .NET gateway
 * serves /api/jobs on *exactly* the same paths (JobsController) for
 * composite/mosaic jobs. There is no path-level way to tell them apart.
 *
 * That is only safe because the frontend addresses the .NET backend with an
 * absolute URL, so those calls leave the page origin and never reach the dev
 * server. Note that an *unset* VITE_API_URL is still safe: src/config/api.ts
 * falls back to the absolute http://localhost:5001. The single dangerous value
 * is the empty string — the same-origin shape staging/CE builds use — which
 * would silently retarget job polling at the engine and 404.
 *
 * Returns an error message, or null when the combination is safe.
 */
export function jobsRouteCollisionError(env: {
  VITE_ENGINE_URL?: string;
  VITE_API_URL?: string;
}): string | null {
  const engineProxyActive = env.VITE_ENGINE_URL === '';
  const backendSameOrigin = env.VITE_API_URL === '';
  if (engineProxyActive && backendSameOrigin) {
    return (
      'VITE_ENGINE_URL is empty (engine proxy active) but VITE_API_URL is also empty ' +
      '(same-origin). The dev server proxies /api/jobs to the Python engine, and the ' +
      '.NET gateway serves /api/jobs on identical paths, so the backend must be ' +
      'addressed by an absolute URL or its job polling would be misrouted to the ' +
      'engine. Set VITE_API_URL (e.g. http://localhost:5001) or unset it to use the ' +
      'default.'
    );
  }
  return null;
}

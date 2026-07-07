/**
 * Community Edition build flag (CE plan Phase 3 — progressive capability gate).
 *
 * `VITE_CE_MODE=true` at build time produces the public, anonymous, read-only
 * CE bundle: no auth surfaces, no library mutations, no job-queue/SignalR
 * paths, pointed at the Python backend (`VITE_API_URL`). The flag is a
 * build-time constant, so Vite dead-code-eliminates the gated branches from
 * the CE bundle.
 *
 * UI gating here is a UX concern only — the security boundary is the
 * backend's CE_MODE deny-by-default route mounting (the corresponding
 * server-side flag), which 404s everything outside the read allowlist.
 *
 * Capabilities intentionally OFF in CE v1 (flip on as the Python tier grows):
 * accounts, MAST imports, uploads, delete/archive mutations, composite/mosaic
 * wizard pages, async jobs + SignalR progress, semantic search (/search).
 */
export const CE_MODE = import.meta.env.VITE_CE_MODE === 'true';

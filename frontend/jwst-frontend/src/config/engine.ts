/**
 * Processing-engine base URL (direct frontend → Python engine calls).
 *
 * Calibration (and the generic jobs API) are served by the Python engine,
 * not the .NET gateway — the frontend calls the engine directly per
 * ADR-0001. Override via VITE_ENGINE_URL; defaults to the local engine.
 */
// !== undefined (not ||): an explicit empty string is a deliberate
// same-origin/proxy opt-in and must not fall back to localhost.
const envEngineUrl = import.meta.env.VITE_ENGINE_URL;
export const ENGINE_BASE_URL = envEngineUrl !== undefined ? envEngineUrl : 'http://localhost:8000';

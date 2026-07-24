# Calibration Pipeline Flow

How **Calibration Recipes** (#1709) run the official STScI `jwst` calibration
pipeline inside the processing engine, driven by declarative recipes and
delivered as tracked jobs.

> **Architecture note (ADR 0001):** Calibration is **Python-native** and
> advances the single-backend migration. It builds the ADR-0001 Phase-3 jobs
> slice (a Mongo-persisted job store) and a minimal Phase-1 JWT-validation
> dependency in the engine. The frontend calls the engine **directly**
> (`VITE_ENGINE_URL`), not through the `.NET` gateway. Progress is delivered by
> **HTTP polling** of `GET /api/jobs/{id}` — a deliberate divergence from the
> ADR's sketched `/ws/jobs` WebSocket (calibration jobs change state on the
> order of seconds, and the frontend job hooks already poll).

## Concept

A **CalibrationRecipe** is pure data: a versioned document describing which
pipeline stages to run (`detector1` → `image2` → `image3`) and which step
parameters to override. Recipes never contain executable code — the "pure
data, never code" invariant is enforced by a scalar-only validator on
`step_overrides` and, at execution time, by an allowlist of step/parameter
names. See [domain model](domain-model.md) for the schema.

Three curated **seed recipes** (NIRCam/NIRISS/MIRI imaging) are hand-derived
from the STScI JWPipeNB notebooks and loaded idempotently at engine startup.
Users can also **import** JWPipeNB notebooks: the importer statically parses the
`.ipynb` with Python's `ast` module and never executes it.

## Full run (uncal → i2d)

```
Frontend (/calibrate/:recipeId)                 Engine                      External
        │                                          │                            │
        │  POST /api/calibration/runs              │                            │
        │  {recipeId, inputs, runOverrides,        │                            │
        │   enabledStages}                         │                            │
        ├─────────────────────────────────────────►                            │
        │           (require_user; validate        │                            │
        │            overrides per enabled stage)  │                            │
        │                                          │  create job (Mongo)        │
        │  202 {jobId}                             │  asyncio.create_task       │
        ◄─────────────────────────────────────────┤                            │
        │                                          │                            │
        │  poll GET /api/jobs/{jobId} (1.5s)       │  ── downloading ──►  MAST  │
        ├─────────────────────────────────────────►  per-file, progress %      │
        │  {status, progress.stages, logTail}      │                            │
        ◄─────────────────────────────────────────┤  ── running ──             │
        │        stage checklist + log tail        │  semaphore (1 slot)        │
        │                                          │  detector1 → image2 →      │
        │                                          │  image3, per-stage timeout │
        │                                          │  stpipe logs ─► CRDS ◄─────┤
        │  {status: succeeded,                      │  outputs → StorageProvider │
        │   result.outputs: [_i2d]}                │  (calibration/<job_id>/)   │
        ◄─────────────────────────────────────────┤                            │
```

- **Stage-3 fast path**: when `inputs` are library `_cal` keys and only
  `image3` is enabled, the download and detector1/image2 stages are skipped —
  the pipeline re-combines already-calibrated exposures into a fresh mosaic in
  minutes. This is what the library **Reprocess** action triggers.
- **File handoff** between stages is by suffix inside the per-job workdir:
  `_uncal` → `_rate` → `_cal` → `_i2d`.
- **Cancellation** is cooperative at stage boundaries (the monolithic
  `Pipeline.call` is not killed mid-flight in v1). A **timeout** likewise cannot
  kill the worker thread, so the concurrency permit is deliberately *retained*
  to keep `MAX_CONCURRENT_CALIBRATIONS` bounding memory (killable-subprocess
  isolation is tracked as a follow-up).

## Security posture

- **Recipes are data**: `step_overrides` values are scalars or flat scalar
  lists only (schema validator). At execution the executor allowlists step
  *names* per stage and rejects `override_<ref>` reference-file params,
  `pre_hooks`/`post_hooks` (code-reference vectors), run-control params
  (`output_dir`, `suffix`, …), and path-like values.
- **Notebook import** is static `ast` parsing — the notebook is read, never
  executed. Non-literal stage overrides reject the import; imported recipes are
  private (`is_public=False`), owned by the uploader.
- **Recipe visibility** follows the documented data model: seeds and public
  recipes are visible to all; user recipes are private until shared. Reads are
  visibility-filtered; unknown/inaccessible ids return 404 (anti-enumeration).
- **Full-mode only**: the calibration router and job store never mount in
  Community Edition (deny-by-default; regression-guarded by
  `tests/test_ce_mode_mounting.py`).

## Feature gates

- **Build-time**: the Docker `INSTALL_CALIBRATION` arg controls whether the
  ~2GB `jwst` layer is installed (CE builds pass `false`).
- **Run-time**: `CALIBRATION_ENABLED` × `jwst` importability. When off, run
  endpoints return 501 and recipes stay browsable. The frontend gates the
  gallery/nav and the library Reprocess action on
  `GET /api/calibration/capabilities`.

## Key files

- `processing-engine/app/calibration/` — models, validation, store, seeds,
  executor, importer, flags, routes
- `processing-engine/app/jobs/` — Mongo job store, runner, `/api/jobs` routes
- `processing-engine/app/auth/deps.py` — JWT validation dependency
- `frontend/jwst-frontend/src/pages/CalibrationGallery.tsx`, `CalibrateRun.tsx`
- `frontend/jwst-frontend/src/services/calibrationService.ts`,
  `src/hooks/useCalibrationJob.ts`

## Related

- [Domain Model](domain-model.md) · [Job Queue & SignalR](job-queue-signalr.md)
  (the .NET job pattern this diverges from) · [Security Model](security-model.md)
  · [ADR 0001](adr/0001-collapse-to-python-single-backend.md)

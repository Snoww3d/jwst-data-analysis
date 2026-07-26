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
        │  {recipeId, inputDataIds, runOverrides,  │                            │
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
        │  {status, progress.stages, logTail,      │                            │
        │   progress.currentFile/totalFiles,       │                            │
        │   updatedAt}                             │                            │
        ◄─────────────────────────────────────────┤  ── running ──             │
        │        stage checklist + log tail        │  semaphore (1 slot)        │
        │                                          │  detector1 → image2 →      │
        │                                          │  image3, per-stage timeout │
        │                                          │  stpipe logs ─► CRDS ◄─────┤
        │  {status: succeeded,                      │  outputs → StorageProvider │
        │   result.outputs: [_i2d]}                │  (calibration/<job_id>/)   │
        ◄─────────────────────────────────────────┤                            │
```

- **Inputs are library ids, never paths** (#1751): the client sends
  `inputDataIds` and the engine resolves each to a storage key from a document
  the caller may read — their own, public, or shared-with-them items; an Admin
  may use any. An id that is unknown, invisible, archived, duplicated, or has
  no file behind it fails the whole request with 422 rather than being dropped,
  since a run on a silently shorter input list yields a wrong mosaic. Raw
  storage keys in `inputs` are **rejected** (422): nothing authorizes a key
  per-record, so accepting one would let any user calibrate another's file.
- **Runs are level transitions** (#1756): the library labels every file
  L1 (`_uncal`) / L2a (`_rate`) / L2b (`_cal`) / L3 (`_i2d`), and a run raises a
  file from one level to the next — Detector1 L1→L2a, Image2 L2a→L2b, Image3
  L2b→L3. The library action is named for that outcome ("Process to L3",
  "Combine to L3"), and the stages to enable are derived from the start and
  target levels rather than chosen by hand. Files already at L3 are finished
  and offer no action.
- **Stage-3 fast path**: when the resolved inputs are library `_cal` files and
  only `image3` is enabled, the download and detector1/image2 stages are skipped —
  the pipeline re-combines already-calibrated exposures into a fresh mosaic in
  minutes. This is the L2b -> L3 path, reached from the library's "Combine to L3" action.
- **File handoff** between stages is by suffix inside the per-job workdir:
  `_uncal` → `_rate` → `_cal` → `_i2d`.
- **Cancellation** is cooperative at stage boundaries (the monolithic
  `Pipeline.call` is not killed mid-flight in v1). A **timeout** likewise cannot
  kill the worker thread, so the concurrency permit is deliberately *retained*
  to keep `MAX_CONCURRENT_CALIBRATIONS` bounding memory (killable-subprocess
  isolation is tracked as a follow-up). Store writes are scoped to *active*
  jobs, so the orphaned thread can't keep stamping a document that already
  reads "failed".
- **Ended by the engine, not the user**: an engine restart cancels the job's
  asyncio task. Because `cancel_requested` is False in that case, the run is
  recorded as `failed` with `error: "interrupted by service restart"` — the
  same status/error startup reconciliation applies — instead of a bare
  `cancelled`, which is reserved for runs the user actually stopped.
- **Liveness while a stage is slow**: `progress.currentFile`/`totalFiles` name
  the input being processed (null `currentFile` for combining stages, which
  consume every input at once), buffered log lines flush on a ~30s timer as
  well as at the batch size, and every engine write stamps `updatedAt`.

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

# Calibration Recipes (#1709) — Implementation Plan

## Context

Deep review of all 17 STScI [jwst-pipeline-notebooks](https://github.com/spacetelescope/jwst-pipeline-notebooks) showed they are template-generated: stage execution is a serializable dict-of-dicts passed to `XxxPipeline.call(input, steps=...)`, with boolean stage gates and a structured MAST query. The user wants these importable/usable in-app **without ever executing user Python**. Approach (CEO review, mode A, decisions logged in #1709): recipes as **pure declarative data**, executed by our trusted engine, plus a curated gallery. Approved expansions: Stage-3-only fast path, library "Reprocess with latest pipeline", per-stage progress + log tail, coronagraphy as phase 2. Deferred: sharing (#1710), cubes (#1711), spectroscopy (#1712), full disk quotas (#1713).

**Architecture decision (user-approved):** Python-native. Build the ADR-0001 Phase-3 jobs slice in the engine (Mongo-persisted job store, HTTP polling — a deliberate divergence from ADR-0001's sketched `/ws/jobs` WebSocket; document it in the ADR note), plus a minimal Python JWT-validation dependency for .NET-issued tokens (verified: HS256, `JWT_SECRET_KEY` from `docker/.env`, issuer `JwstDataAnalysis`, audience `JwstDataAnalysisClient` — `backend/JwstDataAnalysis.API/Services/JwtTokenService.cs:41-63`). No .NET changes; frontend calls the engine directly for calibration.

Naming: **Calibration** everywhere (`/api/calibration`, `app/calibration/`) — the word "Recipe" alone is taken by discovery composite suggestions (`app/discovery/models.py:50`).

## Schemas (engine `app/calibration/models.py`; Mongo snake_case — new-collection divergence from PascalCase .NET docs, documented)

**CalibrationRecipe** (collection `calibration_recipes`):
`id` (slug for seeds / ObjectId-str), `schema_version=1`, `name`, `description`, `instrument` (nircam|niriss|miri), `mode` (imaging | coronagraphy [phase 2]), `source` (seed|imported|user), `provenance` {notebook_name?, jwst_version_authored?}, `input_source` (discriminated union: `mast_query` {proposal_id, observation?, filters, calib_level 1|2, product_suffixes} | `library_products` {product_suffixes}), `input_roles` [{role: science|psf_ref|background, required, min_count}] (v1: science only; future-proofs Coron3), `stages` ordered [{name: detector1|image2|image3 (+coron3 reserved), enabled, step_overrides: {step: {param: Scalar|list[Scalar]}}}] — validator **rejects non-scalar values** (the "pure data, never code" guarantee), `association` {rule: allowlist ["DMS_Level3_Base"], product_name (sanitized)}, `output_suffixes` (e.g. ["_i2d"]), `created_by?`, timestamps.

**Job** (collection `jobs` — the generic ADR-0001 jobs slice; calibration is first consumer; no separate runs collection):
`job_id` (uuid4), `type="calibration"`, `user_id`, `status` (queued|downloading|running|succeeded|failed|cancelled), `cancel_requested`, timestamps, `request` {recipe_id, **recipe_snapshot** (embedded full copy — runs stay reproducible), inputs [{path/product_id, role}], run_overrides}, `progress` {stages [{name, status, started_at, finished_at}], current_stage, message, download_pct}, `log_tail` (capped ~200), `result` {outputs [{storage_key, suffix, size_bytes}], log_key, jwst_version, crds_context} | null, `error?`.

Wire = camelCase via facade mapping (pattern: `app/discovery/api_routes.py`); internal = snake_case.

## PR sequence (1 task = 1 PR, branch prefix `feature/calibration-*`, Red-Green TDD, self-review rounds until clean)

Master plan file `docs/plans/features/1709-calibration-recipes.md` (issue-number naming convention) created in PR 1 (satisfies require-plan-file hook for all subsequent branches).

Cloud-refinement corrections folded in: PRs 1–2 fill the **existing mounted scaffolds** (`app/auth/routes.py`, `app/jobs/routes.py` — already mounted full-mode-only, excluded from CE); the engine reuses the **existing `CORS_ALLOWED_ORIGINS`** compose var (defaults already include :3000/:5173); casing via `app/db/casing.py` helpers, never hand-rolled.

**PR 1 — feat: Python JWT validation dependency (S, ~250 LOC)**
`app/auth/deps.py`: `require_user`/`optional_user` FastAPI deps (PyJWT, HS256, `JWT_SECRET_KEY`, iss/aud above; extract `sub`, `role`). Add `pyjwt` to requirements; add `JWT_SECRET_KEY` to `jwst-processing` env in `docker/docker-compose.yml`. **Empirically decode a live token from the running backend before asserting claim names** (.NET outbound claim mapping). Tests: mint tokens in-test; 401 matrix (expired/wrong iss/aud/key/malformed).

**PR 2 — feat: Mongo job store + generic `/api/jobs` + engine CORS (M, ~550 LOC)**
`app/jobs/store.py` (first write-capable motor repo), `models.py`, `runner.py` (`asyncio.create_task` wrapper; modeled on `app/mast/download_tracker.py` but Mongo-backed; atomic `$set`/`$push` only). Routes: `GET /api/jobs/{id}`, `GET /api/jobs`, `POST /api/jobs/{id}/cancel` — auth from PR 1, ownership enforced, camelCase facade. Startup reconciliation: interrupted jobs → failed ("interrupted by service restart"); **file follow-up issue for resume-on-restart**. **[eng review P1] Add `CORSMiddleware` to `main.py`** with env-configured origins (`CORS_ALLOWED_ORIGINS`, default `http://localhost:3000`) — engine has none today; direct frontend→engine calls would fail preflight. Tests: store/runner unit (pattern `tests/test_download_tracker.py`), ownership, CORS headers, reconciliation.

**PR 3 — feat: CalibrationRecipe schema, seeds, CRUD (M, ~700 LOC)**
`app/calibration/models.py` + `validation.py` (scalar-only enforcement, allowlists, sanitization); `seeds/*.json` — 3 recipes hand-derived from the NIRCam/NIRISS/MIRI imaging notebooks; idempotent startup seeder. Routes: `GET /api/calibration/recipes`(+one) anonymous; `POST/PUT/DELETE` auth'd; seeds immutable. **Full-mode-only: not in CE allowlist; extend `tests/test_ce_mode_mounting.py`.** Tests: validation matrix (non-scalar rejected, unknown stages/rules), seed round-trip, casing contract test (`tests/contract/`).

**PR 4 — feat: calibration deps, feature flag, CRDS wiring (M effort, small diff)**
`requirements-calibration.txt` (exact `jwst` pin; pulls stpipe/stcal/crds). Dockerfile `ARG INSTALL_CALIBRATION=true` gating the pip layer (CE builds false; mirrors `Dockerfile.mast` split); wheels expected on py3.12-slim — if any sdist compiles, builder stage with build-essential. Runtime `CALIBRATION_ENABLED` env (via `app/config.py` helpers): off → run endpoints 501, recipes still browsable; expose `calibrationEnabled` via `GET /api/calibration/capabilities`. Compose: `CRDS_PATH=/app/data/crds` named volume, `CRDS_SERVER_URL=https://jwst-crds.stsci.edu`, `MAX_CONCURRENT_CALIBRATIONS=1`. Same-container (not separate worker) for v1 — executor touches only job store + storage provider, so extracting a worker later is mechanical. Tests: flag on/off mounting, 501.

**PR 5 — feat: Stage-3 fast-path executor (L, ~900 LOC — core PR)**
`app/calibration/executor.py`: resolve library `_cal` inputs via `app/storage/helpers.py:resolve_fits_path`; `asn_from_list` with allowlisted rule; `Image3Pipeline.call(asn, steps=merged, output_dir=workdir)` in `asyncio.to_thread` under a dedicated plain `threading.BoundedSemaphore(MAX_CONCURRENT_CALIBRATIONS)` — no 429 admission stage (jobs queue in Mongo by design, unlike composite's synchronous request-scoped renders; leave composite's `_render_slots` untouched); outputs → StorageProvider under `calibration/<job_id>/`; full log → storage. **Real per-stage progress**: scoped `logging.Handler` on stpipe/jwst loggers; parse step boundaries → job stage checklist + log_tail (best-effort; job completes even if parsing misses). `POST /api/calibration/runs` {recipeId, inputs, runOverrides} → {jobId}. Disk-floor guard (basic; full quotas = #1713). GAIADR3 tweakreg needs network — surface in docs/UI copy. Tests: monkeypatched `Image3Pipeline.call` fake (emits real-looking log lines, writes dummy `_i2d`) covering sequencing/override merge/cancel/semaphore/log-parse/output registration; log-parser units against captured real stpipe log fixtures. **Opt-in real smoke**: `pytest -m calibration_smoke`, small NIRCam subarray `_cal` pair (minutes) — also live-verifies PR 4 CRDS wiring.

**PR 6 — feat: full uncal pipeline + MAST input source (M/L, ~600 LOC)**
Detector1 → Image2 → Image3 with `enabled` toggles + file handoff; `mast_query` input via `app/mast/mast_service.py` (calib_level filter, progress callback → "downloading" phase). `CALIBRATION_TIMEOUT_S` (generous, relaxed-threshold posture). Workdir cleanup, keep declared `output_suffixes` only. Tests: mocked multi-stage toggle matrix, download-failure, mid-run cancel; smoke: one small subarray `_uncal` full-through.

**PR 7 — feat: gallery UI + calibration service (M, ~600 LOC)**
`src/config/engine.ts` (`VITE_ENGINE_URL`, style of `config/api.ts`); `services/calibrationService.ts` (second `ApiClient` instance bound to the engine base URL **[eng review P2]**; camelCase DTOs), `types/CalibrationTypes.ts`, lazy `/calibrate` route in `App.tsx` under `SharedLayout`, gallery cloning `RecipeCard` + `RecipeGroups` (`pages/TargetDetail.tsx:291`). Nav gated `!CE_MODE` + `calibrationEnabled`. Vitest: service mapping, gallery render.

**PR 8 — feat: run-config + live progress UI (L, ~900 LOC — main net-new UI)**
`/calibrate/:recipeId`: stage toggles + curated per-step param editor (from seed params; advanced free-form section; analog: GuidedCreate adjustment panels), input picker (library `_cal` files | recipe's MAST query), Run. Progress: new lean `useCalibrationJob` polling hook against engine `/api/jobs/{id}` (do NOT retrofit `useJobProgress` — it's SignalR/MAST-coupled; reuse its `appendBufferedMessage` buffer helper), real-stage checklist (à la `ProcessStep`), `LogPanel` tail, cancel. `ui/Steps`/`Modal`/`toast`; per-component CSS; no inline styles. Vitest: override-editor state, progress render from fixtures. E2E: `e2e/calibrate.spec.ts` (mocked engine API, modeled on `guided-create.spec.ts`).

**PR 9 — feat: notebook importer (M/L, ~700 LOC)**
`app/calibration/importer.py`: `ast`-based static parse of JWPipeNB cells (config assignments, `do<stage>` booleans, `dict[step][param] = scalar`, MAST params). **Fail closed**: allowlist exact template AST shapes; any funcdef/non-allowlisted call/import/non-literal RHS → reject naming cell+line and supported template vintage. Never executes anything. `POST /api/calibration/recipes/import` (auth, size cap). Frontend import button + error display. Tests: 3 cloned notebooks as golden fixtures (parse ≈ hand-written seeds — cross-check); adversarial fixtures (exec/eval/os/loops/f-strings) all rejected; corrupt ipynb.

**PR 10 — feat: library Reprocess action + docs sweep (S, ~300 LOC)**
`DataCard.tsx` `onReprocess` prop (gated `!CE_MODE` + capability) → navigate `/calibrate/:defaultRecipeId` pre-filled with that observation's `_cal` products (stage-3 path). Final docs/diagram pass.

## Parallelization

Sequential through PR 5 (each depends on the previous). After PR 5: **Lane A** PR 6 (engine) ∥ **Lane B** PR 7→8 (frontend). PR 9 after PR 3 technically, but schedule after PR 8 (needs UI surface). PR 10 last. Solo-dev default remains sequential; lanes are an option, not a requirement.

## Test plan summary

- Engine: everything below PR 5's pipeline boundary runs on mocked `Pipeline.call` fakes — no long runs in CI. Real `jwst` exercised only by opt-in `-m calibration_smoke` (small subarrays). CE-mode route guard extended. Casing contract tests for new wire shapes.
- Frontend: vitest co-located; one new Playwright spec (`calibrate.spec.ts`) with mocked engine.
- CRITICAL regression guards: `tests/test_ce_mode_mounting.py` (no calibration surface in CE), composite semaphore untouched (calibration gets its own), auth 401 matrix.
- Manual: Docker rebuild (`docker compose up -d --build`), run seeded MIRI-imaging recipe stage-3 path on library data, watch per-stage progress + log tail, verify i2d lands in library storage and renders in compositor.

## Docs to update (across the PRs, final sweep PR 10)

- `docs/architecture/`: new "Calibration pipeline flow" page + index entry; ADR-0001 note (jobs slice landed, calibration first consumer)
- `docs/key-files.md`: `app/calibration/`, `app/jobs/`, `app/auth/deps.py`, `calibrationService.ts`, calibrate pages
- `docs/quick-reference.md`: `/api/calibration/*`, `/api/jobs/*`, new env vars (`CALIBRATION_ENABLED`, `MAX_CONCURRENT_CALIBRATIONS`, `CRDS_*`, `JWT_SECRET_KEY` on engine, `CORS_ALLOWED_ORIGINS`, `VITE_ENGINE_URL`)
- `docs/setup-guide.md`: CRDS volume + first-run reference-file download expectations; build arg
- `docs/development-plan.md` status entry; `docker/.env.example` new vars
- Follow-up issues to file during implementation: job resume-on-restart (PR 2); anything else discovered

## Risks (top)

1. `jwst`+CRDS environment (PR 4/5) — highest uncertainty; smoke test lands same week as deps PR. Exact version pin; snapshot `jwst_version`+`crds_context` per run.
2. Auth claim mapping (PR 1) — de-risked by decoding a live token first.
3. Restart-lost jobs — v1 accepts (reconciliation → failed); follow-up issue.
4. Importer template drift — parser allowlist is data-driven; rejection message names supported vintage.
5. Image size — build-arg keeps CE slim; layer ordering for cache; never `--no-cache`.

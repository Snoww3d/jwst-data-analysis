# Calibration Flow — Data-First Redesign (#1733) — Implementation Plan

## Context

The calibration feature (#1709, PRs #1714–#1731) is functionally complete and reads as a
prototype. A code-level review against `main` @ `39fef18` traced that to an information
architecture that never commits to a job: the feature carries **three half-finished
jobs-to-be-done** presented as one thing.

1. **"Reprocess my data properly"** — the library deep-link (`JwstDataDashboard.tsx:76`).
   The genuinely valuable job, reachable only as a deep link from somewhere else.
2. **"Reproduce an STScI notebook"** — the importer. The most differentiated capability,
   tucked into the gallery header as a secondary button.
3. **"Browse curated recipes"** — a catalog with 3 items, which is what the IA commits to.

A gallery answers *"what recipes exist?"* — a question nobody asks. People arrive holding
data.

**Decision (2026-07-24, user):** lead with **data-first / "reprocess my data"**. Recipes
become *inputs* to a run rather than destinations; the **run** becomes the unit the product
is organized around.

Design review and mockups (built on the existing tokens in `.interface-design/system.md`;
no new visual language proposed):
<https://claude.ai/code/artifact/6164a13a-0486-4011-b1d3-7a3db070b90c>

> The review is code-level. It has **not** been click-tested against the running stack —
> validate the current behaviour live before building on any single claim below.

## The three defects that create the "prototype" feeling

**1. The loop doesn't close.** A successful run lists outputs as storage keys, sizes and a
preview; there is no save, no download, and no route to the compositor
(`CalibrateRun.tsx:400–435`). The #1709 plan's own manual test says *"verify i2d … renders
in compositor"* — that route was never built. The user waits and receives a PNG in a modal.

**2. A 4-hour job whose only handle is React state.** `CALIBRATION_TIMEOUT_S=14400`,
`MAX_CONCURRENT_CALIBRATIONS=1`, and `jobId` lives in `useState`
(`CalibrateRun.tsx:101`). Refresh or navigate away and the run continues server-side where
it can never be seen again. `GET /api/jobs` exists in the engine with **zero** frontend
consumers.

**3. The iteration loop it was justified by is impossible.** All configuration is wrapped in
`{!jobId && …}` (`CalibrateRun.tsx:226`) and unmounts the moment a run starts; `runDisabled`
stays true and nothing resets it. PR #1731's rationale argues calibration is a *"rapid
generate → view → tweak → regenerate loop"* — the page cannot perform it.

## What makes the pivot cheap

Every job already persists a full `recipe_snapshot` at start
(`processing-engine/app/calibration/routes.py:176`). Re-run-with-changes and compare-two-runs
are mostly routing plus a pre-filled review step — the data is already on disk. No schema
change is needed for phases 1–3.

## Sequencing

Phases 1–3 are small, independently shippable, and remove most of the prototype feeling
**without touching the IA**. The data-first pivot is the real redesign and is sequenced last,
once runs are durable enough to iterate on safely.

| Phase | Issue | Scope | Touches IA |
|---|---|---|---|
| 1 | #1730 | Save to library (+ compositor hop, download) | No |
| 2 | #1734 | Job id in URL + run history page | No |
| 3 | #1735 | Re-run with changes | No |
| 4 | #1736 | Stage timeline: validity, estimates, cost warnings | No |
| 5 | #1737 | Curated parameter editor | No |
| 6 | #1738 | Data-first entry flow | **Yes** |

---

## Phase 1 — Close the loop (#1730)

**Why first:** until an output becomes a library record, every other improvement polishes a
dead end.

- Add an endpoint that persists a chosen output as a `JwstData` record
  (`FilePath = calibration/{job_id}/{name}`, thumbnail, `isViewable`) so it gains a real
  Mongo `_id`. The engine already writes the file
  (`app/calibration/executor.py:_persist_outputs`); this is an insert on demand.
- Run page gains **Save to library**, **Download**, and — once saved — **Open in compositor**
  and the full `ImageViewer` (cube navigation, pixel inspection, histograms all "just work"
  off a library `_id`).
- Keep the ephemeral preview as-is. Saving stays explicit so the tweak-and-regenerate loop
  does not flood `/library`, which was the original rationale for not auto-persisting.

**Risk:** first write path from calibration into the library collection. Ownership and
`isViewable` semantics must match what `/library` and the compositor expect — verify against
an existing MAST-imported record rather than assuming.

## Phase 2 — Make runs durable (#1734)

- Move the job id into the route: `/calibrate/runs/:jobId`. Bookmarkable, survives refresh.
- Add `listJobs()` to `calibrationService` and build the run history page at `/calibrate`:
  status, recipe, target, started, duration, output count.
- Explain the queue — a queued run should say it is waiting because the engine runs one
  calibration at a time, not just `queued`.

**Backend:** no changes. `GET /api/jobs` already exists and is unused.

## Phase 3 — Make iteration possible (#1735)

- Keep configuration visible (read-only) while a run is in flight, so the user can see what
  is executing.
- Add **Re-run with changes** on terminal runs: rehydrate the form from the run's
  `recipe_snapshot` and land on review with everything pre-filled.

**Follow-on (out of scope):** the same snapshot makes *compare two runs* natural later.

## Phase 4 — Teach the pipeline (#1736)

Replace the raw `detector1` / `image2` / `image3` toggles with a stage timeline that carries
the data state on its connectors:

```
[Detector1] —uncal→rate— [Image2] —rate→cal— [Image3] —cal→i2d—
```

- Encode validity from the selected inputs: `_cal` files render the first two stages as
  skipped-and-disabled with a one-line reason. Invalid combinations become unreachable
  rather than a runtime failure.
- Show an estimated duration for the selected stage set. Start crude (per-stage constant ×
  file count); improve once Phase 2 supplies real historical durations.
- Warn about network cost: MAST download size for `mast_query` inputs, CRDS reference-file
  download on first run (called out in the #1709 plan, never surfaced).
- Reuse the same component for live progress, replacing the current flat checklist.

## Phase 5 — Remove the memorisation tax (#1737)

- Render curated controls for the parameters a recipe declares — seed recipes already carry
  `step_overrides` with real names and values (`app/calibration/seeds/*.json`).
- Keep the raw step/param/value editor behind an **Advanced** disclosure. This restores the
  #1709 PR-8 intent, where only the free-form half shipped.
- Validate unknown step names client-side instead of at run time. The engine already
  allowlists step and parameter names against the jwst registry during execution; exposing
  that allowlist through an endpoint would give the UI one source of truth for validation
  and autocomplete — worth evaluating as part of this phase.

## Phase 6 — The IA pivot (#1738)

Restructure into a three-step, data-first flow:

1. **Choose data** — library grouped by target with filter chips, search, sizes and
   select-all per group. Replaces the flat checkbox list of raw paths matched by
   `path.includes('_cal')` (`CalibrateRun.tsx:311–330`), which does not survive a library of
   more than ~20 files.
2. **Choose recipe** — offer only recipes valid for the selected data (instrument match, and
   suffix match determining which stages are possible).
3. **Review & run** — stage timeline, parameters, estimate, start.

Recipes move to a managed surface (`/calibrate/recipes`), which is also the natural home for
the notebook importer. The existing Reprocess deep-link should land directly on step 3 with
data and recipe pre-selected — it already knows both.

---

## Testing strategy

- **Per phase, Red-Green TDD**, matching the house convention: vitest co-located with
  components; engine tests via `docker exec jwst-processing python -m pytest`.
- **Phase 1 is the only one with a new write path** — cover ownership, duplicate saves
  (saving the same output twice), and the `isViewable`/thumbnail contract the compositor
  depends on.
- **Phase 2** needs a test that a run survives remount (job id read from the route, not
  state) — that is the actual regression risk.
- **Phase 4 validity rules** are pure functions over (inputs, stages); test them directly
  rather than through the DOM.
- **E2E**: extend `e2e/calibrate.spec.ts` (mocked engine) as phases land; a full real
  calibration is too slow for CI and stays behind `-m calibration_smoke`.

## Risks

1. **Phase 1 write path** — calibration writing into the library collection is new. Highest
   uncertainty in the plan; verify the record shape against an existing imported item.
2. **Phase 6 is a large UI change** on a feature with modest test coverage. Sequenced last
   deliberately so phases 1–3 prove the shape first.
3. **The review is not click-tested.** Confirm current behaviour against the running stack
   before treating any single line reference as settled.
4. **CE mode**: the whole calibration surface is full-mode-only and must stay out of the CE
   allowlist — `tests/test_ce_mode_mounting.py` is the guard for every phase that touches
   routing.

## Docs to update

- `docs/key-files.md` — new run-history / run-detail pages, any new service methods
- `docs/quick-reference.md` — new endpoints from Phase 1
- `docs/architecture/` — calibration flow page, once the IA pivot lands (Phase 6)

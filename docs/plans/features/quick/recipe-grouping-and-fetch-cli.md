# Recipe grouping + admin fetch-recipe CLI

Issues: #1674 (grouping), #1675 (fetch CLI). CEO review: Mode C, proceed with
changes (2026-07-08). Eng review: sound, medium complexity, no unresolved
decisions. Context: post-Phase 5, the CE seed bundle ships 71/93 recipes, so
"Not in library" is a permanent state on target pages.

## PR 1 — #1674 TargetDetail grouping (frontend)

**`src/services/jwstDataService.ts`**
- `checkDataAvailability` chunks requests at 50 observationIds (facade cap),
  merges `results` maps. All callers inherit the fix.

**`src/pages/TargetDetail.tsx`**
- After recipes load: one chunked `checkDataAvailability` over the union of
  all recipes' obsIds → `readyByRecipe: Map<recipeName, boolean> | null`.
- `null` (pending or check failed) → render today's flat list, pills
  suppressed. Never present a renderable page as dead; single reflow only.
- Resolved → two sections: **Ready to render** then **Not in library**
  (reuse `target-detail-section-header`; never render an empty header;
  Recommended badge logic keyed to the first READY recipe).
- Readiness per recipe = same boolean the pill uses
  (`dataReady || isAuthenticated`) — auth users see one section, no change.

**`src/components/discovery/RecipeCard.tsx`**
- Optional `dataReady?: boolean` prop; when provided, skip the per-card
  availability effect (spy-tested); when absent, behavior unchanged
  (regression-tested). Pill suppressed while parent availability is pending.

**Tests**: vitest for chunking, degradation states, grouping branches,
RecipeCard prop contract; update `e2e/target-detail.spec.ts` (mock
check-availability, assert section headers + `.recipe-card` counts).

## PR 2 — #1675 fetch subcommand (engine/scripts)

**`processing-engine/scripts/seed_ce.py`**
- New `fetch` subcommand: `--target` + `--recipe` (exact name; on miss, list
  available recipe names), optional `--max-file-size` (default 6GB) and
  `--dry-run`.
- Resolve recipe via the existing stranger-flow helpers → missing filters →
  MAST product list for those filters (reuse prefetch_discovery selection
  logic: combined L3 mosaic, smallest per filter) → download via MastService
  with disk guards.
- A needed file over the cap: abort BEFORE downloading anything, print file
  sizes and the exact `--max-file-size N` re-run command.
- Post-fetch: estimate preflight at `--fail-threshold` (CE posture); print
  verdict; exit non-zero if still `fail`. Print next-steps checklist:
  .NET scan → `seed-ce.sh gate` → bundle rebuild → `restore-seed.sh`.

**`scripts/fetch-recipe.sh`**: thin wrapper (seed-ce.sh conventions,
featured-list parity check, container exec).

**Tests**: pytest for the missing→download-list diff, cap-abort message,
estimate-verdict exit codes (mocked client, existing fakes pattern).

## Out of scope
Why-unavailable explanations; fetch-all-gaps mode; any in-app admin surface
(CE stays anonymous/read-only); #1676 (pre-existing scan DuplicateKey noise).

## Docs
`scripts/README.md` entry for fetch-recipe.sh. No architecture diagrams.

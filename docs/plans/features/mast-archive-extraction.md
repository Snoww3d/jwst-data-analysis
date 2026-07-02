# MAST → Archive Extraction (Issue #1617)

**Branch:** `feature/mast-archive-extraction` · **CEO review:** Mode C (hold scope), passed 2026-07-01 · **Eng review:** passed 2026-07-01

## Problem

MAST search is a 1559-line panel (`MastSearch.tsx`) toggled inside the library dashboard. The MAST/Library split decision (2026-07-01, Option A): MAST becomes the Discover-side acquisition surface; Library goes local-only. This PR is the extraction/reroute half; #1618 (semantic search fold-in + nav reduction) follows.

## Decisions (from reviews)

- **DECISION-1:** New flat public route **`/archive`** ("Archive search"). Entry points: CTA on Discover home near the search console + library toolbar "Search MAST" button becomes a link to `/archive`.
- **DECISION-2:** Global import indicator = **header pill** in `SharedLayout` (aggregated count + %, click → `/archive`, completion toast linking to Library). Restore-on-load via `GET /api/mast/import/resumable`, authenticated users only.
- Badges use existing anonymous `POST /api/jwstdata/check-availability` (semantic shift: "in library" vs "you imported" — accepted). No backend changes.
- Top-level Search tab **stays** this PR (removed in #1618 to avoid orphaning semantic search).

## Changes

1. `src/pages/ArchivePage.tsx` (+ css) — public page hosting MAST search + `WhatsNewPanel`; standalone loading/error/empty states.
2. Decompose `MastSearch.tsx` → `src/components/mast/`: `MastSearch` (orchestrator), `SearchForm`, `ResultsTable`, `ImportProgress` (+ existing behavior preserved; `mast-search.spec.ts` is the regression net).
3. `importedObsIds` prop → internal fetch via `checkDataAvailability` on result set; anonymous users: results render, import action = "Log in to import", no badge errors.
4. `src/components/layout/ImportProgressPill.tsx` + `src/hooks/useActiveImports.ts` — resumable fetch (auth-gated) + `useJobProgress` subscription per job; multi-job aggregate; hidden/active/complete/error states.
5. `JwstDataDashboard` — remove `showMastSearch`, `MastSearch`/`WhatsNewPanel` rendering, `importedObsIds` computation, `onImportComplete` threading. `DashboardToolbar` — button navigates to `/archive`.
6. `DiscoveryHome` — CTA link to `/archive`.
7. `App.tsx` — add public `archive` route.

## Edge cases

Anonymous `/archive` (login-gated import), zero results, multi-job pill, page-reload job restore, SignalR drop (polling fallback exists), resumable fetch failure (pill hidden).

## Tests

- New unit: SearchForm params, ResultsTable badges/anon gating, ImportProgressPill states, useActiveImports.
- **CRITICAL regression:** import-complete → Library shows new observation without `onImportComplete` (E2E); dashboard renders with props removed.
- E2E updates: `dashboard.spec.ts` (toggle → link), `ux-regression.spec.ts` (locator), `mast-search.spec.ts` / `mast-download.spec.ts` (navigate to `/archive`).

## Docs

`frontend-architecture.md` (route map, `Dashboard --> MastSearch` edge), `mast-import-flow.md` (entry point), `key-files.md`, `quick-reference.md` (routes).

## Out of scope

Semantic fold-in + nav reduction (#1618), MAST search visual redesign, deep-linkable query params, semantic-search tech debt.

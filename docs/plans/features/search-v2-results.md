# MAST Search v2 — Phase 3: Decompose MastSearch + results v2

**Branch:** `feature/search-v2-results` · Parent plan: MAST Search v2 (Phases 0–6). Frontend only.

## Problem

`MastSearch.tsx` is a ~980-line component that owns the search switch, the 120 s abort, the import queue (single / bulk / resume / from-existing), library-availability badges, the resumable-downloads panel, pagination and the raw-data fallback. Nothing in it is reusable by the filter rail (Phase 4) or the sky map (Phase 5), and the results table cannot sort, cannot hide columns, and reports the 500-row server cap as if it were the whole archive.

## Decisions

- **Search is a hook.** `components/mast/hooks/useMastSearch.ts` owns the four-way switch, the 120 s `AbortController`, the stale-run guard, and a **history cache** keyed on the search-relevant URL string (`q`, `r`, `calib`) so Back/Forward and sort/view URL changes restore the last result set without re-querying MAST. `SearchOutcome { rows, count, truncated, pageSize, searchType, ranAt, query, level3Only }`.
- **Wire shape stays snake_case.** Rows are raw CAOM column names consumed by table, footprints (Phase 5) and import; `MastTypes.ts` documents why they are not normalised. `truncated` / `page_size` from Phase 0 are declared on `MastSearchResponse`.
- **Import stays .NET.** `useBulkImport.ts` moves the `MAX_CONCURRENT_IMPORTS = 3` queue, `useJobProgress` / `subscribeToJobProgress` wiring, `registerJob`, resume and import-from-existing out of the component without changing a single `mastService` call. `downloadSource` lives here; its UI is `ImportOptionsPopover.tsx` (non-CE, authenticated).
- **Availability is a hook.** `useLibraryAvailability.ts` skips in CE and when anonymous, makes one batched call per result set, caches by `obs_id` for the session, reports `status: 'unavailable'` on failure (toolbar says so instead of silently rendering Import), and re-checks when the shared `ActiveImportsContext` reports a completed job.
- **Results v2.** `ResultsToolbar.tsx` (count, truncation banner, column picker persisted in `localStorage['mast_columns']`, selection + bulk import, import options, disabled `view` toggle placeholder); `ResultsTable.tsx` rewritten with `<th aria-sort>` sorting (string / number / MJD comparators, nulls last, default `t_obs_release desc`, `sort=col:dir` in the URL), `id`/`data-obs-id` on rows for Phase 5 hover linkage, sticky header, optional columns (`s_ra`, `s_dec`, `proposal_pi`, `t_max`, `obs_collection`, `calib_level`), selection lifted to the page, honest pagination label ("Page 2 of 20 · 500 loaded").
- `utils/timeUtils.ts` — `mjdToDate` / `dateToMjd` (Phase 4 needs the inverse) replace the helper that lived at the top of `ResultsTable.tsx`.
- `MastSearch.tsx` becomes a composer; the resumable-downloads panel and the raw-fallback offer are their own small components.

## Changes

1. `types/MastTypes.ts` — `truncated`, `page_size`, `s_region`; snake_case note.
2. `utils/timeUtils.ts` (+test).
3. `hooks/useSearchUrlState.ts` (+test) — `sort`, `view` implemented; `page` stays local.
4. `components/mast/hooks/useMastSearch.ts`, `useBulkImport.ts`, `useLibraryAvailability.ts` (+tests).
5. `components/mast/resultColumns.ts`, `resultSort.ts` (+tests).
6. `components/mast/ResultsToolbar.tsx`, `ImportOptionsPopover.tsx`, `ResumableDownloadsPanel.tsx`, `RawFallbackOffer.tsx` (+css).
7. `components/mast/ResultsTable.tsx` rewrite (+test ported).
8. `components/mast/MastSearch.tsx` composer (+test ported).
9. `e2e/mast-download.spec.ts` — download-source select now lives behind the import-options popover.

## Tests

Hook: abort, stale-run guard, truncation flag, history-cache hit on Back. Sort comparators incl. MJD and nulls. Column-picker persistence. Availability skipped in CE / anonymous, failure → unavailable. Bulk-import queue concurrency. `timeUtils` round-trip. Existing `MastSearch` / `ResultsTable` tests ported, not weakened.

## Out of scope

Filter rail + `filters` body (Phase 4), sky map and `view=split` (Phase 5), import migration to Python (ADR 0001).

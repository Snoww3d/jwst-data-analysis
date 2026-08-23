# MAST Search v2 — Phase 2: Smart input, URL state, recents

**Branch:** `feature/search-v2-smart-input` · Parent plan: MAST Search v2 (Phases 0–6). Frontend only.

## Problem

The MAST search form asks the user to pick a mode (target / coordinates / observation ID / program ID) with radios before typing, even though the text itself says which mode it is. The Discover box advertises coordinate and program-ID chips (`10h 37m -58°`, `PID 2739`) that navigate to `/target/:name` with no parsing — they do not work. Search state lives only in component state, so a search cannot be shared, bookmarked, or restored with Back. Only target searches are cached.

## Decisions

- **One input, parsed on each keystroke.** `utils/searchQueryParser.ts` → `ParsedQuery` discriminated union (`obsId | program | coords | target`), detection order obs-id → program → coords → target. A live monospace "Interpreted as: …" hint shows the interpretation before the user submits.
- **Radius only when it applies** (target / coords). Calibration toggle stays as a small control near the input. `downloadSource` is an import concern: it leaves the search form and sits next to the Import buttons in the results header until Phase 3 moves it into `ImportOptionsPopover`.
- **URL is the source of truth for a search.** `hooks/useSearchUrlState.ts` reads `q`, `r`, `calib`; submit **pushes** so Back/Forward restore earlier searches; the search runs from the URL (mount with `?q=` auto-runs once). Names `inst, filt, dpt, from, to, exp, sort, page, view` are reserved for Phases 3–4 and documented in the hook, not implemented.
- **Recents** in `localStorage['mast_recent_searches']`, max 10, newest first, deduped on normalised `q + r`. Pure functions in `utils/recentSearches.ts`.
- **Discover console parses too.** A featured-target name still goes to `/target/:name`; anything else goes to `/search?q=<raw>&r=<default>`.
- **Cache all four search modes** the same way target was cached (48 h + SWR). Key prefix bumps to `mast_search_v2:` because Phase 0 changed the cone geometry — old cached results are wrong.
- `MastSearch.tsx` is **not** decomposed here (Phase 3). `handleSearch` keeps its four-way switch; the parsed query is mapped onto the existing `searchType` / field values.

## Changes

1. `utils/searchQueryParser.ts` (+test) — `parseSearchQuery`, `describeParsedQuery`.
2. `utils/coordinateUtils.ts` (+test) — `parseSexagesimal(ra, dec)`.
3. `utils/recentSearches.ts` (+test).
4. `hooks/useSearchUrlState.ts` (+test).
5. `components/mast/SmartSearchInput.tsx` / `.css` (+test) — replaces `SearchForm.tsx` / `.css` / `.test.tsx` (deleted; nothing else imported it).
6. `components/mast/MastSearch.tsx` — wires the smart input, URL state, recents; `ResultsTable.tsx` hosts the download-source select.
7. `components/discovery/SearchConsole.tsx` (+test) — parse on submit; takes the featured-target list.
8. `services/mastService.ts` (+test) — shared cached-search helper, `mast_search_v2:` prefix.

## Tests

Parser table (≥25 cases incl. every Discover chip, negative-dec sexagesimal, RA wrap edge, out-of-range rejects); URL round-trip; SearchConsole navigation per chip; recents dedupe/cap; MastSearch raw-fallback tests ported to the new input.

## Out of scope

Results v2 / `useMastSearch` hook / `ImportOptionsPopover` (Phase 3), filter rail + `filters` body (Phase 4), sky map (Phase 5).

# MAST Search v2 — Phase 1: IA / nav (closes out #1618 fold-in)

**Branch:** `feature/search-v2-nav` · Parent plan: MAST Search v2 (Phases 0–6). Frontend only.

## Problem

Three unrelated things are called "search": the Discover box (in-memory filter of featured targets), the nav "Search" tab (semantic search over the *local* library, non-CE only), and `/archive` (the actual MAST search, with **no nav entry**). Users looking for "search the archive" land on the wrong surface; CE has no Search nav at all even though MAST search works there.

## Decisions

- **MAST search takes the nav "Search" slot** at `/search`, routed in CE and non-CE.
- **Semantic search folds into My Library** (#1618) as a "Search library" tab, `!CE_MODE` only (its API never mounts in CE). Tab is deep-linkable via `?tab=search`.
- `/archive` → `Navigate` to `/search`, preserving the query string (Phase 2 adds `?q=` state; the redirect must carry it).
- No new `ui/` primitive — MyLibrary gets a minimal local two-button tab strip styled with tokens.

## Changes

1. `pages/ArchivePage.tsx` (+css, +test) → `pages/SearchPage.tsx`; title "Search" / "Search — JWST Discovery".
2. Old semantic `pages/SearchPage.tsx` (+css) → `components/library/SemanticSearchPanel.tsx` (behaviour unchanged, incl. admin-gated Re-index).
3. `App.tsx`: `search` → MAST page (no CE gate); `archive` → `ArchiveRedirect` (`useLocation` + `Navigate replace`).
4. `SharedLayout.tsx`: Search link always rendered.
5. `MyLibrary.tsx` (+css): tab strip Library / Search library; active tab from `useSearchParams`.
6. CTAs → `/search`: `DiscoveryHome`, `DashboardToolbar`, `ImportProgressPill` (+ their tests, e2e specs).

## Tests

- `SharedLayout.test.tsx` / `.ce.test.tsx`: Search link present in both builds, labels per mode.
- `App.ce.test.tsx` + new `App.test.tsx`: `/search` serves MAST page in CE; `/archive?q=x` → `/search?q=x`.
- `MyLibrary.test.tsx`: non-CE shows both tabs and switches on `?tab=search`; CE shows none.
- e2e: `search-redirect.spec.ts` new; `discovery-home.spec.ts`, `dashboard.spec.ts`, `mast-*.spec.ts` updated to `/search`.

## Out of scope

Smart input / URL state (Phase 2), results v2 (Phase 3), filter rail (Phase 4), sky map (Phase 5).

# Discover Home Redesign — "Mission Console"

**Branch:** `feature/discover-home-redesign`
**Source:** Design handoff `JWST Discovery redesign.zip` (repo root) — `design_handoff_discover_home/`
**Scope:** Frontend-only. Follow-ups: #1613 (recipe/observation counts), #1614 (curated spotlight).
**Reviews:** CEO review (Mode C, hold scope) + eng review complete, 2026-07-01.

## Goal

Replace the centered-hero Discover Home with the handoff's mission-console layout:

1. **Search console** — eyebrow + h1 + subtitle, 58px command-style search field with
   `:focus-within` glow, "Try" example chips (`M16`, `NGC 3324`, `10h 37m -58°`, `PID 2739`).
2. **Spotlight** — "Target of the week" cinematic card (1.7fr) + two stacked mini-features (1fr),
   derived client-side: first `great`-potential featured target + next two targets.
3. **Featured targets** — filter chips (All targets / Best potential + chips derived from
   categories present in data), restyled `TargetCard` (4/3 vivid gradient thumbnail, instrument
   badge overlay, potential pill + "N filters" footer), live count, empty state.

Header (all pages): hexagon placeholder logomark, MAST status pill wired to
`healthService.checkHealth()`. Nav items unchanged (Discover / Search / My Library).

## Decisions (from reviews)

- **No "Exoplanets" chip hardcoded** — backend categories are nebula/galaxy/planetary/cluster;
  chips derive from fetched data so no dead filters.
- Keep existing nav routes/labels; visual styling only (mock's Discover/Library/Docs rejected).
- MAST pill shows real health (`online`/`offline`), never hardcoded.
- 1440px max-width for the discover page (handoff-intended; rest of shell stays 1600px).
- Filtering is a pure exported function `filterTargets(targets, filter, query)` — unit-tested.
- Spotlight uses `jwst-background.png` (already bundled; login reuse is a deliberate handoff choice).
- Radii/spacing/type map to existing `index.css` tokens; transitions `var(--transition-fast)` ease-out only.

## Files

- `src/utils/filterTargets.ts` (+test) — new
- `src/components/icons/DashboardIcons.tsx` — add SearchIcon, SparklesIcon, ArrowRightIcon
- `src/components/discovery/InstrumentBadge.tsx/.css`, `PotentialPill.tsx/.css` — new (extracted)
- `src/components/discovery/SearchConsole.tsx/.css` (+test) — new, wraps SearchBar submit behavior
- `src/components/discovery/SpotlightSection.tsx/.css` (+test) — new
- `src/components/discovery/FilterChips.tsx/.css` (+test) — new
- `src/components/discovery/TargetCard.tsx/.css` — restyle
- `src/pages/DiscoveryHome.tsx/.css` — rewrite (3-section layout, filter/query state)
- `src/components/layout/SharedLayout.tsx/.css` — logomark + MAST pill
- `e2e/discovery-home.spec.ts` — update selectors/flows (regression-critical)
- `docs/key-files.md` — new component entries

## Test plan

- Unit (vitest): filterTargets (category × query AND, case-insensitive, `great`, empty),
  SpotlightSection derivation (<3 targets, no-great fallback), SearchConsole chip populate,
  FilterChips derived chips + active state.
- E2E: search→target-detail, card→detail, error/retry, empty state, nav links intact.
- Manual: pixel-compare vs `screenshots/01–04`, health-pill offline, narrow viewport.

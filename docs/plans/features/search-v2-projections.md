# MAST Search v2 — sky map projections

**Branch:** `feature/skymap-projections` · Parent plan: MAST Search v2 (Phases 0–6, see `search-v2-skymap.md` and `search-v2-draw.md`). Frontend only — no backend or query-semantics change.

## Problem

Phase 5 mounted Aladin with `showProjectionControl: false` and no `projection` option, so the map is stuck on Aladin's default **orthographic (SIN)** — a globe. That is the wrong projection for the map's entry state: the browse view opens at FOV 180° showing the whole-sky coverage grid, and a globe can only ever show you *half* the sky. The other half is behind the horizon, so half the coverage cells and half the drawable area are unreachable without dragging the sphere around.

It is also the wrong projection for draw-to-search (Phase 6). Near the limb of the globe, sky area is compressed to nothing — a polygon drawn near the edge covers a wildly different solid angle than the same pixels drawn at centre, and `pix2world` fails outright just past it (the code already catches this as "drawn outside the projection"). An all-sky projection makes the whole sky drawable at roughly comparable scale.

## Decisions

- **A projection `<select>` in the map chrome**, next to the survey picker, persisted to `localStorage` under `mast_sky_projection` — the exact pattern the survey picker already uses (`loadSurvey`/`saveSurvey` → `loadProjection`/`saveProjection`). Applied at mount via the `projection` option *and* in a `useEffect` on change, so a stored choice wins after remount, again mirroring the survey effect.
- **Three projections, not Aladin's full list.** `SIN` (Sphere), `AIT` (Aitoff), `MOL` (Mollweide). Aladin v3 ships a dozen more (TAN, ARC, ZEA, STG, CAR, MER, HPX…), but they are either tangent-plane projections that are pointless at all-sky FOV or exotic enough to be noise in a three-item toolbar. Aitoff and Mollweide are the two equal-area/compromise all-sky projections every other archive UI (MAST Portal, ESASky) offers.
- **Default is Aitoff, not Sphere.** The entry state is an all-sky coverage browse; Aitoff shows all of it at once and is what makes the coverage grid readable. This is the change the feature exists for — defaulting to Sphere would leave the default experience exactly as broken as it is today. Sphere remains one click away and, once picked, sticks.
- **No auto-switching by FOV.** Swapping projection on zoom (Aitoff zoomed out, SIN zoomed in) is tempting and surprising — it would silently override a choice the user just made. An explicit, persisted control is the honest version. At small FOV the three projections are visually near-identical anyway, so there is nothing to gain.
- **No geometry changes.** `skyGeometry.ts` never works in raw (ra, dec) — intersection is done on unit vectors and a gnomonic tangent plane at the region centroid — so drawn regions are projection-independent by construction. `pix2world` is likewise projection-aware inside Aladin. Nothing downstream of the draw callback needs to know which projection produced the pixels.

## Changes

1. `FE/components/mast/map/SkyMap.tsx` — `SKY_PROJECTIONS` / `SkyProjectionId` / `DEFAULT_SKY_PROJECTION` / `SKY_PROJECTION_STORAGE_KEY` exports, `loadProjection`/`saveProjection`, `projection` state, `projection` in the mount options, apply-on-change effect, and the chrome `<select>` (`aria-label="Projection"`).
2. `FE/components/mast/map/SkyMap.css` — reuse the `.sky-map-survey` select styling for `.sky-map-projection` so the two controls match.
3. `FE/components/mast/map/SkyMap.test.tsx` — mount option assertion, switch + persist + restore-from-storage, and a junk-value fallback.

## Tests

`SkyMap`: mount passes `projection: 'AIT'`; changing the select calls `aladin.setProjection('SIN')` and writes `mast_sky_projection`; a stored `'MOL'` is applied at mount; a junk stored value falls back to the default. Existing survey/draw/coverage tests untouched.

## Out of scope

Projection-aware graticule/grid lines, per-projection FOV clamping, exposing the remaining Aladin projections, light theme.

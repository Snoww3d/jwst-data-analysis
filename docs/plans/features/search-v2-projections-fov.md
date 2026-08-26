# MAST Search v2 — all-sky field of view per projection

**Branch:** `fix/skymap-allsky-fov` · Follow-up to `search-v2-projections.md` (#1932).

## Problem

#1932 added the projection picker and defaulted it to Aitoff, on the reasoning that the browse view opens on the whole sky and a globe can only show half of it. The projection switched correctly — but the view still did not show the whole sky.

`DEFAULT_SKY_FOV = 180` is a *horizontal* field of view. A globe renders the near hemisphere and 180° covers it exactly, which is why the value was right for `SIN`. An all-sky projection instead lays the full 360° of RA across its width, so at a 180° FOV the eastern and western thirds of the ellipse fall outside the pane. Confirmed in a browser against the live map: at `fov: 180` the Aitoff ellipse is clipped at both edges; at `fov: 360` the complete ellipse fits with room to spare.

So #1932 shipped a flat projection that still clipped the sky — it fixed the projection and left the framing, which was half the point.

## Decisions

- **`allSkyFov(projection)`** — `360` for `AIT`/`MOL`, `180` (`DEFAULT_SKY_FOV`) for `SIN`. Widening a globe past 180 does not reveal more sky; it just shrinks the globe inside the pane, so the two cases genuinely differ rather than being one constant.
- **Applied at mount** via `fov: initialView?.fov ?? allSkyFov(loadProjection())`. An explicit `initialView.fov` (deep link, restored view) still wins — this only supplies the default.
- **Applied on switch, but only from the browse state.** The projection effect re-frames to `allSkyFov(next)` only when the current FOV is already `>= ALL_SKY_FOV_THRESHOLD` (180). Switching projection while parked on a target at 0.5° must not yank the user back out to the whole sky — that would make the picker unusable for its second purpose, comparing a footprint's shape across projections.
- **Threshold is a named constant**, not an inline `180`, because it means something different from `DEFAULT_SKY_FOV` (a state test vs. a default value) even though the two currently share a number.

## Changes

1. `FE/components/mast/map/SkyMap.tsx` — `ALL_SKY_FOV_THRESHOLD` and `allSkyFov()` exports; mount FOV derived from the stored projection; projection effect re-frames the browse view.
2. `FE/components/mast/map/SkyMap.test.tsx` — FOV table, globe-at-180 mount, widen-on-switch, and don't-touch-a-zoomed-view.

## Tests

`allSkyFov` per projection; mount with a stored `SIN` asserts `fov: 180` and with the Aitoff default asserts `fov: 360`; switching `SIN`→`AIT` from a 180° view calls `setFoV(360)`; switching from a 0.5° view calls `setFoV` not at all.

## Out of scope

Per-projection zoom clamping, re-framing on `Fit` (already bounds-driven), remembering FOV across reloads.

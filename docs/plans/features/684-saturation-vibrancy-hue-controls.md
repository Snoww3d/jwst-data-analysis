# Plan: #684 — Saturation, Vibrancy, and Hue Rotation Controls

**Issue:** [#684](https://github.com/Snoww3d/jwst-data-analysis/issues/684)
**Complexity:** Medium
**Risk:** Low — new optional field, backward-compatible, byte-identical output when not provided

## Summary

Add global saturation, vibrancy, and hue rotation controls to the composite pipeline as a post-processing step after sharpening. Follows the exact `SharpeningConfig` pattern across all layers.

## Scope Decisions

- **Per-channel saturation: DROPPED** — `weight` (0.0–2.0) already covers "some filters need more punch"
- **Hue rotation: ADDED** (CEO review EXPANSION-1) — free since we're already doing HSL round-trip
- **Preset updates: ADDED** (CEO review EXPANSION-2) — NASA Press, High Contrast, Auto get sensible defaults

## Architecture

### Pipeline order (routes.py)

```
stretch → combine → sharpening → saturation/vibrancy/hue → encode
```

Saturation goes **after** sharpening (standard astrophotography workflow: sharpen in luma, then color grade).

### Algorithms

- **Saturation:** `s_new = s × saturation` (multiplicative scale, clamp to [0,1])
- **Vibrancy:** `s_new = s + vibrancy × (1 - s)` (lerp toward full saturation — muted pixels get largest boost, vivid pixels almost none)
- **Hue rotation:** `h_new = (h + rotation/360) % 1.0`

All three use existing `rgb_to_hsl()` / `hsl_to_rgb()` in a single HSL round-trip.

## Files Changed

### Processing Engine (Python)

| File | Change |
|------|--------|
| `processing-engine/app/composite/models.py` | New `SaturationConfig` model (saturation: 0–2 default 1.0, vibrancy: 0–1 default 0.0, hue_rotation: ±30° default 0.0). Add optional `saturation` field to `NChannelCompositeRequest`. |
| `processing-engine/app/composite/color_mapping.py` | New `apply_saturation_vibrancy(rgb, config)` pure function using existing `rgb_to_hsl`/`hsl_to_rgb`. |
| `processing-engine/app/composite/routes.py` | Import `apply_saturation_vibrancy`, import `SaturationConfig`. Wire after sharpening (~5 lines). |

### Frontend (TypeScript/React)

| File | Change |
|------|--------|
| `frontend/jwst-frontend/src/types/CompositeTypes.ts` | New `SaturationConfig` interface + `DEFAULT_SATURATION`. Add `saturation?` to `NChannelCompositeRequest`. Update `COMPOSITE_PRESETS` (NASA Press, High Contrast, Auto). Add `saturation?` to `CompositePreset`. |
| `frontend/jwst-frontend/src/components/wizard/CompositePreviewStep.tsx` | New `saturation` state. UI section with 3 sliders (saturation, vibrancy, hue rotation). Wire into preview request. Load from preset. |
| `frontend/jwst-frontend/src/services/compositeService.ts` | Pass `saturation` in request payload (same pattern as sharpening). |

### Tests

| File | Change |
|------|--------|
| `processing-engine/tests/test_color_mapping.py` | Unit tests for `apply_saturation_vibrancy()`: identity, grayscale, boost, vibrancy selectivity, hue shift, edge cases (all-black, all-white). |
| `processing-engine/tests/test_nchannel_composite.py` | Integration tests: API with saturation config → 200, output differs, identity = byte-identical, 422 on out-of-range. |

### Docs

| File | Change |
|------|--------|
| `docs/key-files.md:193` | Update `color_mapping.py` description to mention saturation/vibrancy/hue. |

## Test Plan

```
Unit Tests (test_color_mapping.py):
- [ ] identity (sat=1.0, vib=0.0, hue=0.0) returns input unchanged
- [ ] saturation=0.0 produces grayscale
- [ ] saturation=2.0 boosts chroma, clamps to [0,1]
- [ ] vibrancy boosts muted pixels more than saturated pixels
- [ ] hue_rotation=30 shifts hue by ~30°
- [ ] all-black input: no NaN/divide-by-zero
- [ ] all-white input: no saturation artifacts

Integration Tests (test_nchannel_composite.py):
- [ ] POST with saturation config returns 200
- [ ] Output differs from baseline when saturation != 1.0
- [ ] Identity config = byte-identical to no config
- [ ] Out-of-range values return 422

E2E Tests:
- [ ] Saturation slider renders in CompositePreviewStep
- [ ] Changing saturation triggers preview refresh
- [ ] Preset loads saturation defaults correctly

Manual Verification:
- [ ] Boost saturation to 1.8 — colors visibly richer
- [ ] Vibrancy 0.5 — muted nebula gains color, bright stars unchanged
- [ ] Hue +15° — image shifts warmer
- [ ] Docker rebuild required: YES
```

## Risks

- **MED:** Vibrancy near-neutral pixels — `(1 - s)` formula naturally handles this but verify with sky background remnants
- **LOW:** HSL round-trip precision — clamp output, verify no drift on identity
- **LOW:** API backward-compat — `None` = no-op, existing clients unaffected

## NOT in Scope

- Per-channel saturation (covered by `weight`)
- Per-channel hue/vibrancy
- Migrating `apply_sharpening()` to `color_mapping.py` (separate tech-debt)
- Luminance-space saturation

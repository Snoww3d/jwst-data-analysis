# Compositing Quality Spike: Closing the Gap to NASA Press Images

**Issue**: #680
**Date**: 2026-03-06
**Status**: In Progress

## Current Pipeline Summary

Our N-channel composite pipeline is more mature than expected:

| Capability | Status | Notes |
|---|---|---|
| Stretch functions (7) | Done | zscale, asinh, log, sqrt, power, histeq, linear |
| Per-channel levels | Done | black/white point, gamma, tone curves, weight |
| Chromatic ordering | Done | NASA/STScI palette for 1-7+ filters |
| Wavelength-to-hue mapping | Done | Log-scale 0.6-28 um to blue-to-red |
| Background neutralization | Done | Sigma-clipped median subtraction pre-stretch |
| LRGB luminance blending | Done | HSL-space lightness replacement |
| Reprojection + mosaicing | Done | reproject_interp, common WCS, footprint masking |
| Adaptive downscaling | Done | Per-instrument + total pixel budgets |
| Result caching | Done | LRU cache on reprojected arrays, stretch-only tweaks ~100ms |
| Async export (large) | Done | Background job queue via SignalR |

**Key files:**
- `processing-engine/app/composite/routes.py` -- pipeline orchestration
- `processing-engine/app/composite/color_mapping.py` -- hue/RGB/LRGB mapping
- `processing-engine/app/processing/enhancement.py` -- all 7 stretch functions
- `processing-engine/app/processing/filters.py` -- unsharp mask (exists, not wired)
- `frontend/.../types/CompositeTypes.ts` -- params, defaults, types
- `frontend/.../components/wizard/CompositePreviewStep.tsx` -- Step 2 UI

## Gap Analysis: Our Pipeline vs NASA Press Workflow

### What NASA/STScI Does That We Don't

1. **Sharpening (unsharp mask)** -- Every NASA press image is sharpened. We have the code (`filters.py`) but it's not exposed in the composite pipeline or UI.

2. **Saturation/vibrancy boost** -- NASA images have vivid, punchy color. We combine channels to RGB but have no post-combine saturation control. Images likely appear undersaturated.

3. **Noise reduction pre-composite** -- NASA applies smoothing before compositing, especially for MIRI (lower SNR). Without this, per-channel noise gets color-mapped and amplified by stretch.

4. **Suboptimal defaults** -- Our per-channel default was `log` with `asinhA=0.1`. NASA typically uses `asinh` with aggressive softening (`a=0.01-0.05`). No preset system existed -- users started from generic params every time.

5. **Multi-scale processing** -- NASA separates stars from nebulosity, processes each independently (aggressive stretch on diffuse, gentle on stars), then recombines. This is how they get crisp stars AND smooth nebulosity simultaneously.

6. **Smart auto-stretch** -- No histogram analysis to auto-pick optimal stretch + params. Users must manually tune everything.

### Impact Ranking (Visual Quality x Effort)

| # | Gap | Visual Impact | Effort | Priority |
|---|-----|---------------|--------|----------|
| 1 | Stretch defaults + presets (#687) | High | Low | **Do first** |
| 2 | Unsharp masking (#683) | High | Low | **Quick win** |
| 3 | Saturation/vibrancy (#684) | High | Medium | **High** |
| 4 | Noise reduction (#685) | Medium | Medium | Medium |
| 5 | Smart auto-stretch (#688) | Medium | Medium | Medium |
| 6 | Star separation (#686) | Very High | Very High | Phase 6+ |

## Prioritized Improvements

### Tier 1: Quick Wins (implement now in Phase 5b)

**#687 -- Stretch Defaults & NASA-Style Presets**
- Change default from `log` to `asinh` with `a=0.05`
- Add 5 presets: NASA Press, High Contrast, Faint Emission, Natural, Scientific
- Each preset configures all params at once (stretch, levels, gamma, curve)
- Preset dropdown in CompositePreviewStep with "Custom" for manual
- **Effort**: ~2 hours. Frontend-only -- presets just configure existing params client-side.

**#683 -- Expose Unsharp Masking**
- `filters.py` already implements unsharp mask -- just needs wiring
- Add to composite pipeline post-combine, pre-encode
- Per-channel and/or overall sharpening controls
- Params: radius (sigma), amount (strength)
- **Effort**: ~3-4 hours. Python plumbing + frontend controls.

### Tier 2: Medium Effort (Phase 5b)

**#684 -- Saturation & Vibrancy Controls**
- Post-combine saturation boost in HSL space
- Overall saturation slider (0.0-2.0, default 1.0)
- Optional per-channel saturation
- Vibrancy (selective boost -- muted colors more than saturated ones)
- **Effort**: ~4-6 hours. New processing step + UI.

**#685 -- Noise Reduction Pre-Composite**
- Per-channel bilateral filter or sigma-clipped smoothing
- Post-reproject, pre-stretch in pipeline
- Toggle + strength control per channel
- Most impactful on MIRI, faint extended emission
- **Effort**: ~4-6 hours. scipy bilateral filter, UI controls.

**#688 -- Smart Auto-Stretch**
- Histogram analysis per channel -> auto-select stretch + params
- Reference: astropy `AsymmetricPercentileInterval`, dynamic range detection
- "Auto" button per channel + "Auto All"
- Starting point users can refine, not black box
- **Effort**: ~6-8 hours. Algorithm research + implementation.

### Tier 3: Future (Phase 6+)

**#686 -- Multi-Scale Processing / Star Separation**
- Star detection via wavelet decomposition or morphological operations
- Separate stretch/smoothing for starless vs star layers
- Recombination with blend controls
- This is how NASA gets their best results, but it's a significant capability addition
- **Effort**: ~20-30 hours. Needs photutils/wavelet decomposition, new UI mode.
- **Note**: Starnet++ is GPL -- need own implementation or compatible alternative.

## Reference Comparison (TODO)

Future work: download NASA press release source FITS + published composites, run through our pipeline with best-effort params, visual side-by-side comparison.

Good candidates:
- Pillars of Creation (NIRCam + MIRI)
- Carina Nebula (NIRCam)
- Southern Ring Nebula (NIRCam + MIRI)
- Stephan's Quintet (NIRCam + MIRI)

## Recommendations

1. **Start with #687 (presets)** -- biggest UX win for least effort. Users get NASA-quality starting params with one click.
2. **Follow with #683 (sharpening)** -- single biggest visual quality gap. Code already exists.
3. **Then #684 (saturation)** -- closes the "vivid color" gap vs press images.
4. Items 4-5 are nice-to-have for 5b; item 6 is Phase 6+.
5. After implementing 1-3, do a visual comparison against NASA press images to measure remaining gap.

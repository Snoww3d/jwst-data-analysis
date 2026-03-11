# Coverage-Aware Pixel Blending for Multi-Instrument Composites

**Issue**: #781
**Status**: Partially Completed (PR #782 merged — mask infrastructure only. Per-pixel normalization reverted after visual testing showed it worsened artifacts. Edge feathering tracked in #783.)
**Risk**: Medium — touches the core composite pipeline, affects all composite output

## Problem

Cross-instrument composites (MIRI+NIRCam) show sharp rectangular color artifacts at instrument FOV boundaries. MIRI has a smaller FOV than NIRCam, so pixels outside MIRI coverage appear as solid colored rectangles instead of showing only the channels with actual data.

**Root cause**: `combine_channels_to_rgb()` sums all channels at every pixel. Pixels with no coverage are zero, but the normalization step (`component /= c_max`) still treats them as valid. The `footprint` arrays from `reproject_interp()` are discarded after reprojection, so there's no way to distinguish "no data" from "data that happens to be zero."

## Current Pipeline Flow

```
load_fits_2d_with_wcs → downscale → [mosaic] → reproject_channels_to_common_wcs → stretch → combine_channels_to_rgb → output
```

Key behavior at each stage:
- **Reproject** (routes.py:340-346): `reproject_interp()` returns `(data, footprint)`. Footprint is 0 where no coverage. Currently: `data[footprint == 0] = 0.0` then footprint is **discarded**.
- **Combine** (color_mapping.py:296-307): Sums `data * weight` per channel, normalizes per RGB component by global max. No per-pixel coverage awareness.

## Plan

### Step 1: Preserve footprint masks through reprojection
**File**: `processing-engine/app/composite/routes.py`

In `reproject_channels_to_common_wcs()` (line 287), change the return type to include coverage masks:

```python
# Current return:
return reprojected_channels, shape_out

# New return:
return reprojected_channels, coverage_masks, shape_out
# coverage_masks: dict[str, np.ndarray] — boolean arrays, True where channel has data
```

At line 344-346, instead of discarding the footprint:
```python
reprojected = np.nan_to_num(reprojected, nan=0.0, posinf=0.0, neginf=0.0)
coverage_masks[channel_name] = footprint > 0  # Preserve as boolean mask
reprojected[~coverage_masks[channel_name]] = 0.0
reprojected_channels[channel_name] = reprojected
```

### Step 2: Pass coverage masks through the pipeline
**File**: `processing-engine/app/composite/routes.py`

The masks need to flow through:
1. Cache storage (alongside `reprojected_channels`)
2. Background neutralization (already handles zeros correctly — no change needed)
3. Stretch step (zeros stay zero — no change needed)
4. Into `combine_channels_to_rgb()`

The cache currently stores `reprojected_channels: dict[str, np.ndarray]`. Change to store `(reprojected_channels, coverage_masks)` tuple. Update `CompositeCache.get()` / `set()` accordingly.

### Step 3: Coverage-aware blending in `combine_channels_to_rgb`
**File**: `processing-engine/app/composite/color_mapping.py`

This is the core change. Current logic (line 296-307):
```python
for data, (wr, wg, wb) in channels:
    arr = data.astype(np.float64)
    rgb[:, :, 0] += arr * wr
    rgb[:, :, 1] += arr * wg
    rgb[:, :, 2] += arr * wb

for c in range(3):
    component = rgb[:, :, c]
    c_max = component.max()
    if c_max > 0:
        component /= c_max
```

New logic:
```python
def combine_channels_to_rgb(
    channels: list[tuple[np.ndarray, tuple[float, float, float]]],
    coverage_masks: list[np.ndarray] | None = None,
) -> np.ndarray:
    ...
    # Build per-pixel weight accumulator for each RGB component
    # This tracks how much total color weight contributes to each pixel
    weight_sum = np.zeros((*shape, 3), dtype=np.float64)

    for i, (data, (wr, wg, wb)) in enumerate(channels):
        arr = data.astype(np.float64)
        mask = coverage_masks[i] if coverage_masks else (arr > 0)

        rgb[:, :, 0] += arr * wr
        rgb[:, :, 1] += arr * wg
        rgb[:, :, 2] += arr * wb

        # Track which pixels got contributions
        weight_sum[:, :, 0] += mask * abs(wr)
        weight_sum[:, :, 1] += mask * abs(wg)
        weight_sum[:, :, 2] += mask * abs(wb)

    # Normalize per-pixel by actual contributing weight, not global max
    for c in range(3):
        ws = weight_sum[:, :, c]
        nonzero = ws > 0
        rgb[:, :, c][nonzero] /= ws[nonzero]
        # Scale to [0, 1]
        c_max = rgb[:, :, c].max()
        if c_max > 0:
            rgb[:, :, c] /= c_max
```

**Effect**: A pixel covered only by NIRCam (blue/cyan channels) will be normalized only by the NIRCam weights, producing a proper blue/cyan color. A pixel covered by both MIRI and NIRCam will be normalized by all contributing weights, producing the expected blended color. No more solid-color rectangles from partial coverage.

### Step 4: Update tests
**Files**: `processing-engine/tests/test_nchannel_composite.py`, `processing-engine/tests/test_color_mapping.py` (if exists)

- Test that `reproject_channels_to_common_wcs` returns coverage masks
- Test that `combine_channels_to_rgb` with coverage masks produces different output than without
- Test partial coverage scenario: 2 channels, one covering full image, one covering half — verify no sharp boundary artifacts
- Test backward compatibility: `coverage_masks=None` produces same output as before

### Step 5: Update cache version
If the cache stores the new mask data, existing cache entries need invalidation. Either:
- Add masks to the cache value (increases memory ~10% per channel — boolean array)
- Or recompute masks from data at blend time (check `data > 0`) — simpler, no cache change needed

**Recommendation**: Use `data > 0` as the mask at blend time for simplicity. This avoids cache format changes and the footprint-derived mask is nearly identical to `data > 0` after the zero-fill step. The only edge case is genuine astronomical zero values, which are astronomically rare in calibrated FITS data.

This simplifies Steps 1-2: no need to change reprojection return type or cache format. Just change `combine_channels_to_rgb` to accept an optional mask or derive it internally.

## Files Changed

| File | Change |
|------|--------|
| `processing-engine/app/composite/color_mapping.py` | Coverage-aware normalization in `combine_channels_to_rgb` |
| `processing-engine/app/composite/routes.py` | Pass masks to combine function (or let it derive internally) |
| `processing-engine/tests/test_nchannel_composite.py` | New tests for partial coverage |

## Performance Impact

- **Minimal**: One boolean comparison per pixel per channel (`data > 0`), plus per-pixel division instead of per-component division. Both are vectorized numpy operations.
- Reprojection (the actual bottleneck) is unchanged.
- Memory: One extra boolean array per channel during blending (~4MB for 2000x2000). Freed after blending completes.

## Rollback

Revert the commit. `coverage_masks=None` default means existing callers are unaffected.

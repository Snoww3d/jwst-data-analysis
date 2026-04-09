# Refactor: Split composite route god function (#963, #1002)

**Issues**: [#963](https://github.com/Snoww3d/jwst-data-analysis/issues/963), [#1002](https://github.com/Snoww3d/jwst-data-analysis/issues/1002)
**Risk**: Low — pure refactor, no behavioral changes, existing tests as safety net
**Files**: `processing-engine/app/composite/routes.py`, `processing-engine/tests/test_nchannel_composite.py`, `processing-engine/tests/test_composite_downscale.py`

## Problem

`generate_nchannel_composite` in `routes.py:416` is ~487 lines handling cache lookup, instrument detection, WCS collection, reprojection, memory budgeting, resolution blur, feathering, background neutralization, stretching, color mapping, instrument blending, luminance blending, overall adjustments, framing, encoding, and memory cleanup — all in one function.

This blocks the compositing quality spike (#680) — adding unsharp masking (#683), saturation (#684), noise reduction (#685), and auto-stretch (#688) to this function would push it past 600+ lines.

## Acceptance Criteria (from #963)

- [ ] Route handler is < 30 lines
- [ ] Each extracted function has its own unit tests
- [ ] No behavioral changes — existing tests still pass

## Current Function Structure

```
generate_nchannel_composite (416–903, 487 lines)
├── Setup: compute input budget, log                    (428–439,  12 lines)
├── Instrument detection: header-only per-channel       (446–453,   8 lines)
├── Cache check: exact budget → fallback budget         (455–465,  11 lines)
├── [cache miss] Reproject pipeline                     (466–603, 137 lines)
│   ├── Resolve file paths & channel names              (468–475)
│   ├── Collect WCS headers from all files              (479–486)
│   ├── Compute optimal output grid                     (492–498)
│   ├── Memory budget & grid downscale                  (500–543)
│   └── Reproject each channel (single/multi-file)      (546–599)
├── Resolution blur for mixed instruments               (605–647,  43 lines)
├── Cache store                                         (648–649,   2 lines)
├── Resolve feather strength (auto/manual)              (651–678,  28 lines)
├── Background neutralization (pre-stretch)             (680–687,   8 lines)
├── Validate luminance count                            (689–695,   7 lines)
├── Auto-stretch + apply stretch + color/lum split      (697–743,  47 lines)
├── Combine to RGB (instrument blending + luminance)    (745–811,  67 lines)
├── Post-processing (flip, crop, quality, rotation)     (813–839,  27 lines)
├── Output encoding (8-bit, zoom/pan, canvas, encode)   (841–879,  39 lines)
└── Cleanup + response with quality headers             (881–903,  23 lines)
```

## Decomposition

### Extracted Functions

| # | Function | ~Lines | Source lines | Purpose |
|---|----------|--------|-------------|---------|
| 1 | `_detect_channel_instruments(channels)` | 8 | 446–453 | Header-only instrument detection per channel |
| 2 | `_load_reprojected_channels(request, instruments, budget)` | ~20 | 455–649 | Thin wrapper: cache check → reproject → blur → cache store |
| 3 | `_reproject_all_channels(request, instruments, budget)` | ~135 | 466–603 | Paths → WCS → grid → memory budget → reproject loop |
| 4 | `_apply_resolution_blur(reprojected, instruments, request)` | ~35 | 605–647 | Gaussian blur for mixed-instrument pixel scale mismatch (mutates dict in place) |
| 5 | `_resolve_feather_strength(request, instruments)` | ~25 | 651–678 | Returns `(effective_feather: float, auto_feathered: bool)` |
| 6 | `_stretch_and_map_channels(request, stretch_input, instruments)` | ~55 | 689–743 | Auto-stretch → apply stretch → separate color/lum. Returns `StretchResult` |
| 7 | `_combine_to_rgb(mapped, reprojected, request, feather, instruments)` | ~65 | 745–811 | Instrument blending decision → combine → luminance blend → overall adjustments |
| 8 | `_encode_and_respond(rgb, request, auto_feathered, feather)` | ~70 | 818–903 | Flip → crop → quality → rotation → 8-bit → zoom/pan → canvas → encode → cleanup |

### New Type

```python
from dataclasses import dataclass

@dataclass
class StretchResult:
    """Output of the stretch-and-map phase, separating color and luminance channels."""
    color_mapped: list[tuple[np.ndarray, tuple[float, float, float]]]
    color_ch_names: list[str]
    color_ch_instruments: list[str | None]
    lum_data: np.ndarray | None
    lum_weight: float
```

### Resulting Orchestrator (~18 lines of logic)

```python
@router.post("/generate-nchannel")
def generate_nchannel_composite(request: NChannelCompositeRequest):
    """Generate an RGB composite image from N FITS channels with color mapping."""
    input_budget = min(
        MAX_INPUT_PIXELS,
        max(request.width * request.height * PREVIEW_OVERSAMPLE, MIN_PREVIEW_PIXELS),
    )
    log_memory("composite-start")
    logger.info(
        f"Generating N-channel composite ({len(request.channels)} channels, "
        f"output={request.width}x{request.height}, input_budget={input_budget:,} px)"
    )

    instruments = _detect_channel_instruments(request.channels)
    reprojected = _load_reprojected_channels(request, instruments, input_budget)
    feather, auto_feathered = _resolve_feather_strength(request, instruments)

    if request.debug_masks:
        return _render_debug_masks_response(request, reprojected, instruments, feather)

    if request.background_neutralization:
        stretch_input = neutralize_raw_backgrounds(reprojected)
    else:
        stretch_input = reprojected

    mapped = _stretch_and_map_channels(request, stretch_input, instruments)
    rgb = _combine_to_rgb(mapped, reprojected, request, feather, instruments)
    return _encode_and_respond(rgb, request, auto_feathered, feather)
```

### Data Flow

```
request ──┬──────────────────────────────────────────────────────────────────────►
          │
          ├─► _detect_channel_instruments ─► instruments ──┬──────────────────────►
          │                                                │
          ├─► _load_reprojected_channels ◄─────────────────┤
          │   ├── cache.get (exact budget)                 │
          │   ├── cache.get_any_budget (fallback)          │
          │   └── [miss]:                                  │
          │       ├── _reproject_all_channels              │
          │       ├── _apply_resolution_blur               │
          │       └── cache.put                            │
          │   └─► reprojected ─────────────────────────────┼──────────────────────►
          │                                                │
          ├─► _resolve_feather_strength ◄──────────────────┘
          │   └─► (feather, auto_feathered) ──────────────────────────────────────►
          │
          ├─► [debug_masks?] → _render_debug_masks_response → return early
          │
          ├─► neutralize_raw_backgrounds (conditional)
          │   └─► stretch_input ──►
          │
          ├─► _stretch_and_map_channels ◄── stretch_input, instruments
          │   └─► StretchResult ──►
          │
          ├─► _combine_to_rgb ◄── StretchResult, reprojected, feather, instruments
          │   └─► rgb ──►
          │
          └─► _encode_and_respond ◄── rgb, auto_feathered, feather
              └─► Response
```

## Design Decisions

### Why NOT split `_reproject_all_channels` further

Its sub-steps (resolve paths → collect WCS → compute grid → memory budget → reproject loop) are tightly sequential with shared local state (`all_channel_info`, `wcs_out`, `shape_out`). Splitting into 4 functions would create a chain where each takes the output of the previous, with no testability gain — all require FITS file mocking. The function is cohesive: "given a request, produce reprojected channel data on a common grid."

### Why resolution blur is separate from reproject

Resolution blur is a distinct processing concern (pixel scale normalization) that operates on already-reprojected data. Keeping it separate makes it independently testable and makes the pipeline explicit: reproject → blur → cache. The blurred data IS what gets cached, since blur depends on the instrument mix which is fixed per channel set.

### Why debug masks moved before stretch

Current code runs auto-stretch + apply_stretch for all channels before checking `debug_masks`. Debug masks only need raw reprojected data and channel names (derivable from request config). Moving the check before stretch skips ~55 lines of unnecessary computation.

### Why `_compute_input_budget` was dropped

3 lines of arithmetic (`min(MAX, max(output * 4, MIN))`). Extracting it creates a function with no testability gain beyond what `TestBudgetFormula` already covers.

### Why no new files

All extracted functions are private to the route. Module reorganization can happen later when the quality features (#683–#688) add new processing steps that warrant a `pipeline.py` or similar.

## Bug Fix (pre-existing)

**Test formula discrepancy**: `test_composite_downscale.py:180` uses `effective_arrays = n_channels + 13` but `routes.py:518` uses `n + 12`.

- Production code comment: "N + 4 reproject + 1 input + **6 blend** + 1 headroom = N + 12"
- Test comment: "N + 4 reproject + 1 input + **7 blend** + 1 headroom = N + 13"

The test is self-consistent (passes because it doesn't call production code) but doesn't validate the production formula. **Fix**: update test `_max_pixels` to use `n + 12` and adjust assertions.

## Test Plan

### Existing tests (no changes expected)
- `test_nchannel_composite.py::TestGenerateNChannelEndpoint` — integration tests via mock cache. Mock feeds pre-computed data into post-cache path (stretch → combine → encode). These exercise the same code, just reorganized into separate functions.
- `test_composite_framing.py` — model validation, unaffected.
- `test_composite_downscale.py::TestDownscaleMaxPixels`, `TestBudgetFormula` — test utility functions that aren't changing.
- `test_composite_downscale.py::TestResolutionBlur` — tests blur behavior (synthetic data), unaffected.

### Updated tests
- `test_composite_downscale.py::TestMemoryBudgetDownscale` — fix `_max_pixels` formula from `n+13` to `n+12`, update assertions.

### New unit tests
| Test class | Tests | What it validates |
|-----------|-------|-------------------|
| `TestDetectChannelInstruments` | valid paths, missing files, mixed | Instrument detection with error handling |
| `TestResolveFeatherStrength` | single inst, multi inst, manual override, auto scaling | Feather logic for various instrument configs |
| `TestStretchAndMapChannels` | basic stretch, auto-stretch, luminance separation, multi-lum rejection | Stretch pipeline + color/lum split |
| `TestCombineToRgb` | single-inst, multi-inst blending, luminance blend, overall adjustments | RGB combination paths |
| `TestEncodeAndRespond` | PNG output, JPEG output, rotation, zoom/pan, quality headers | Output encoding + framing |

### Verification
1. Run existing tests first to confirm green baseline
2. Apply refactor
3. Run all tests — zero failures expected
4. Verify via Docker: `docker exec jwst-processing python -m pytest`

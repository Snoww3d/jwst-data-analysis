# Auto-Detect Optimal Stretch Parameters

**Issue**: #736
**Status**: Planned
**Created**: 2026-03-08

## Problem

Every composite gets the same hardcoded stretch preset. A 630-file nebula mosaic needs different treatment than a single galaxy exposure. PR #735 improved the default (zscale + robust normalization), but different data distributions call for different stretch methods and parameters.

## Design

### Backend: Data Analysis Endpoint

Add a `POST /composite/analyze-channels` endpoint (or extend the existing generate endpoint with `include_recommendations=true`) that returns per-channel stretch recommendations after mosaicking and reprojection.

**Analysis per channel:**
1. Compute histogram of reprojected data (256 bins, ignoring NaN/zero-padded edges)
2. Measure distribution characteristics:
   - **Dynamic range**: `log10(p99.9 / p0.1)` — how many orders of magnitude
   - **Skewness**: positive = faint-heavy (most astro data), negative = bright-heavy
   - **Bimodality**: distinct peaks suggest background + source separation
   - **Signal-to-noise**: `median / MAD` (median absolute deviation)
3. Select stretch method based on characteristics:
   - Dynamic range > 3 orders → `asinh` (compresses wide range)
   - Dynamic range 1-3 orders → `zscale` (robust general purpose)
   - Dynamic range < 1 order → `linear` (data is already well-behaved)
   - High bimodality → `histeq` (maximize contrast between modes)
4. Compute optimal parameters:
   - `asinh_a`: scale with dynamic range (wider range → smaller a)
   - `black_point` / `white_point`: based on percentile analysis
   - `gamma`: adjust based on skewness

**Response shape:**
```json
{
  "channels": {
    "F090W": {
      "stretch": "zscale",
      "blackPoint": 0.005,
      "whitePoint": 0.995,
      "gamma": 1.0,
      "asinhA": 0.1,
      "confidence": 0.85,
      "reason": "moderate dynamic range (2.1 orders), positive skew"
    }
  }
}
```

### Frontend: Recommendation UI

**Guided create:**
- After mosaicking completes, call analyze endpoint
- Apply recommended params automatically (no user interaction needed)
- Result is a good-looking composite on first try

**Advanced editor:**
- Add "Auto" option in stretch dropdown
- When selected, fetches recommendations and applies them
- Show recommendation badge/tooltip: "Recommended: zscale (moderate dynamic range)"
- User can override any parameter — overrides stick until "Auto" is re-selected

### Caching

- Recommendations are deterministic for a given channel data hash
- Cache alongside the reprojected channel data in `_cache`
- No extra computation on re-render with same data

## Implementation Steps

### Step 1: Backend Analysis Module
**New file**: `processing-engine/app/composite/channel_analysis.py`
- `analyze_channel(data: np.ndarray) -> ChannelRecommendation`
- Histogram computation, distribution metrics, stretch selection logic
- Unit tests with synthetic data (flat field, galaxy-like, nebula-like)

### Step 2: Wire into Composite Pipeline
**Modified**: `processing-engine/app/composite/routes.py`
- Add `include_recommendations` query param to generate endpoints
- Run analysis after reprojection, before stretch
- Include recommendations in response metadata

### Step 3: Frontend Auto Mode
**Modified**: `frontend/.../types/CompositeTypes.ts`
- Add `'auto'` to stretch type union
- Add `ChannelRecommendation` type

**Modified**: `frontend/.../pages/GuidedCreate.tsx`
- After composite generates, check if recommendations are in response
- Apply them to channel params for the result step

**Modified**: `frontend/.../components/wizard/CompositePreviewStep.tsx`
- Add "Auto" option to stretch dropdown
- Fetch and display recommendations

### Step 4: Polish
- Confidence indicator in UI (how sure is the recommendation)
- "Why this stretch?" tooltip explaining the analysis
- Fallback to zscale if analysis fails

## Files to Change

| File | Change |
|------|--------|
| `processing-engine/app/composite/channel_analysis.py` | **New** — analysis module |
| `processing-engine/app/composite/routes.py` | Add recommendation support |
| `processing-engine/tests/test_channel_analysis.py` | **New** — unit tests |
| `frontend/.../types/CompositeTypes.ts` | Add auto stretch type + recommendation type |
| `frontend/.../pages/GuidedCreate.tsx` | Use recommendations |
| `frontend/.../components/wizard/CompositePreviewStep.tsx` | Auto stretch UI |
| `frontend/.../services/compositeService.ts` | Parse recommendations from response |

## Open Questions

1. Should the analysis run on raw data (pre-stretch) or post-mosaic (pre-reproject)? Post-reproject is more representative of what the user sees, but reproject may introduce edge artifacts.
2. Is per-channel analysis sufficient, or do we need cross-channel analysis (e.g., balancing relative brightness between channels)?
3. Should we persist recommendations in the composite metadata for reproducibility?

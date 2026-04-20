# #688 — Smart Auto-Stretch Based on Histogram Analysis

## Summary

Expose the existing `auto_stretch_params()` backend to users via per-channel Auto
buttons, with histogram visualization, detection metadata, named preset library,
and before/after comparison toggle.

**Issue:** [#688](https://github.com/Snoww3d/jwst-data-analysis/issues/688)
**Complexity:** Large (8 production files, 1 new endpoint, no data model changes)
**Reversal cost:** < 1 hour — all frontend-only except one new read-only endpoint

## CEO Review Decisions

- **Mode:** A (Scope Expansion)
- **EXPANSION-1:** Per-channel histogram panel — ACCEPTED (S effort, LOW risk)
- **EXPANSION-2:** Auto-stretch explanation card — ACCEPTED (S effort, LOW risk)
- **EXPANSION-3:** Named stretch preset library (localStorage) — ACCEPTED (L effort, MED risk)
- **EXPANSION-4:** Before/after comparison toggle — ACCEPTED (M effort, LOW risk)

## Architecture Decision

- **ARCH-1:** New `POST /composite/analyze-channels` endpoint (not response headers)
  - Returns JSON with per-channel histogram + auto-stretch params + detection metadata
  - Separate from binary image endpoint for clean separation
  - Called on user "Auto" click, not on every preview

## What Already Exists

| Component | Status |
|---|---|
| `auto_stretch_params()` in `auto_stretch.py` | Fully implemented |
| `auto_stretch: bool` on `NChannelConfig` model | Wired |
| Backend auto-stretch in `/generate-nchannel` | Working |
| `HistogramPanel.tsx` component | Working (not wired per-channel) |
| Global "auto" preset in `CompositePreviewStep` | Working |
| `statistics.py` histogram/stats framework | Working |

## File-by-File Changes

### Backend (Python — processing engine)

#### 1. `processing-engine/app/composite/auto_stretch.py`

- **Modify** `auto_stretch_params()` to return detection metadata alongside stretch params
- Add `_meta` key to return dict with: `dynamic_range`, `noise`, `snr`, `hdr_detected`,
  `curve_reason`, `instrument_adjusted`, `valid_pixels`, `zero_coverage_frac`
- Computed from variables already in scope — no new analysis needed
- No signature change — callers that ignore `_meta` are unaffected

#### 2. `processing-engine/app/composite/models.py`

- **Add** `AnalyzeChannelsRequest` model:
  - `channels: list[NChannelConfig]` (reuse existing)
  - `background_neutralization: bool = True`
- **Add** `AutoStretchMeta` model:
  - `dynamic_range`, `noise`, `snr`, `hdr_detected`, `curve_reason`,
    `instrument_adjusted`, `valid_pixels`, `zero_coverage_frac`
- **Add** `ChannelHistogram` model:
  - `counts: list[int]`, `bin_centers: list[float]`, `bin_edges: list[float]`, `n_bins: int`
- **Add** `ChannelAnalysisResult` model:
  - `channel_name`, `label`, `params: dict`, `histogram`, `meta`, `stats`
- **Add** `AnalyzeChannelsResponse` model:
  - `channels: list[ChannelAnalysisResult]`

#### 3. `processing-engine/app/composite/routes.py`

- **Add** `POST /composite/analyze-channels` endpoint:
  - Accept `AnalyzeChannelsRequest`
  - Reuse `_detect_channel_instruments()` and `_load_reprojected_channels()` with
    small fixed input budget (~262,144 px for speed)
  - Optionally apply `neutralize_raw_backgrounds()`
  - Per channel: `np.histogram(valid, bins=100)`, `auto_stretch_params()`, basic stats
  - Return `AnalyzeChannelsResponse` as JSON
- **Import** the new models

### Frontend (TypeScript/React)

#### 4. `frontend/jwst-frontend/src/types/CompositeTypes.ts`

- **Add** interfaces: `AutoStretchMeta`, `ChannelHistogram`, `ChannelAnalysis`,
  `AnalyzeChannelsResponse`, `SavedStretchPreset`
- **Extend** `NChannelState` with optional `analysis?: ChannelAnalysis` field

#### 5. `frontend/jwst-frontend/src/services/compositeService.ts`

- **Add** `analyzeChannels()` function:
  - POSTs to `/api/composite/analyze-channels`
  - Returns `AnalyzeChannelsResponse`

#### 6. `frontend/jwst-frontend/src/components/wizard/CompositePreviewStep.tsx`

- **Add state:** `analyzing`, `beforePreviewUrl`, `showBefore`, `savedPresets`
- **Add** `handleAutoChannel(channelId)`:
  - Calls `analyzeChannels()` for one channel
  - Populates channel's `params` with computed values (lock-and-refine)
  - Stores `analysis` on `NChannelState`
- **Add** `handleAutoAll()`:
  - Batch call for all channels
  - Stores `previewUrl` as `beforePreviewUrl` before applying
- **Modify** per-channel section (~line 917-945):
  - "Auto" button per channel header
  - `HistogramPanel` per channel (collapsed by default) below stretch controls
  - Auto-stretch explanation card (collapsible) below histogram
- **Add** "Auto All" button next to "Per-Channel Adjustments" toggle (~line 898)
- **Add** before/after toggle in preview container (~line 511)
- **Add** preset save/load UI after built-in presets (~line 591):
  - "Save Current" button, name prompt, localStorage `jwst_stretch_presets_v1`
  - Saved presets render as additional buttons with delete "x"

#### 7. `frontend/jwst-frontend/src/components/wizard/CompositePreviewStep.css`

- Styles for: `.auto-btn`, `.auto-all-btn`, `.analysis-card`, `.analysis-badge-hdr`,
  `.before-after-toggle`, `.saved-preset-btn`, `.saved-preset-delete`, `.analyzing-spinner`

### Tests

#### 8. `processing-engine/tests/test_auto_stretch.py`

- `_meta` key present with all expected fields
- `hdr_detected=True` when dynamic range > 5000
- `curve_reason` matches branch logic
- Safe defaults still return `_meta`

#### 9. `processing-engine/tests/test_analyze_channels.py` (new)

- Happy path: returns histogram + params per channel
- `background_neutralization=False` variant
- Degenerate data (< 100 valid pixels)

#### 10. `frontend/jwst-frontend/src/services/compositeService.test.ts`

- Test `analyzeChannels()` service method

#### 11. `frontend/jwst-frontend/src/components/wizard/CompositePreviewStep.test.tsx`

- Auto button triggers analyze call
- Saved preset save/load round-trip

### Docs

#### 12. `docs/key-files.md` — add `/composite/analyze-channels` endpoint
#### 13. `docs/development-plan.md` — mark #688 status

## Risks

| Severity | Risk | Mitigation |
|---|---|---|
| MED | Backend response doesn't currently return histogram or detection metadata | New `/analyze-channels` endpoint handles this cleanly |
| MED | Per-channel histogram needs a data source before compositing | Analyze endpoint computes at low res (512x512 budget) |
| LOW | localStorage presets stale on schema change | Versioned key `jwst_stretch_presets_v1`; discard on mismatch |
| LOW | Before/after preview can desync if inputs change | Capture snapshot at toggle-on time; clear on channel change |

## NOT in Scope

- Per-instrument tuning exposed as explicit UI controls
- Real-time histogram recompute on every slider move
- MongoDB-backed or cloud-synced preset library
- Changes to the stretch algorithm itself
- HistEqStretch auto-selection in auto_stretch_params

## Test Plan

```
Unit Tests (Python):
- [ ] auto_stretch_params: returns _meta with all expected fields
- [ ] auto_stretch_params: _meta.hdr_detected=True when dynamic_range > 5000
- [ ] auto_stretch_params: _meta.curve_reason matches branch logic
- [ ] auto_stretch_params: safe defaults path returns _meta

Integration Tests (Python):
- [ ] POST /composite/analyze-channels: happy path returns histogram + params
- [ ] POST /composite/analyze-channels: responds in < 5s (512px budget)

Unit Tests (TypeScript):
- [ ] analyzeChannels service: maps response correctly
- [ ] preset save/load: version mismatch discards stale presets
- [ ] buildPayloads: per-channel autoStretch only when Auto active

E2E Tests:
- [ ] Auto All: triggers analyze, updates sliders, preview regenerates
- [ ] Per-channel Auto: only affects that channel's params
- [ ] Lock-and-refine: after Auto, slider override works
- [ ] HistogramPanel: appears per-channel after Auto click
- [ ] Explanation card: shows HDR badge when hdr_detected=true
- [ ] Before/after toggle: appears after second preview, switches images
- [ ] Preset save: persists on page reload
- [ ] Preset load: applies params and regenerates preview

Manual Verification:
- [ ] Docker rebuild required: yes
- [ ] MIRI + NIRCam composite: MIRI shows lower asinh_a after Auto All
- [ ] HDR data: explanation card shows HDR badge
- [ ] Preset library survives page refresh
```
